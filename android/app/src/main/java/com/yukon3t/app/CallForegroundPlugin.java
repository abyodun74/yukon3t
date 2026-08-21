package com.yukon3t.app;

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
}
