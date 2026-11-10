package com.ladioyeleye.hoopsladder.voice;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

/**
 * Listens for a few spoken commands during drills ("pause", "lost it", "miss", "done", "undo"...), over and over,
 * until stopped. Android's recognizer hears one phrase at a time, so this restarts it after every phrase or silence.
 *
 * It uses the phone's on-device recognizer when there is one (Android 12+ with the language downloaded), so audio
 * stays on the phone; otherwise the default recognizer, asked to prefer offline. On Android 13+ the command words
 * are passed as biasing strings, so short words like "miss" win over look-alikes.
 *
 * JavaScript (native-web/native.js) calls it as Capacitor.Plugins.HoopsVoice:
 *
 *   HoopsVoice.start({ words: ["miss", "done", ...] })  // resolves { onDevice } once listening; rejects if the mic is refused
 *   HoopsVoice.stop()
 *   HoopsVoice.addListener("heard", e => ...)           // e.text, e.alts (other guesses), e.final (false while speaking)
 *   HoopsVoice.addListener("state", e => ...)           // e.on, e.error (when it gave up)
 *
 * See docs/LEARNING.md, step 15.
 */
@CapacitorPlugin(name = "HoopsVoice", permissions = { @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }) })
public class HoopsVoicePlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private boolean on = false;
    private boolean onDevice = false;
    private boolean triedOnDevice = false;
    private ArrayList<String> words = new ArrayList<>();
    private int busyRetries = 0;

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            requestPermissionForAlias("mic", call, "afterMicPrompt");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void afterMicPrompt(PluginCall call) {
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            call.reject("Microphone not allowed", "denied");
            return;
        }
        begin(call);
    }

    private void begin(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("No speech recognizer on this phone", "unavailable");
            return;
        }
        words = new ArrayList<>();
        JSArray w = call.getArray("words");
        if (w != null) {
            for (int i = 0; i < w.length(); i++) {
                String s = w.optString(i, "");
                if (!s.isEmpty()) words.add(s);
            }
        }
        main.post(() -> {
            on = true;
            busyRetries = 0;
            triedOnDevice = false;
            create();
            listen();
            JSObject r = new JSObject();
            r.put("onDevice", onDevice);
            call.resolve(r);
            state(null);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            on = false;
            resumeOn = false;
            main.removeCallbacksAndMessages(null);
            destroy();
            state(null);
            call.resolve();
        });
    }

    private boolean resumeOn = false;

    @Override
    protected void handleOnPause() {
        // Another app or the lock screen took over: give the mic back (Android blocks background mic use without a
        // microphone foreground service). Listening comes back when the app does.
        if (!on) return;
        resumeOn = true;
        on = false;
        main.removeCallbacksAndMessages(null);
        destroy();
        state(null);
    }

    @Override
    protected void handleOnResume() {
        if (!resumeOn) return;
        resumeOn = false;
        if (getPermissionState("mic") != PermissionState.GRANTED) return;
        on = true;
        create();
        listen();
        state(null);
    }

    @Override
    protected void handleOnDestroy() {
        on = false;
        main.removeCallbacksAndMessages(null);
        destroy();
    }

    private void create() {
        destroy();
        onDevice = false;
        if (!triedOnDevice && Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())) {
            try {
                rec = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
                onDevice = true;
            } catch (Exception e) {
                rec = null;
            }
        }
        if (rec == null) rec = SpeechRecognizer.createSpeechRecognizer(getContext());
        rec.setRecognitionListener(listener);
    }

    private void destroy() {
        if (rec == null) return;
        try {
            rec.cancel();
            rec.destroy();
        } catch (Exception ignored) {}
        rec = null;
    }

    private void listen() {
        if (!on || rec == null) return;
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        // Commands are short: end the phrase soon after the player stops talking.
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 600L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 500L);
        if (Build.VERSION.SDK_INT >= 33 && !words.isEmpty()) {
            i.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, words);
        }
        try {
            rec.startListening(i);
        } catch (Exception e) {
            again(500);
        }
    }

    private void again(long ms) {
        main.postDelayed(() -> {
            if (!on) return;
            if (rec == null) create();
            listen();
        }, ms);
    }

    private void state(String error) {
        JSObject o = new JSObject();
        o.put("on", on);
        o.put("onDevice", onDevice);
        if (error != null) o.put("error", error);
        notifyListeners("state", o);
    }

    private void heard(Bundle b, boolean fin) {
        ArrayList<String> m = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (m == null || m.isEmpty() || m.get(0) == null || m.get(0).trim().isEmpty()) return;
        JSObject o = new JSObject();
        o.put("text", m.get(0));
        JSArray alts = new JSArray();
        for (int k = 1; k < m.size(); k++) alts.put(m.get(k));
        o.put("alts", alts);
        o.put("final", fin);
        notifyListeners("heard", o);
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override
        public void onReadyForSpeech(Bundle params) {
            busyRetries = 0;
        }

        @Override
        public void onBeginningOfSpeech() {}

        @Override
        public void onRmsChanged(float rmsdB) {}

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {}

        @Override
        public void onPartialResults(Bundle partial) {
            heard(partial, false);
        }

        @Override
        public void onResults(Bundle results) {
            heard(results, true);
            again(50);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}

        @Override
        public void onError(int error) {
            if (!on) return;
            switch (error) {
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                    on = false;
                    destroy();
                    state("denied");
                    return;
                case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                    if (++busyRetries > 20) {
                        on = false;
                        destroy();
                        state("busy");
                        return;
                    }
                    destroy();
                    again(400);
                    return;
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                    again(50); // silence or noise: just listen again
                    return;
                default:
                    // Language pack missing for the on-device recognizer, or a network/server error: fall back to the
                    // default recognizer once, then keep retrying gently.
                    if (onDevice) triedOnDevice = true;
                    destroy();
                    again(onDevice ? 100 : 1500);
            }
        }
    };
}
