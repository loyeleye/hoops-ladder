package com.ladioyeleye.hoopsladder.remote;

import android.Manifest;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The JavaScript side calls it as Capacitor.Plugins.HoopsRemote (see native-web/native.js):
 *
 *   HoopsRemote.start({ mode: "sets" | "shots", title, text })  // the logger opened: take over the buttons
 *   HoopsRemote.update({ mode, title, text })                   // after every rep: refresh the notification
 *   HoopsRemote.stop()                                          // the logger closed: give the buttons back
 *   HoopsRemote.addListener("signal", e => ...)                 // e.k is "a", "b" or "u"; e.source says where it came from
 */
@CapacitorPlugin(
    name = "HoopsRemote",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class HoopsRemotePlugin extends Plugin {

    private boolean inFront = true;

    @Override
    public void load() {
        RemoteHub.listener = (k, source) -> {
            // When the page can't be seen (screen locked, other app), buzz so the player feels each logged press.
            if (!inFront) buzz(k);
            JSObject o = new JSObject();
            o.put("k", k);
            o.put("source", source);
            notifyListeners("signal", o);
        };
    }

    @PluginMethod
    public void start(PluginCall call) {
        // Android 13+ hides the notification (and its lock-screen buttons) unless the player allows notifications.
        // The volume buttons work either way, so a "no" here doesn't stop logging.
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) {
            requestPermissionForAlias("notifications", call, "afterNotificationPrompt");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void afterNotificationPrompt(PluginCall call) {
        doStart(call);
    }

    private void doStart(PluginCall call) {
        RemoteHub.reset();
        RemoteHub.armed = true;
        RepLoggerService.start(getContext(), extras(call));
        JSObject r = new JSObject();
        r.put("notifications", Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void update(PluginCall call) {
        RepLoggerService s = RepLoggerService.instance;
        if (RemoteHub.armed && s != null) s.apply(extras(call));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopLogging();
        call.resolve();
    }

    private void stopLogging() {
        RemoteHub.armed = false;
        RemoteHub.reset();
        RepLoggerService.stop(getContext());
    }

    private static Bundle extras(PluginCall call) {
        Bundle b = new Bundle();
        b.putString(RepLoggerService.EXTRA_MODE, call.getString("mode", "sets"));
        b.putString(RepLoggerService.EXTRA_TITLE, call.getString("title", "Hoops Ladder"));
        b.putString(RepLoggerService.EXTRA_TEXT, call.getString("text", ""));
        return b;
    }

    private void buzz(String k) {
        Vibrator v = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        if (v == null || Build.VERSION.SDK_INT < 26) return;
        // a: two short buzzes, b: one longer buzz, u: three quick ones. Same feel as the web app.
        long[] p = "a".equals(k) ? new long[] { 0, 40, 60, 40 } : "b".equals(k) ? new long[] { 0, 120 } : new long[] { 0, 30, 50, 30, 50, 30 };
        v.vibrate(VibrationEffect.createWaveform(p, -1));
    }

    @Override
    protected void handleOnResume() {
        inFront = true;
    }

    @Override
    protected void handleOnPause() {
        inFront = false;
    }

    @Override
    protected void handleOnDestroy() {
        stopLogging();
        RemoteHub.listener = null;
    }
}
