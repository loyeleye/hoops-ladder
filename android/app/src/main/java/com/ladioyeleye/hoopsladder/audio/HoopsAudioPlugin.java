package com.ladioyeleye.hoopsladder.audio;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets music from another app (Spotify, YouTube Music...) keep playing during drills, and turns it down while the
 * app talks.
 *
 * Android shares the speaker through "audio focus". An app that asks for focus with GAIN_TRANSIENT_MAY_DUCK says
 * "I'll talk for a moment, others may keep playing quietly", the same request navigation apps make for turn-by-turn
 * directions. Since Android 8 the system lowers the other app's volume by itself, and brings it back when the focus
 * is given up. The app never asks for full focus, so it never pauses your music.
 *
 * JavaScript (native-web/native.js) calls it as Capacitor.Plugins.HoopsAudio around each spoken cue:
 *
 *   HoopsAudio.duck()    // music down; resolves { granted }. Calling it again while ducked just keeps it down.
 *   HoopsAudio.unduck()  // music back up
 *
 * If the page never calls unduck() (it froze, or the app went to the background mid-cue), the music comes back by
 * itself after a few seconds. See docs/LEARNING.md, step 18.
 */
@CapacitorPlugin(name = "HoopsAudio")
public class HoopsAudioPlugin extends Plugin {

    /** Longest the music stays down without another duck() call. The page calls duck() again while it's still talking. */
    private static final long SAFETY_MS = 10000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable safety = this::release;
    private final AudioManager.OnAudioFocusChangeListener onChange = change -> {};
    private AudioFocusRequest request;
    private boolean held = false;

    @PluginMethod
    public void duck(PluginCall call) {
        main.post(() -> {
            boolean granted = held || take();
            main.removeCallbacks(safety);
            if (held) main.postDelayed(safety, SAFETY_MS);
            JSObject r = new JSObject();
            r.put("granted", granted);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void unduck(PluginCall call) {
        main.post(() -> {
            release();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacksAndMessages(null);
        release();
    }

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    private boolean take() {
        AudioManager am = audio();
        if (am == null) return false;
        int r;
        if (Build.VERSION.SDK_INT >= 26) {
            if (request == null) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(attrs)
                    .setOnAudioFocusChangeListener(onChange, main)
                    .build();
            }
            r = am.requestAudioFocus(request);
        } else {
            r = am.requestAudioFocus(onChange, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        }
        held = r == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        return held;
    }

    private void release() {
        main.removeCallbacks(safety);
        if (!held) return;
        held = false;
        AudioManager am = audio();
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            if (request != null) am.abandonAudioFocusRequest(request);
        } else {
            am.abandonAudioFocus(onChange);
        }
    }
}
