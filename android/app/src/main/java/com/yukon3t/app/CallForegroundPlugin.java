package com.yukon3t.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS-facing bridge onto CallForegroundService's active-call mode — see that
 * class's doc comment. Called from src/lib/call-session.tsx on session
 * start/end so the underlying Daily call (which keeps running in the WebView
 * regardless) doesn't get its process killed/deprioritized if the user
 * backgrounds the app or navigates elsewhere inside it mid-call. No-ops on
 * web/iOS since call-session.tsx only invokes it behind
 * Capacitor.getPlatform() === "android".
 */
@CapacitorPlugin(name = "CallForeground")
public class CallForegroundPlugin extends Plugin {

    @PluginMethod
    public void startActiveCall(PluginCall call) {
        String callId = call.getString("callId", "active-call");
        String label = call.getString("label", "Call");
        boolean isVideo = Boolean.TRUE.equals(call.getBoolean("isVideo", false));
        CallForegroundService.startActiveCall(getContext(), callId, label, isVideo);
        call.resolve();
    }

    @PluginMethod
    public void stopActiveCall(PluginCall call) {
        CallForegroundService.stopActiveCall(getContext());
        call.resolve();
    }

    /**
     * Surfaces the system "allow app to ignore battery optimizations?"
     * dialog — the phoneCall foreground service alone isn't always enough on
     * OEMs with their own separate background-process freezer on top of
     * stock Android (Samsung's One UI "sleeping apps" battery manager, in
     * particular — it froze this app's process ~30s into a backgrounded call
     * even with the foreground service running, verified via on-device
     * logcat during development). No-ops (resolves immediately, no dialog)
     * if the app is already exempted, so repeat calls across multiple calls
     * in a session are harmless — call-foreground-native.ts additionally
     * only calls this once ever per install via a localStorage flag, since
     * Play policy expects this prompt not to be repeated once the user's
     * made a choice.
     */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        String packageName = context.getPackageName();
        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        boolean alreadyIgnoring = powerManager != null && powerManager.isIgnoringBatteryOptimizations(packageName);

        if (!alreadyIgnoring) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + packageName));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getActivity().startActivity(intent);
            } catch (ActivityNotFoundException e) {
                // Some OEM ROMs strip this intent action entirely — nothing
                // more to do natively; the user falls back to finding their
                // own OEM's equivalent settings screen manually.
            }
        }

        JSObject ret = new JSObject();
        ret.put("alreadyIgnoring", alreadyIgnoring);
        call.resolve(ret);
    }
}
