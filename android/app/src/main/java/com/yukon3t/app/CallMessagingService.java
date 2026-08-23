package com.yukon3t.app;

import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Handles the data-only FCM messages sendFcmCallToUser/sendFcmCallCancelToUser
 * (src/lib/fcm.ts) send for incoming/cancelled calls, so a ring still
 * surfaces while the app is backgrounded or the device is asleep/in Doze —
 * the whole reason those messages are sent with android priority "high"
 * instead of relying on the WebView's JS polling (incoming-call-listener.tsx),
 * which is throttled/frozen in that state.
 *
 * Declared as a second <service> in AndroidManifest.xml alongside
 * @capacitor-firebase/messaging's own MessagingService, which only drives
 * token issuance/JS listeners (capacitor-bridge.tsx) and has no call-specific
 * handling. Actually building/showing the ring notification is
 * CallForegroundService's job (it needs to be the one holding the
 * foreground-service-backed notification anyway), so this class only
 * decides *whether* to start/stop it.
 */
public class CallMessagingService extends FirebaseMessagingService {

    // Only used for the Log.e call below (an unexpected failure) — see
    // CallForegroundService's own TAG field for why this stays sparse.
    private static final String TAG = "YuKon3tCall";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        // An uncaught exception here crashes the whole app process, not just
        // this push handler — same reasoning as CallForegroundService's own
        // top-level try/catch. A missed ring is recoverable (the caller's
        // side still times out normally); a crashed app is not.
        try {
            handleMessageReceived(remoteMessage);
        } catch (Throwable t) {
            Log.e(TAG, "onMessageReceived threw", t);
        }
    }

    private void handleMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String type = data.get("type");
        if (type == null) return;

        String callId = data.get("callId");
        if (callId == null) return;

        if ("incoming_call".equals(type)) {
            String callerName = data.get("callerName");
            String callType = data.get("callType");
            CallForegroundService.startRinging(
                this,
                callId,
                callerName != null ? callerName : "Someone",
                "VIDEO".equals(callType)
            );
        } else if ("call_cancelled".equals(type)) {
            // Defensive: stopping the service already removes its
            // notification, but cancel directly too in case the service
            // somehow isn't running for this call (e.g. process was killed
            // and restarted between the two pushes).
            NotificationManagerCompat.from(this).cancel(CallForegroundService.notificationId(callId));
            CallForegroundService.stopRinging(this, callId);
        }
    }
}
