package com.ladioyeleye.hoopsladder.music;

import android.service.notification.NotificationListenerService;

/**
 * Exists only so Android will hand the app the list of music apps that are playing.
 *
 * MediaSessionManager.getActiveSessions() (what HoopsMusicPlugin uses to show and control Spotify, YouTube Music...)
 * only works for an app the player has given "notification access", and that access is granted to a
 * NotificationListenerService. This one ignores every notification: it overrides nothing, reads nothing, stores
 * nothing. See docs/LEARNING.md, step 19.
 */
public class MusicListenerService extends NotificationListenerService {}
