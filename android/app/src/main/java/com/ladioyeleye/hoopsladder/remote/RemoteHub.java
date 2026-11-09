package com.ladioyeleye.hoopsladder.remote;

import android.view.KeyEvent;

/**
 * The meeting point for every way of logging a rep without touching the screen:
 * the volume buttons, earbud and Bluetooth media buttons, and the lock-screen / notification buttons.
 * They all end up as a signal ("a", "b" or "u") that the plugin forwards to the page.
 *
 * Only active ("armed") while the page's full-screen logger is open, so the volume buttons
 * work normally everywhere else in the app.
 */
public final class RemoteHub {

    public interface Listener {
        void onSignal(String k, String source);
    }

    static volatile boolean armed = false;
    static Listener listener;
    private static String source = "button";
    private static final PressDecoder decoder = new PressDecoder(k -> emit(k, source));

    private RemoteHub() {}

    /** Sends a finished signal to the page. */
    static void emit(String k, String from) {
        if (!armed) return;
        Listener l = listener;
        if (l != null) l.onSignal(k, from);
    }

    /**
     * Called by MainActivity for every key event, and by the media session for media buttons.
     * Returns true when the key was used for logging, so Android doesn't also change the volume.
     */
    public static boolean handleKey(KeyEvent e) {
        if (!armed || e == null) return false;
        boolean isDown = e.getAction() == KeyEvent.ACTION_DOWN;
        boolean isUp = e.getAction() == KeyEvent.ACTION_UP;
        switch (e.getKeyCode()) {
            case KeyEvent.KEYCODE_VOLUME_UP:
            case KeyEvent.KEYCODE_VOLUME_DOWN:
            case KeyEvent.KEYCODE_HEADSETHOOK:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                source = isVolume(e) ? "volume" : "media";
                if (isDown) decoder.down();
                else if (isUp) decoder.up();
                return true;
            // Some earbuds and remotes have their own next / previous buttons. Map them the way the web app does.
            case KeyEvent.KEYCODE_MEDIA_NEXT:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                if (isDown && e.getRepeatCount() == 0) emit("b", "media");
                return true;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                if (isDown && e.getRepeatCount() == 0) emit("u", "media");
                return true;
            default:
                return false;
        }
    }

    /** A volume press while the screen is locked (see RepLoggerService's VolumeProvider). */
    static void volumePress() {
        if (!armed) return;
        source = "volume";
        decoder.press();
    }

    static void reset() {
        decoder.reset();
    }

    private static boolean isVolume(KeyEvent e) {
        return e.getKeyCode() == KeyEvent.KEYCODE_VOLUME_UP || e.getKeyCode() == KeyEvent.KEYCODE_VOLUME_DOWN;
    }
}
