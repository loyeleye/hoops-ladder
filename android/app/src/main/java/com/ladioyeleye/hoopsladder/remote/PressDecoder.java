package com.ladioyeleye.hoopsladder.remote;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.function.Consumer;

/**
 * Turns raw button presses into the app's three logging signals, the same one-button map the web app uses:
 * one press = "a", two quick presses or a long hold = "b", three quick presses = "u" (undo).
 * In sets mode a = miss and b = set done; in shot-by-shot mode a = make and b = miss.
 *
 * Decoding happens here, in Java, rather than in the page, because the page's timers slow down
 * when the screen is locked. The page only ever receives the finished signal.
 * Everything runs on the main thread.
 */
final class PressDecoder {

    /** How long to wait after a press for another one before deciding it was a single, double or triple. */
    static final long GAP_MS = 380;
    /** Holding a button this long counts as "b" (the same as a double press). */
    static final long HOLD_MS = 600;
    /** Presses closer together than this are key-repeat from a held button, not a person pressing again. */
    static final long REPEAT_MS = 150;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Consumer<String> out = k -> {};
    private int count = 0;
    private boolean down = false;
    private boolean holdFired = false;
    private long lastPress = 0;

    private final Runnable flush = () -> {
        int n = count;
        count = 0;
        if (n > 0) out.accept(n >= 3 ? "u" : n == 2 ? "b" : "a");
    };

    private final Runnable hold = () -> {
        holdFired = true;
        handler.removeCallbacks(flush);
        count = 0;
        out.accept("b");
    };

    PressDecoder(Consumer<String> out) {
        this.out = out;
    }

    /** A button went down. Used when we see real key events (screen on, app in front). */
    void down() {
        if (down) return; // key repeat while held
        down = true;
        holdFired = false;
        handler.removeCallbacks(flush);
        handler.postDelayed(hold, HOLD_MS);
    }

    /** The button came back up. */
    void up() {
        if (!down) return;
        down = false;
        handler.removeCallbacks(hold);
        if (holdFired) return;
        count++;
        handler.postDelayed(flush, GAP_MS);
    }

    /**
     * A press from a source that only reports presses, with no "up": the volume buttons while the
     * screen is locked, which Android delivers to the media session as "volume up/down" requests.
     */
    void press() {
        long now = SystemClock.uptimeMillis();
        boolean repeat = now - lastPress < REPEAT_MS;
        lastPress = now;
        if (repeat) return;
        handler.removeCallbacks(flush);
        count++;
        handler.postDelayed(flush, GAP_MS);
    }

    void reset() {
        handler.removeCallbacks(flush);
        handler.removeCallbacks(hold);
        count = 0;
        down = false;
        holdFired = false;
    }
}
