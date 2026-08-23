package com.yukon3t.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate() — that's where BridgeActivity
        // actually builds the Bridge from the plugin list accumulated so far.
        registerPlugin(CallForegroundPlugin.class);
        super.onCreate(savedInstanceState);
        handleCallDeepLink(getIntent());
    }

    // singleTask launch mode (see AndroidManifest.xml) redelivers an
    // already-running Activity's new launch intent here instead of a fresh
    // onCreate — this is the path a notification tap takes while the app is
    // already alive. Capacitor's own BridgeActivity.onNewIntent is what
    // fires the "appUrlOpen" event incoming-call-listener.tsx listens for;
    // calling super first preserves that unchanged.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleCallDeepLink(intent);
    }

    /**
     * Stops the native ring (service + sound) and dismisses its notification
     * the instant the incoming-call notification's Accept/Decline action
     * opens this Activity — previously done by CallActionReceiver, a
     * BroadcastReceiver that called context.startActivity() itself. That
     * indirection turned out to be unreliable on-device (Samsung/Android
     * 16): a background-activity-launch exemption not reliably carrying
     * through the extra broadcast hop, so the tap sometimes silently did
     * nothing. The notification's Accept/Decline PendingIntents now launch
     * this Activity directly (CallForegroundService.actionIntent), the same
     * always-allowed path a plain notification-body tap already used, and
     * this replicates the rest of what the receiver used to do.
     */
    private void handleCallDeepLink(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri uri = intent.getData();
        if (!"yukon3t".equals(uri.getScheme()) || !"call".equals(uri.getHost())) return;

        String callId = uri.getQueryParameter("callId");
        String action = uri.getQueryParameter("action");
        if (callId == null || action == null) return;
        if (!"accept".equals(action) && !"decline".equals(action)) return;

        NotificationManagerCompat.from(this).cancel(CallForegroundService.notificationId(callId));
        CallForegroundService.stopRinging(this, callId);
    }
}
