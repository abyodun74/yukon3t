package com.yukon3t.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

/**
 * Android glue for IncomingRingState (see its doc comment): one incoming-call UI at a time. Every path that learns
 * something about a ring reports it here (CallMessagingService: a ring arrived / was cancelled / missed;
 * MainActivity: the app was left or came back, a notification action was tapped; CallForegroundPlugin: the page's
 * ring card is on screen / gone; CallForegroundService: a call was joined), and this raises or silences
 * CallForegroundService's ring as the rules say. Never throws: a failure here degrades the ring, never the app.
 */
final class IncomingRing {

    private IncomingRing() {}

    private static final String TAG = "YuKon3tCall";
    private static final IncomingRingState STATE = new IncomingRingState();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    /** An incoming_call push (FCM thread). */
    static void arrived(Context context, String callId, String callerName, boolean isVideo, boolean canReply) {
        Context app = context.getApplicationContext();
        IncomingRingState.Step step =
            STATE.onRingArrived(callId, callerName, isVideo, canReply, now(), MainActivity.isInForeground());
        if (step == IncomingRingState.Step.WAIT_FOR_APP) {
            MAIN.postDelayed(
                () -> apply(app, STATE.onClaimGraceOver(callId, now())),
                IncomingRingState.APP_CLAIM_GRACE_MS
            );
            return;
        }
        apply(app, step);
    }

    /** The page's ring card for this call is on screen. */
    static void claimed(Context context, String callId) {
        apply(context.getApplicationContext(), STATE.onAppClaimed(callId, now(), MainActivity.isInForeground()));
    }

    /** The ring is over (answered, declined, replied to, cancelled, missed, or the page's card for it is gone). */
    static void resolved(String callId) {
        STATE.onResolved(callId);
    }

    /** The notification's Message action opened the app on the reply panel (MainActivity stops the native ring). */
    static void replyOpened(String callId) {
        STATE.onReplyOpened(callId, now());
    }

    /** MainActivity.onPause. */
    static void appLeft(Context context, boolean screenInteractive) {
        apply(context.getApplicationContext(), STATE.onAppLeft(now(), screenInteractive));
    }

    /** MainActivity.onResume. */
    static void appReturned(Context context) {
        apply(context.getApplicationContext(), STATE.onAppReturned(now()));
    }

    private static void apply(Context app, IncomingRingState.Step step) {
        String callId = STATE.ringCallId();
        if (callId == null) return;
        try {
            if (step == IncomingRingState.Step.RAISE) {
                CallForegroundService.startRinging(
                    app,
                    callId,
                    STATE.ringCallerName(),
                    STATE.ringIsVideo(),
                    STATE.ringCanReply()
                );
            } else if (step == IncomingRingState.Step.SILENCE) {
                CallForegroundService.cancelRingingNotification(app, callId);
                CallForegroundService.stopRinging(app, callId);
            }
        } catch (Throwable t) {
            Log.e(TAG, "incoming ring " + step + " failed", t);
        }
    }

    private static long now() {
        return SystemClock.elapsedRealtime();
    }
}
