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
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

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

    // Only used for the two Log.e calls below (unexpected failures) — kept
    // deliberately sparse. The app-wide-crash fix means a failure here now
    // degrades silently instead of crashing, which is safer but would
    // otherwise leave a real regression completely unobservable.
    private static final String TAG = "YuKon3tCall";

    private static final String CHANNEL_ID = "incoming_calls";
    private static final String ACTIVE_CALL_CHANNEL_ID = "active_call";
    private static final String MISSED_CALL_CHANNEL_ID = "missed_calls";
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

    /**
     * Posted directly via NotificationManagerCompat rather than going through
     * the foreground-service start/stop machinery above — unlike ringing/
     * active-call, a missed call isn't an ongoing state that needs to keep
     * the process Doze-exempt, it's a one-shot "here's what you missed"
     * notification, same as a real phone app. Reuses the ringing
     * notification's id (notificationId(callId)) so if that's somehow still
     * showing for this call, this replaces it instead of stacking.
     */
    static void showMissedCallNotification(Context context, String callId, String callerName) {
        ensureMissedCallChannel(context);

        Intent viewIntent = new Intent(context, MainActivity.class);
        viewIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            notificationId(callId),
            viewIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(context, MISSED_CALL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Missed call")
            .setContentText(callerName + " called you")
            .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .build();

        NotificationManagerCompat.from(context).notify(notificationId(callId), notification);
    }

    private static void ensureMissedCallChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(MISSED_CALL_CHANNEL_ID) != null) return;

        // Default importance with the channel's normal notification sound —
        // unlike the ringing channel, this shouldn't play the loud ringtone,
        // the call is already over.
        NotificationChannel channel = new NotificationChannel(
            MISSED_CALL_CHANNEL_ID,
            "Missed calls",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Shown when a voice or video call you didn't answer ends");
        manager.createNotificationChannel(channel);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Last-resort safety net: an uncaught exception anywhere below
        // crashes the whole app process, not just this service — Android
        // version upgrades have repeatedly tightened foreground-service/
        // notification enforcement (stricter startForeground() timing and
        // type-matching checks, SecurityExceptions for previously-tolerated
        // patterns) in ways that only surface at runtime on the newer OS, not
        // at compile/lint time. Ringing is best-effort in the first place —
        // the in-app call UI (call-button.tsx) already has its own
        // JS-side handling of an incoming call, so failing to show this
        // native notification should degrade the ring, not kill the app.
        try {
            return handleStartCommand(intent);
        } catch (Throwable t) {
            Log.e(TAG, "onStartCommand threw — degrading instead of crashing", t);
            stopSelfCleanly();
            return START_NOT_STICKY;
        }
    }

    private int handleStartCommand(Intent intent) {
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

        PendingIntent acceptIntent = actionIntent(callId, "accept");
        PendingIntent declineIntent = actionIntent(callId, "decline");

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

        startForegroundSafely(FOREGROUND_NOTIFICATION_ID, notification);
        // Also posted under its own (callId-derived) id so MainActivity's
        // deep-link handler and CallMessagingService's cancel-on-
        // call_cancelled path can target this specific call's notification
        // directly.
        NotificationManagerCompat.from(this).notify(notificationId(callId), notification);
    }

    /**
     * startForeground() with a foreground service type is where Android has
     * repeatedly tightened runtime enforcement release over release —
     * mismatched/unsupported type checks, timing checks, and
     * ForegroundServiceStartNotAllowedException (API 31+) can all throw here
     * in ways that weren't previously enforced, on OS versions newer than
     * whatever this was last verified against. If that happens, still post
     * the notification (via NotificationManagerCompat, in the two call sites
     * above/below) rather than crash the whole app — the ring/call-in-progress
     * alert only loses its Doze/App-Standby exemption, it doesn't disappear.
     */
    private void startForegroundSafely(int id, Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
            } else {
                startForeground(id, notification);
            }
        } catch (Throwable t) {
            Log.e(TAG, "startForeground threw for id=" + id + " — falling back to a plain notification", t);
            NotificationManagerCompat.from(this).notify(id, notification);
        }
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

        startForegroundSafely(ACTIVE_CALL_NOTIFICATION_ID, notification);
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

    /**
     * Launches MainActivity directly with the accept/decline deep link,
     * rather than routing through a BroadcastReceiver that then calls
     * context.startActivity() itself (the previous CallActionReceiver
     * design). That indirection is a known-flaky pattern on Android:
     * launching an Activity from inside a BroadcastReceiver's onReceive
     * relies on a background-activity-launch exemption carrying over
     * through the extra hop, and on-device testing (this device, Samsung/
     * Android 16) showed it intermittently doing nothing at all — no
     * exception, no log, the tap simply didn't open the app. A notification
     * action's PendingIntent.getActivity() is the same first-class,
     * always-allowed launch path as tapping the notification body (which
     * already worked reliably), so this removes the flaky step instead of
     * working around it. MainActivity.onCreate/onNewIntent now does the
     * immediate stop-ringing/cancel-notification work CallActionReceiver
     * used to do, so behavior is otherwise unchanged.
     */
    private PendingIntent actionIntent(String callId, String action) {
        Uri uri = Uri.parse("yukon3t://call?callId=" + Uri.encode(callId) + "&action=" + action);
        Intent intent = new Intent(Intent.ACTION_VIEW, uri, this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int requestCode = (callId + action).hashCode();
        return PendingIntent.getActivity(
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
            // Some OEM ROMs/profiles return null here (no default ringtone
            // set) — setDataSource(context, null) throws an unchecked
            // NullPointerException, not IOException/IllegalStateException,
            // so this was previously uncaught and would crash the service.
            if (ringtoneUri == null) return;
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
        } catch (Exception e) {
            // Best-effort — the notification's own channel sound (set in
            // ensureChannel) still plays once even if this loop fails to
            // start, so a ring is never fully silent. Catches broadly
            // (not just IOException/IllegalStateException) since MediaPlayer
            // can also throw SecurityException/IllegalArgumentException
            // depending on OEM/Android version.
            Log.e(TAG, "startRingtone failed, falling back to the channel's own sound", e);
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
