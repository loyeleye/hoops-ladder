package com.ladioyeleye.hoopsladder.music;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;

/**
 * Shows and controls the music another app is playing (Spotify, YouTube Music...): track, play / pause, back, skip.
 *
 * Android lets an app see other apps' media sessions only after the player turns on "notification access" for it
 * (MusicListenerService). Without it the plugin can still tell that *something* is playing (AudioManager), which the
 * page uses to offer the setup.
 *
 * JavaScript (native-web/native.js, section 7) calls it as Capacitor.Plugins.HoopsMusic:
 *
 *   HoopsMusic.state()                  // { access, playingSomewhere }
 *   HoopsMusic.openAccess()             // opens the phone's notification access screen
 *   HoopsMusic.watch()                  // starts sending "music" events (call again after access is granted)
 *   HoopsMusic.unwatch()
 *   HoopsMusic.control({ action })      // "play" | "pause" | "next" | "prev"
 *   HoopsMusic.addListener("music", e)  // e.on, e.playing, e.title, e.artist, e.app
 *
 * See docs/LEARNING.md, step 19.
 */
@CapacitorPlugin(name = "HoopsMusic")
public class HoopsMusicPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaSessionManager msm;
    private MediaController ctl;
    private boolean watching = false;
    private boolean listening = false;

    private final MediaSessionManager.OnActiveSessionsChangedListener onSessions = list -> pick(list);

    private final MediaController.Callback onChange = new MediaController.Callback() {
        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            // Another app may have started playing while this one paused: pick again, then report.
            pick(null);
        }

        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            emit();
        }

        @Override
        public void onSessionDestroyed() {
            pick(null);
        }
    };

    private ComponentName listener() {
        return new ComponentName(getContext(), MusicListenerService.class);
    }

    private boolean hasAccess() {
        return NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName());
    }

    @PluginMethod
    public void state(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        JSObject r = new JSObject();
        r.put("access", hasAccess());
        r.put("playingSomewhere", am != null && am.isMusicActive());
        call.resolve(r);
    }

    @PluginMethod
    public void openAccess(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open the notification access screen");
        }
    }

    @PluginMethod
    public void watch(PluginCall call) {
        main.post(() -> {
            watching = true;
            attach();
            JSObject r = new JSObject();
            r.put("access", listening);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void unwatch(PluginCall call) {
        main.post(() -> {
            watching = false;
            detach();
            call.resolve();
        });
    }

    @PluginMethod
    public void control(PluginCall call) {
        String action = call.getString("action", "");
        main.post(() -> {
            if (ctl == null) {
                call.reject("No music playing");
                return;
            }
            MediaController.TransportControls t = ctl.getTransportControls();
            switch (action) {
                case "play":
                    t.play();
                    break;
                case "pause":
                    t.pause();
                    break;
                case "next":
                    t.skipToNext();
                    break;
                case "prev":
                    t.skipToPrevious();
                    break;
                default:
                    call.reject("Unknown action");
                    return;
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnResume() {
        // Coming back from the notification access screen: start listening if access was just turned on.
        if (watching && !listening) attach();
    }

    @Override
    protected void handleOnDestroy() {
        detach();
    }

    private void attach() {
        if (listening || !hasAccess()) return;
        try {
            msm = (MediaSessionManager) getContext().getSystemService(Context.MEDIA_SESSION_SERVICE);
            msm.addOnActiveSessionsChangedListener(onSessions, listener(), main);
            listening = true;
            pick(null);
        } catch (SecurityException e) {
            listening = false; // access was turned off again
        }
    }

    private void detach() {
        if (msm != null && listening) {
            try {
                msm.removeOnActiveSessionsChangedListener(onSessions);
            } catch (Exception ignored) {}
        }
        listening = false;
        use(null);
    }

    /** Follows the music app that's playing; if none is, the most recent one (so a paused song can be resumed). */
    private void pick(List<MediaController> list) {
        if (!listening) return;
        if (list == null) {
            try {
                list = msm.getActiveSessions(listener());
            } catch (SecurityException e) {
                detach();
                emit();
                return;
            }
        }
        String me = getContext().getPackageName();
        MediaController best = null;
        for (MediaController c : list) {
            if (me.equals(c.getPackageName())) continue; // the rep logger's own session
            if (best == null) best = c;
            PlaybackState s = c.getPlaybackState();
            if (s != null && s.getState() == PlaybackState.STATE_PLAYING) {
                best = c;
                break;
            }
        }
        use(best);
        emit();
    }

    private void use(MediaController c) {
        if (ctl != null && c != null && ctl.getSessionToken().equals(c.getSessionToken())) return;
        if (ctl != null) ctl.unregisterCallback(onChange);
        ctl = c;
        if (ctl != null) ctl.registerCallback(onChange, main);
    }

    private void emit() {
        JSObject o = new JSObject();
        o.put("access", listening);
        if (ctl == null) {
            o.put("on", false);
            notifyListeners("music", o);
            return;
        }
        PlaybackState s = ctl.getPlaybackState();
        int st = s == null ? PlaybackState.STATE_NONE : s.getState();
        MediaMetadata m = ctl.getMetadata();
        String title = m == null ? null : m.getString(MediaMetadata.METADATA_KEY_TITLE);
        String artist = m == null ? null : m.getString(MediaMetadata.METADATA_KEY_ARTIST);
        // A stopped session with nothing loaded is an app that's just sitting there: no controls for it.
        boolean on = st != PlaybackState.STATE_NONE && st != PlaybackState.STATE_STOPPED && st != PlaybackState.STATE_ERROR
            || title != null;
        o.put("on", on);
        o.put("playing", st == PlaybackState.STATE_PLAYING || st == PlaybackState.STATE_BUFFERING);
        o.put("title", title == null ? "" : title);
        o.put("artist", artist == null ? "" : artist);
        o.put("app", label(ctl.getPackageName()));
        notifyListeners("music", o);
    }

    private String label(String pkg) {
        try {
            PackageManager pm = getContext().getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return pm.getApplicationLabel(ai).toString();
        } catch (Exception e) {
            return "";
        }
    }
}
