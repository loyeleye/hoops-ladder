package com.ladioyeleye.hoopsladder.share;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.ladioyeleye.hoopsladder.MainActivity;
import com.ladioyeleye.hoopsladder.R;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Brings a link or video shared into Hoops Ladder back to the page.
 *
 * The manifest lists Hoops Ladder as a share target for plain text (what YouTube, Chrome and most apps send for a
 * link) and for videos. MainActivity passes each share intent to receive(). The page (native-web/native.js) listens
 * for "shared" while it runs, and calls take() once at start, for a share that opened the app from scratch:
 *
 *   HoopsShare.addListener("shared", s => ...)   // s = { text, subject, target?, file?, mime?, name? }
 *   HoopsShare.take()                             // resolves { share: {...} } or {}
 *
 * Coach sessions: while one runs, sessionStart() publishes a sharing shortcut ("Session · Mo") so the share sheet
 * shows a second Hoops Ladder target. A share through it carries our shortcut id, and the payload gets
 * target: "session", so a link meant for the session never lands in a take-home drill by guesswork. The plain
 * Hoops Ladder target keeps working exactly as before. sessionEnd() removes the shortcut.
 *
 * Videos (often a coach's slow-motion clip, sent by Quick Share or a text) arrive as a content:// stream that only
 * this intent may read, so it's copied into the app's cache (cache/shared/) on a background thread and the page gets
 * the file's path. Copies older than a day are deleted when the plugin loads.
 *
 * See docs/LEARNING.md, steps 20 and 27.
 */
@CapacitorPlugin(name = "HoopsShare")
public class HoopsSharePlugin extends Plugin {

    /** Id and category of the session's sharing shortcut; the category matches res/xml/shortcuts.xml. */
    public static final String SESSION_SHORTCUT_ID = "coach_session";
    public static final String SESSION_CATEGORY = "com.ladioyeleye.hoopsladder.category.SESSION_SHARE";
    /** Intent.EXTRA_SHORTCUT_ID is API 29+; the string works on every version (older ones just never send it). */
    private static final String EXTRA_SHORTCUT_ID = "android.intent.extra.shortcut.ID";
    private static final long DAY_MS = 24L * 60 * 60 * 1000;

    private static HoopsSharePlugin instance;
    /** A share that arrived before the page was listening. Only the latest one is kept. */
    private static JSObject pending;
    private static final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        instance = this;
        final File dir = sharedDir(getContext());
        io.execute(() -> {
            File[] old = dir.listFiles();
            if (old == null) return;
            long cut = System.currentTimeMillis() - DAY_MS;
            for (File f : old) if (f.lastModified() < cut) f.delete();
        });
    }

    private static File sharedDir(Context ctx) {
        return new File(ctx.getCacheDir(), "shared");
    }

    /**
     * Called by MainActivity with the intent that started or resumed the app. Ignores anything but a share with
     * text or a video stream.
     */
    public static void receive(Context ctx, Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String type = intent.getType();
        Uri stream = null;
        if (type != null && type.startsWith("video/")) {
            if (Build.VERSION.SDK_INT >= 33) stream = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            else stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if ((text == null || text.length() == 0) && stream == null) return;

        final JSObject s = new JSObject();
        s.put("text", text == null ? "" : text.toString());
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        s.put("subject", subject == null ? "" : subject);
        if (SESSION_SHORTCUT_ID.equals(intent.getStringExtra(EXTRA_SHORTCUT_ID))) s.put("target", "session");

        if (stream == null) {
            deliver(s);
            return;
        }
        // Copy off the main thread: a phone video can be hundreds of MB. The read permission came with this intent
        // and lasts while the activity is alive, which covers the copy.
        final Context app = ctx.getApplicationContext();
        final Uri uri = stream;
        final String mime = type;
        io.execute(() -> {
            try {
                File dir = sharedDir(app);
                dir.mkdirs();
                String name = displayName(app.getContentResolver(), uri);
                String ext = mime.contains("mp4") ? ".mp4" : mime.contains("webm") ? ".webm" : mime.contains("quicktime") ? ".mov" : ".video";
                File out = new File(dir, "share_" + System.currentTimeMillis() + ext);
                try (InputStream in = app.getContentResolver().openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                    if (in == null) throw new java.io.IOException("no stream");
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                s.put("file", out.getAbsolutePath());
                s.put("mime", mime);
                s.put("name", name == null ? "" : name);
            } catch (Exception e) {
                // The video couldn't be read. Still hand over any text, and tell the page the video failed.
                s.put("error", "video");
            }
            deliver(s);
        });
    }

    private static String displayName(ContentResolver cr, Uri uri) {
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception e) {
            // Some apps share streams without a queryable name; the page falls back to "Shared video".
        }
        return null;
    }

    private static synchronized void deliver(JSObject s) {
        pending = s;
        if (instance != null) instance.flush();
    }

    private void flush() {
        JSObject s;
        synchronized (HoopsSharePlugin.class) {
            if (pending == null || !hasListeners("shared")) return;
            s = pending;
            pending = null;
        }
        notifyListeners("shared", s);
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

    /** A coach session started: show "Session · <name>" in the share sheet until sessionEnd(). */
    @PluginMethod
    public void sessionStart(PluginCall call) {
        String name = call.getString("name", "");
        String label = name == null || name.trim().isEmpty() ? "Coach session" : "Session · " + name.trim();
        Context ctx = getContext();
        try {
            Intent open = new Intent(ctx, MainActivity.class).setAction(Intent.ACTION_MAIN);
            ShortcutInfoCompat sc = new ShortcutInfoCompat.Builder(ctx, SESSION_SHORTCUT_ID)
                .setShortLabel(label.length() > 25 ? label.substring(0, 25) : label)
                .setLongLabel(label)
                .setIcon(IconCompat.createWithResource(ctx, R.mipmap.ic_launcher))
                .setIntent(open)
                .setLongLived(true)
                .setCategories(Collections.singleton(SESSION_CATEGORY))
                .build();
            ShortcutManagerCompat.pushDynamicShortcut(ctx, sc);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't add the session share target", e);
        }
    }

    /** The session ended: take its share target away so later shares go to take-home as before. */
    @PluginMethod
    public void sessionEnd(PluginCall call) {
        try {
            ShortcutManagerCompat.removeDynamicShortcuts(getContext(), Collections.singletonList(SESSION_SHORTCUT_ID));
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't remove the session share target", e);
        }
    }
}
