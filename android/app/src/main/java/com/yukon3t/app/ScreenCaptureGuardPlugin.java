package com.yukon3t.app;

import android.app.Activity;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Fires a JS "captureDetected" event when the user takes a screenshot while
 * this app is foregrounded, via Activity.registerScreenCaptureCallback
 * (Android 14 / API 34+ only — silently does nothing below that, there's no
 * older public API for this). Unlike iOS (see ScreenCaptureGuardPlugin.swift),
 * Android has no public API at all for detecting screen *recording* by
 * another app, so this plugin only ever reports kind "screenshot".
 * Started/stopped around active calls only (src/lib/screen-capture-guard.ts),
 * not for the app's whole lifetime.
 */
@CapacitorPlugin(name = "ScreenCaptureGuard")
public class ScreenCaptureGuardPlugin extends Plugin {

    private Activity.ScreenCaptureCallback screenCaptureCallback;

    @PluginMethod
    public void startWatching(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                Activity activity = getActivity();
                if (activity != null && screenCaptureCallback == null) {
                    screenCaptureCallback = () -> {
                        JSObject data = new JSObject();
                        data.put("kind", "screenshot");
                        notifyListeners("captureDetected", data);
                    };
                    activity.registerScreenCaptureCallback(
                        ContextCompat.getMainExecutor(getContext()),
                        screenCaptureCallback
                    );
                }
            }
        } catch (Throwable t) {
            // Best-effort — a call already in progress shouldn't fail over this.
        }
        call.resolve();
    }

    @PluginMethod
    public void stopWatching(PluginCall call) {
        try {
            Activity activity = getActivity();
            if (activity != null && screenCaptureCallback != null) {
                activity.unregisterScreenCaptureCallback(screenCaptureCallback);
            }
        } catch (Throwable t) {
            // Best-effort.
        }
        screenCaptureCallback = null;
        call.resolve();
    }
}
