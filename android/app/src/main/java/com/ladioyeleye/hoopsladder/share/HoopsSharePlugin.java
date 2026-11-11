package com.ladioyeleye.hoopsladder.share;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Brings a link shared into Hoops Ladder (YouTube's Share › Hoops Ladder) back to the page, so it lands on the drill
 * being added or edited on the Coach tab.
 *
 * The manifest lists Hoops Ladder as a share target for plain text, which is what YouTube, Chrome and most apps send
 * for a link. MainActivity passes each share intent to receive(). The page (native-web/native.js) listens for
 * "shared" while it runs, and calls take() once at start, for a share that opened the app from scratch:
 *
 *   HoopsShare.addListener("shared", s => ...)   // s = { text, subject }
 *   HoopsShare.take()                             // resolves { share: { text, subject } } or {}
 *
 * See docs/LEARNING.md, step 20.
 */
@CapacitorPlugin(name = "HoopsShare")
public class HoopsSharePlugin extends Plugin {

    private static HoopsSharePlugin instance;
    /** A share that arrived before the page was listening. Only the latest one is kept. */
    private static JSObject pending;

    @Override
    public void load() {
        instance = this;
    }

    /** Called by MainActivity with the intent that started or resumed the app. Ignores anything but a text share. */
    public static synchronized void receive(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null || text.length() == 0) return;
        JSObject s = new JSObject();
        s.put("text", text.toString());
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        s.put("subject", subject == null ? "" : subject);
        pending = s;
        if (instance != null) instance.flush();
    }

    private synchronized void flush() {
        if (pending == null || !hasListeners("shared")) return;
        notifyListeners("shared", pending);
        pending = null;
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject r = new JSObject();
        synchronized (HoopsSharePlugin.class) {
            if (pending != null) {
                r.put("share", pending);
                pending = null;
            }
        }
        call.resolve(r);
    }
}
