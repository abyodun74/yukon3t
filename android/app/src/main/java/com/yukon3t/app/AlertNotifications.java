package com.yukon3t.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.google.firebase.messaging.RemoteMessage;
import io.capawesome.capacitorjs.plugins.firebase.messaging.FirebaseMessagingPlugin;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Ordinary (non-call) FCM notifications while the app is OPEN.
 *
 * An FCM message with a `notification` block is drawn by the Firebase SDK
 * itself only while the app is in the background or killed. While the app is
 * in the foreground the SDK hands it to CallMessagingService.onMessageReceived
 * instead and shows nothing, so on Android a new message, like or comment
 * only updated the in-app bell. This posts the same notification the SDK
 * would have posted in the background: same channel (yk_alerts, heads-up
 * banner + sound; quiet_reminders for a quiet one), same tag (the server's
 * replacement key, push-replace.ts, so a later push with that key replaces
 * it, and nothing is ever shown twice), and a tap that opens MainActivity
 * with the message's data as extras plus google.message_id, exactly what the
 * SDK's own notification does, so @capacitor-firebase/messaging raises
 * notificationActionPerformed and capacitor-bridge.tsx opens `data.url`.
 *
 * Not shown: without notification permission (Android 13+ POST_NOTIFICATIONS,
 * or notifications turned off for the app), for a message id already shown,
 * and while the page on screen is the notification's own target (the chat the
 * message is in): see ForegroundAlertPolicy.isSameScreen.
 */
final class AlertNotifications {

    private AlertNotifications() {}

    private static final String TAG = "YuKon3tAlert";

    /** Recently shown message ids: FCM can deliver the same message twice. */
    private static final int RECENT_IDS = 50;
    private static final Map<String, Boolean> recentMessageIds = new LinkedHashMap<String, Boolean>(64, 0.75f, false) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
            return size() > RECENT_IDS;
        }
    };

    private static final AtomicInteger requestCodes = new AtomicInteger((int) (SystemClock.uptimeMillis() & 0x3fffffff));

    /**
     * Creates the two channels ordinary notifications use, with the same ids
     * and importance capacitor-bridge.tsx creates them with (alert-push.ts,
     * quiet-push.ts). Android fixes a channel's importance and sound at its
     * first creation, so whichever side creates it first, the behaviour is the
     * same; the JS side later renames it into the app's language. Before this
     * ran, a device whose WebView hadn't created yk_alerts yet got Firebase's
     * fallback "Miscellaneous" channel (no banner).
     */
    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager == null) return;
            if (manager.getNotificationChannel(ForegroundAlertPolicy.ALERT_CHANNEL_ID) == null) {
                NotificationChannel alerts = new NotificationChannel(
                    ForegroundAlertPolicy.ALERT_CHANNEL_ID,
                    context.getString(R.string.alert_channel_name),
                    NotificationManager.IMPORTANCE_HIGH
                );
                alerts.setDescription(context.getString(R.string.alert_channel_description));
                // alert-push.ts ALERT_NOTIFICATION_CHANNEL_VISIBILITY (0).
                alerts.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
                alerts.enableVibration(true);
                alerts.enableLights(true);
                manager.createNotificationChannel(alerts);
            }
            if (manager.getNotificationChannel(ForegroundAlertPolicy.QUIET_CHANNEL_ID) == null) {
                NotificationChannel quiet = new NotificationChannel(
                    ForegroundAlertPolicy.QUIET_CHANNEL_ID,
                    context.getString(R.string.quiet_channel_name),
                    NotificationManager.IMPORTANCE_LOW
                );
                quiet.setDescription(context.getString(R.string.quiet_channel_description));
                quiet.enableVibration(false);
                quiet.enableLights(false);
                quiet.setSound(null, null);
                manager.createNotificationChannel(quiet);
            }
        } catch (Throwable t) {
            Log.e(TAG, "creating notification channels failed", t);
        }
    }

    /** Called from CallMessagingService for a message that carries a `notification` block. */
    static void showWhileOpen(@NonNull Context context, @NonNull RemoteMessage message) {
        RemoteMessage.Notification n = message.getNotification();
        if (n == null) return;
        final Context app = context.getApplicationContext();
        if (!canPost(app)) return;

        String messageId = message.getMessageId();
        if (messageId != null && !markShown(messageId)) return;

        final Map<String, String> data = message.getData();
        final String url = data.get("url");
        final String channelId = ForegroundAlertPolicy.channelFor(n.getChannelId());
        final String tag = ForegroundAlertPolicy.tagFor(n.getTag(), String.valueOf(SystemClock.uptimeMillis()));
        final String title = n.getTitle();
        final String body = n.getBody();
        if ((title == null || title.isEmpty()) && (body == null || body.isEmpty())) return;
        final String tapId = messageId != null ? messageId : tag;

        // The WebView may only be read on the main thread; the post happens
        // there too (NotificationManager is thread-safe either way).
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                if (MainActivity.isInForeground() && ForegroundAlertPolicy.isSameScreen(currentPageUrl(), url)) return;
                post(app, channelId, tag, title, body, data, tapId);
            } catch (Throwable t) {
                Log.e(TAG, "showing a notification failed", t);
            }
        });
    }

    private static boolean canPost(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    private static synchronized boolean markShown(String messageId) {
        if (recentMessageIds.containsKey(messageId)) return false;
        recentMessageIds.put(messageId, Boolean.TRUE);
        return true;
    }

    private static String currentPageUrl() {
        Bridge bridge = FirebaseMessagingPlugin.staticBridge;
        if (bridge == null) return null;
        WebView webView = bridge.getWebView();
        return webView != null ? webView.getUrl() : null;
    }

    @SuppressWarnings("MissingPermission") // canPost() checked POST_NOTIFICATIONS
    private static void post(
        Context context,
        String channelId,
        String tag,
        String title,
        String body,
        Map<String, String> data,
        String tapId
    ) {
        ensureChannels(context);

        // The same shape as the Firebase SDK's own notification tap: the
        // message's data as extras plus google.message_id, which is what
        // FirebaseMessagingPlugin.handleOnNewIntent looks for.
        Intent tap = new Intent(context, MainActivity.class);
        tap.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        for (Map.Entry<String, String> entry : data.entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null) tap.putExtra(entry.getKey(), entry.getValue());
        }
        tap.putExtra("google.message_id", tapId);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            requestCodes.incrementAndGet(),
            tap,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        boolean quiet = ForegroundAlertPolicy.QUIET_CHANNEL_ID.equals(channelId);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true);
        if (title != null && !title.isEmpty()) builder.setContentTitle(title);
        if (body != null && !body.isEmpty()) {
            builder.setContentText(body);
            builder.setStyle(new NotificationCompat.BigTextStyle().bigText(body));
        }
        if (quiet) {
            // Android 7 and older have no channels: this keeps it silent there.
            builder.setPriority(NotificationCompat.PRIORITY_LOW).setSilent(true);
        } else {
            // Android 7 and older: heads-up banner, sound and vibration.
            builder.setPriority(NotificationCompat.PRIORITY_HIGH).setDefaults(NotificationCompat.DEFAULT_ALL);
        }

        // Id 0 under the tag, as Firebase's own display does, so a push with
        // the same replacement key replaces this one whether it arrives
        // while the app is open or in the background.
        NotificationManagerCompat.from(context).notify(tag, 0, builder.build());
    }
}
