package com.yukon3t.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.core.app.NotificationManagerCompat;

/**
 * Handles the Accept/Decline actions on the incoming-call notification
 * (CallForegroundService). Stops the ringing service/notification natively
 * first (so the ring/vibration cuts immediately on tap, not whenever
 * MainActivity/JS gets around to it), then hands off to the existing
 * accept/decline flow already built in incoming-call-listener.tsx by
 * launching MainActivity with a yukon3t://call deep link — see that file's
 * appUrlOpen/getLaunchUrl handler, which calls the same respondToCall()
 * server action the in-app Accept/Decline buttons use.
 */
public class CallActionReceiver extends BroadcastReceiver {

    static final String ACTION_ACCEPT = "com.yukon3t.app.action.CALL_ACCEPT";
    static final String ACTION_DECLINE = "com.yukon3t.app.action.CALL_DECLINE";
    private static final String EXTRA_CALL_ID = "callId";

    @Override
    public void onReceive(Context context, Intent intent) {
        String callId = intent.getStringExtra(EXTRA_CALL_ID);
        if (callId == null) return;

        NotificationManagerCompat.from(context).cancel(CallForegroundService.notificationId(callId));
        CallForegroundService.stopRinging(context, callId);

        String action = ACTION_ACCEPT.equals(intent.getAction()) ? "accept" : "decline";
        Uri uri = Uri.parse("yukon3t://call?callId=" + Uri.encode(callId) + "&action=" + action);
        Intent launch = new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(launch);
    }
}
