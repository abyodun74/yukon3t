package com.yukon3t.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import java.io.IOException;

/**
 * Keeps the process alive and Doze-exempt while a call is ringing, so the
 * ring isn't silently delayed/killed if the phone is asleep — foreground
 * services with a declared type get their own Doze/App Standby exemption.
 * Owns the actual incoming-call notification (full-screen intent + Accept/
 * Decline actions) since a foreground service must post one anyway; started
 * by CallMessagingService.startRinging() when an "incoming_call" push
 * arrives, stopped on decline/cancel/timeout — see stopRinging() and the
 * no-answer timeout below.
 *
 * Also covers the full duration of an accepted/joined call, not just the
 * ringing window: CallForegroundPlugin.startActiveCall()/stopActiveCall()
 * (called from src/lib/call-session.tsx on session start/end) drives a
 * second, separate notification ("Call in progress") so the process stays
 * Doze-exempt while the user backgrounds the app or navigates elsewhere
 * inside it mid-call — the WebView/Daily call itself keeps running either
 * way, this only stops Android from deprioritizing/killing the process out
 * from under it.
 */
public class CallForegroundService extends Service {

    private static final String CHANNEL_ID = "incoming_calls";
    private static final String ACTIVE_CALL_CHANNEL_ID = "active_call";
    private static final int FOREGROUND_NOTIFICATION_ID = 9001;
    private static final int ACTIVE_CALL_NOTIFICATION_ID = 9002;
    // Safety net: if nobody answers or declines, stop ringing natively
    // rather than holding the foreground service/wake indefinitely. The
    // in-app call UI (call-button.tsx) treats an unanswered call similarly
    // on its own timeline; this just bounds the native side.
    private static final long RING_TIMEOUT_MS = 55_000;

    private static final String ACTION_START_RINGING = "com.yukon3t.app.action.START_RINGING";
    private static final String ACTION_STOP_RINGING = "com.yukon3t.app.action.STOP_RINGING";
    private static final String ACTION_START_ACTIVE_CALL = "com.yukon3t.app.action.START_ACTIVE_CALL";
    private static final String ACTION_STOP_ACTIVE_CALL = "com.yukon3t.app.action.STOP_ACTIVE_CALL";
    private static final String EXTRA_CALL_ID = "callId";
    private static final String EXTRA_CALLER_NAME = "callerName";
    private static final String EXTRA_LABEL = "label";
    private static final String EXTRA_IS_VIDEO = "isVideo";

    // Which of the two notifications (they're mutually exclusive in
    // practice — a call is either ringing or answered, never both) is
    // currently holding this service in the foreground, so stopRinging()
    // and stopActiveCall() each only ever tear down their own.
    private enum Mode {
        NONE,
        RINGING,
        ACTIVE_CALL,
    }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeoutRunnable = this::stopSelfCleanly;
    private MediaPlayer ringtonePlayer;
    private String activeCallId;
    private Mode mode = Mode.NONE;

    public static void startRinging(Context context, String callId, String callerName, boolean isVideo) {
        Intent intent = new Intent(context, CallForegroundService.class)
            .setAction(ACTION_START_RINGING)
            .putExtra(EXTRA_CALL_ID, callId)
            .putExtra(EXTRA_CALLER_NAME, callerName)
            .putExtra(EXTRA_IS_VIDEO, isVideo);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stopRinging(Context context, String callId) {
        Intent intent = new Intent(context, CallForegroundService.class)
            .setAction(ACTION_STOP_RINGING)
            .putExtra(EXTRA_CALL_ID, callId);
        context.startService(intent);
    }

    /** Called by CallForegroundPlugin.startActiveCall() once a call/live-stream
     * session actually joins (see call-session.tsx's startSession) — distinct
     * from startRinging(), which only covers the pre-answer ring. */
    public static void startActiveCall(Context context, String callId, String label, boolean isVideo) {
        Intent intent = new Intent(context, CallForegroundService.class)
            .setAction(ACTION_START_ACTIVE_CALL)
            .putExtra(EXTRA_CALL_ID, callId)
            .putExtra(EXTRA_LABEL, label)
            .putExtra(EXTRA_IS_VIDEO, isVideo);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stopActiveCall(Context context) {
        Intent intent = new Intent(context, CallForegroundService.class).setAction(ACTION_STOP_ACTIVE_CALL);
        context.startService(intent);
    }

    static int notificationId(String callId) {
        return callId.hashCode();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelfCleanly();
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        String callId = intent.getStringExtra(EXTRA_CALL_ID);

        if (ACTION_STOP_RINGING.equals(action)) {
            // Ignore a stale cancel for a call we've already moved past
            // (e.g. a second ring started before this stop was processed),
            // and don't clobber an active-call notification that's since
            // taken over this same service instance.
            if (mode == Mode.RINGING && (activeCallId == null || activeCallId.equals(callId))) {
                stopSelfCleanly();
            }
            return START_NOT_STICKY;
        }

        if (ACTION_STOP_ACTIVE_CALL.equals(action)) {
            if (mode == Mode.ACTIVE_CALL) {
                stopSelfCleanly();
            }
            return START_NOT_STICKY;
        }

        if (ACTION_START_ACTIVE_CALL.equals(action)) {
            // A call answered from inside the app supersedes any ringing
            // notification for the same call — clear it before switching
            // modes rather than leaving a stale "Incoming call" notif
            // sitting alongside "Call in progress".
            stopRingtone();
            handler.removeCallbacks(timeoutRunnable);
            mode = Mode.ACTIVE_CALL;
            activeCallId = callId;
            String label = intent.getStringExtra(EXTRA_LABEL);
            boolean isVideo = intent.getBooleanExtra(EXTRA_IS_VIDEO, false);
            showActiveCallNotification(label != null ? label : "Call", isVideo);
            return START_NOT_STICKY;
        }

        if (callId == null) {
            stopSelfCleanly();
            return START_NOT_STICKY;
        }

        mode = Mode.RINGING;
        activeCallId = callId;
        String callerName = intent.getStringExtra(EXTRA_CALLER_NAME);
        boolean isVideo = intent.getBooleanExtra(EXTRA_IS_VIDEO, false);
        showRingingNotification(callId, callerName != null ? callerName : "Someone", isVideo);
        startRingtone();

        handler.removeCallbacks(timeoutRunnable);
        handler.postDelayed(timeoutRunnable, RING_TIMEOUT_MS);

        return START_NOT_STICKY;
    }

    private void showRingingNotification(String callId, String callerName, boolean isVideo) {
        ensureChannel();

        Intent viewIntent = new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("yukon3t://call?callId=" + Uri.encode(callId)),
            this,
            MainActivity.class
        );
        viewIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            notificationId(callId),
            viewIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent acceptIntent = actionIntent(callId, CallActionReceiver.ACTION_ACCEPT);
        PendingIntent declineIntent = actionIntent(callId, CallActionReceiver.ACTION_DECLINE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(isVideo ? "Incoming video call" : "Incoming call")
            .setContentText(callerName + " is calling you")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(contentIntent)
            .setFullScreenIntent(contentIntent, true)
            .addAction(0, "Decline", declineIntent)
            .addAction(0, "Accept", acceptIntent)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(FOREGROUND_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
        } else {
            startForeground(FOREGROUND_NOTIFICATION_ID, notification);
        }
        // Also posted under its own (callId-derived) id so CallActionReceiver
        // and CallMessagingService's cancel-on-call_cancelled path can target
        // this specific call's notification directly.
        NotificationManagerCompat.from(this).notify(notificationId(callId), notification);
    }

    private void showActiveCallNotification(String label, boolean isVideo) {
        ensureActiveCallChannel();

        // Plain "bring the app to the foreground" tap target — unlike the
        // ringing notification, there's no specific deep-link payload to
        // carry (the call is already joined; call-session.tsx/
        // global-call-frame.tsx already hold the live session state).
        Intent viewIntent = new Intent(this, MainActivity.class);
        viewIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            ACTIVE_CALL_NOTIFICATION_ID,
            viewIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, ACTIVE_CALL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(isVideo ? "Video call in progress" : "Call in progress")
            .setContentText(label)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(contentIntent)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ACTIVE_CALL_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
        } else {
            startForeground(ACTIVE_CALL_NOTIFICATION_ID, notification);
        }
    }

    private void ensureActiveCallChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(ACTIVE_CALL_CHANNEL_ID) != null) return;

        // Low importance, no sound/vibration — unlike the ringing channel,
        // this notification isn't announcing anything new, it's just the
        // mandatory "ongoing foreground service" indicator, so it shouldn't
        // interrupt the call itself with any sound of its own.
        NotificationChannel channel = new NotificationChannel(
            ACTIVE_CALL_CHANNEL_ID,
            "Ongoing call",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shown while a voice or video call is in progress, so it can keep running in the background");
        manager.createNotificationChannel(channel);
    }

    private PendingIntent actionIntent(String callId, String action) {
        Intent intent = new Intent(this, CallActionReceiver.class)
            .setAction(action)
            .putExtra(EXTRA_CALL_ID, callId);
        int requestCode = (callId + action).hashCode();
        return PendingIntent.getBroadcast(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Incoming calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Ringing notifications for incoming voice and video calls");
        channel.enableVibration(true);
        channel.setBypassDnd(false);
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), audioAttributes);
        manager.createNotificationChannel(channel);
    }

    private void startRingtone() {
        stopRingtone();
        try {
            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            MediaPlayer player = new MediaPlayer();
            player.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );
            player.setDataSource(this, ringtoneUri);
            player.setLooping(true);
            player.prepare();
            player.start();
            ringtonePlayer = player;
        } catch (IOException | IllegalStateException e) {
            // Best-effort — the notification's own channel sound (set in
            // ensureChannel) still plays once even if this loop fails to
            // start, so a ring is never fully silent.
            ringtonePlayer = null;
        }
    }

    private void stopRingtone() {
        if (ringtonePlayer == null) return;
        try {
            if (ringtonePlayer.isPlaying()) ringtonePlayer.stop();
        } catch (IllegalStateException ignored) {
            // Already stopped/released.
        }
        ringtonePlayer.release();
        ringtonePlayer = null;
    }

    private void stopSelfCleanly() {
        handler.removeCallbacks(timeoutRunnable);
        stopRingtone();
        activeCallId = null;
        mode = Mode.NONE;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(timeoutRunnable);
        stopRingtone();
        super.onDestroy();
    }
}
