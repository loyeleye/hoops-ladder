package com.ladioyeleye.hoopsladder.remote;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.VolumeProvider;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.view.KeyEvent;
import androidx.core.app.ServiceCompat;
import com.ladioyeleye.hoopsladder.MainActivity;
import com.ladioyeleye.hoopsladder.R;

/**
 * Keeps rep logging alive while the phone is locked or the app is in the background.
 *
 * Three jobs:
 * 1. It is a foreground service, so it shows an ongoing notification and Android doesn't freeze the app
 *    while the screen is off.
 * 2. It owns a MediaSession. Android sends earbud / Bluetooth media buttons to the active media session,
 *    and, because the session says its volume is handled "remotely" (like a Chromecast), Android also
 *    sends it the phone's volume buttons, even with the screen off. Those presses become reps instead of
 *    changing the volume.
 * 3. The notification and the lock-screen media card show the current set and have Miss / Set done / Undo
 *    buttons (Miss / Make / Undo when logging shot by shot).
 */
public class RepLoggerService extends Service {

    static final String CHANNEL = "rep_logging";
    static final int NOTIFICATION_ID = 7;
    static final String ACTION_SIGNAL = "com.ladioyeleye.hoopsladder.SIGNAL";
    static final String EXTRA_K = "k";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_MODE = "mode";

    /** The running service, so the plugin can update the notification without starting the service again. */
    static RepLoggerService instance;

    private MediaSession session;
    private String title = "Hoops Ladder";
    private String text = "";
    private String mode = "sets";
    private boolean started = false;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();

        session = new MediaSession(this, "HoopsLadderReps");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public boolean onMediaButtonEvent(Intent intent) {
                KeyEvent e = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                return RemoteHub.handleKey(e) || super.onMediaButtonEvent(intent);
            }

            @Override
            public void onCustomAction(String action, Bundle extras) {
                RemoteHub.emit(action, "lockscreen");
            }
        });
        // "Remote" volume: Android asks us to change the volume instead of changing the phone's own volume.
        // Each request is one press of a volume button.
        session.setPlaybackToRemote(new VolumeProvider(VolumeProvider.VOLUME_CONTROL_RELATIVE, 10, 5) {
            @Override
            public void onAdjustVolume(int direction) {
                if (direction != 0) RemoteHub.volumePress();
            }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_SIGNAL.equals(intent.getAction())) {
            // A tap on one of the notification's buttons (Android 12 and older show these; newer versions use the
            // media session's custom actions, which arrive in onCustomAction above).
            RemoteHub.emit(intent.getStringExtra(EXTRA_K), "notification");
        } else if (intent != null) {
            apply(intent.getExtras());
        }
        return START_NOT_STICKY;
    }

    /** Updates the set, misses and labels shown on the notification and lock screen. */
    void apply(Bundle b) {
        if (b != null) {
            if (b.getString(EXTRA_TITLE) != null) title = b.getString(EXTRA_TITLE);
            if (b.getString(EXTRA_TEXT) != null) text = b.getString(EXTRA_TEXT);
            if (b.getString(EXTRA_MODE) != null) mode = b.getString(EXTRA_MODE);
        }
        boolean sets = !"shots".equals(mode);
        // One rule in every mode: one press ("a") means something went wrong, two presses ("b") mean it went right.
        String aLabel = "Miss";
        String bLabel = sets ? "Set done" : "Make";
        int aIcon = R.drawable.ic_rep_miss;
        int bIcon = sets ? R.drawable.ic_rep_done : R.drawable.ic_rep_make;

        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, text)
            .build());
        // Android 13+ builds the lock-screen media card from these custom actions.
        session.setPlaybackState(new PlaybackState.Builder()
            .setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 0f)
            .addCustomAction(new PlaybackState.CustomAction.Builder("a", aLabel, aIcon).build())
            .addCustomAction(new PlaybackState.CustomAction.Builder("b", bLabel, bIcon).build())
            .addCustomAction(new PlaybackState.CustomAction.Builder("u", "Undo", R.drawable.ic_rep_undo).build())
            .build());

        Notification n = build(aLabel, aIcon, bLabel, bIcon);
        if (!started) {
            int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);
            started = true;
        } else {
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, n);
        }
    }

    private Notification build(String aLabel, int aIcon, String bLabel, int bIcon) {
        Notification.Builder nb = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return nb
            .setSmallIcon(R.drawable.ic_stat_hoops)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC) // show the set and the buttons on the lock screen
            .setCategory(Notification.CATEGORY_WORKOUT)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
            .addAction(action("a", aLabel, aIcon, 1))
            .addAction(action("b", bLabel, bIcon, 2))
            .addAction(action("u", "Undo", R.drawable.ic_rep_undo, 3))
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .build();
    }

    private Notification.Action action(String k, String label, int icon, int requestCode) {
        Intent i = new Intent(this, RepLoggerService.class).setAction(ACTION_SIGNAL).putExtra(EXTRA_K, k);
        PendingIntent pi = PendingIntent.getService(this, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, pi).build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Rep logging", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows your current set with Miss and Set done buttons while you train.");
        ch.setShowBadge(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    static void start(Context ctx, Bundle extras) {
        Intent i = new Intent(ctx, RepLoggerService.class).putExtras(extras);
        androidx.core.content.ContextCompat.startForegroundService(ctx, i);
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, RepLoggerService.class));
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The player swiped the app away: stop logging and remove the notification.
        RemoteHub.armed = false;
        stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        session.setActive(false);
        session.release();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
