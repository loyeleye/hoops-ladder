package com.ladioyeleye.hoopsladder.voice;

import android.Manifest;
import android.annotation.TargetApi;
import android.content.Intent;
import android.media.AudioFormat;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;

/**
 * Turns a coach session's voice notes and coach clips into text after they're saved, never live.
 *
 * The page decodes the recording (webm/opus or mp4/aac from the WebView's MediaRecorder) to 16 kHz mono 16-bit PCM
 * with the Web Audio API and sends it here as base64. This writes it to a temporary file in the app's cache and
 * hands that file to the phone's ON-DEVICE recognizer as its audio source (RecognizerIntent.EXTRA_AUDIO_SOURCE,
 * Android 13+), in a segmented session so a long explanation with pauses comes back whole instead of stopping at
 * the first silence. Nothing goes to a server: phones without an on-device recognizer get "unavailable", and the
 * note stays audio. The temporary file is deleted as soon as the recognizer is done.
 *
 * JavaScript (native-web/native.js, section 3b) calls it as Capacitor.Plugins.HoopsTranscribe:
 *
 *   HoopsTranscribe.available()                          // resolves { ok } (Android 13+ with an on-device recognizer)
 *   HoopsTranscribe.transcribe({ pcm, rate, lang, ask }) // resolves { text } ("" when no words were heard)
 *                                                        // rejects with code unavailable, denied, busy, nolang, timeout or error
 *
 * See docs/LEARNING.md, step 27.
 */
@CapacitorPlugin(name = "HoopsTranscribe", permissions = { @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }) })
public class HoopsTranscribePlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private PluginCall cur;
    private ParcelFileDescriptor pfd;
    private File file;
    private final StringBuilder text = new StringBuilder();
    private final Runnable timeout = () -> done("timeout");
    private boolean askedForPack = false;

    private boolean supported() {
        return Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ok", supported());
        call.resolve(r);
    }

    @PluginMethod
    public void transcribe(PluginCall call) {
        if (!supported()) {
            call.reject("No on-device speech recognizer", "unavailable");
            return;
        }
        // The recognition service checks that the app may record audio, even when it reads a file. The app already
        // has the permission from recording the note; a clip shared in before any recording may not.
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            if (Boolean.TRUE.equals(call.getBoolean("ask", false))) {
                requestPermissionForAlias("mic", call, "afterMicPrompt");
                return;
            }
            call.reject("Microphone not allowed", "denied");
            return;
        }
        prepare(call);
    }

    @PermissionCallback
    private void afterMicPrompt(PluginCall call) {
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            call.reject("Microphone not allowed", "denied");
            return;
        }
        prepare(call);
    }

    /** Runs on Capacitor's plugin thread: decode the audio and write the temporary file off the main thread. */
    private void prepare(PluginCall call) {
        String pcm = call.getString("pcm", "");
        int rate = call.getInt("rate", 16000);
        String lang = call.getString("lang", "en-US");
        if (pcm == null || pcm.isEmpty()) {
            call.reject("No audio", "error");
            return;
        }
        File f = null;
        ParcelFileDescriptor fd = null;
        long bytes;
        try {
            byte[] data = Base64.decode(pcm, Base64.DEFAULT);
            bytes = data.length;
            f = File.createTempFile("hoops-tx", ".pcm", getContext().getCacheDir());
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(data);
            }
            fd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
        } catch (Exception e) {
            if (fd != null) try {
                fd.close();
            } catch (Exception ignored) {}
            if (f != null) f.delete();
            call.reject("Couldn't read the audio", "error");
            return;
        }
        final File ff = f;
        final ParcelFileDescriptor ffd = fd;
        // About real time on most phones; allow three times the audio's length, plus time to load the model.
        final long wait = Math.max(1, bytes / (2L * rate)) * 3000L + 20000L;
        main.post(() -> start(call, ff, ffd, rate, lang, wait));
    }

    @TargetApi(33)
    private void start(PluginCall call, File f, ParcelFileDescriptor fd, int rate, String lang, long wait) {
        if (cur != null) {
            try {
                fd.close();
            } catch (Exception ignored) {}
            f.delete();
            call.reject("Already transcribing", "busy");
            return;
        }
        cur = call;
        file = f;
        pfd = fd;
        text.setLength(0);
        try {
            rec = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
            rec.setRecognitionListener(listener);
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, fd);
            i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
            i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
            i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, rate);
            // Keep going through pauses until the file ends; results arrive one segment at a time.
            i.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);
            main.postDelayed(timeout, wait);
            rec.startListening(i);
        } catch (Exception e) {
            done("error");
        }
    }

    private void add(Bundle b) {
        ArrayList<String> m = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (m == null || m.isEmpty() || m.get(0) == null) return;
        String s = m.get(0).trim();
        if (s.isEmpty()) return;
        if (text.length() > 0) text.append(' ');
        text.append(s);
    }

    /** Ends the current request: resolves with the text so far, or rejects with the error code. Main thread only. */
    private void done(String error) {
        main.removeCallbacks(timeout);
        PluginCall call = cur;
        cur = null;
        if (rec != null) {
            try {
                rec.cancel();
                rec.destroy();
            } catch (Exception ignored) {}
            rec = null;
        }
        if (pfd != null) {
            try {
                pfd.close();
            } catch (Exception ignored) {}
            pfd = null;
        }
        if (file != null) {
            file.delete();
            file = null;
        }
        if (call == null) return;
        // A timeout after some segments came back still keeps what was heard.
        if (error == null || ("timeout".equals(error) && text.length() > 0)) {
            JSObject r = new JSObject();
            r.put("text", text.toString());
            call.resolve(r);
        } else {
            call.reject("Couldn't transcribe (" + error + ")", error);
        }
        text.setLength(0);
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override
        public void onReadyForSpeech(Bundle params) {}

        @Override
        public void onBeginningOfSpeech() {}

        @Override
        public void onRmsChanged(float rmsdB) {}

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {}

        @Override
        public void onPartialResults(Bundle partial) {}

        @Override
        public void onEvent(int eventType, Bundle params) {}

        // A recognizer that ignores the segmented session answers here once instead.
        @Override
        public void onResults(Bundle results) {
            if (cur == null) return;
            add(results);
            done(null);
        }

        @Override
        public void onSegmentResults(Bundle segmentResults) {
            if (cur == null) return;
            add(segmentResults);
        }

        @Override
        public void onEndOfSegmentedSession() {
            if (cur == null) return;
            done(null);
        }

        @Override
        public void onError(int error) {
            if (cur == null) return;
            switch (error) {
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                    done(null); // no (more) words: keep what was heard, which may be nothing
                    return;
                case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
                case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
                    // The language pack isn't on the phone yet: ask Android to fetch it once, so a retry can work.
                    if (!askedForPack && Build.VERSION.SDK_INT >= 33 && rec != null) {
                        askedForPack = true;
                        try {
                            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
                            rec.triggerModelDownload(i);
                        } catch (Exception ignored) {}
                    }
                    done("nolang");
                    return;
                case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                    done("busy");
                    return;
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                    done("denied");
                    return;
                default:
                    if (text.length() > 0) done(null);
                    else done("error");
            }
        }
    };

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            if (cur != null) done("error");
        });
    }
}
