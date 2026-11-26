package com.yukon3t.app;

/**
 * Pure rules (plain JVM unit tests: IncomingRingStateTest) for one incoming-call UI at a time on Android, the native
 * half of src/lib/incoming-call-surface.ts. The in-app ring card (Decline / Message / Accept) is the ring UI whenever
 * it is on screen; the native ring (CallForegroundService's notification + ringtone) is the ring UI only while the app
 * is out of sight:
 *
 *  - a ring that arrives while the app is in the foreground is not raised natively; the page claims it once its card
 *    is on screen (CallForegroundPlugin.claimIncomingRing). If no claim comes within APP_CLAIM_GRACE_MS (the page is
 *    not loaded, offline, signed out...), the native ring is raised after all, so a call never goes unannounced;
 *  - a claim for a ring that is up natively silences it, but only while the app is in the foreground;
 *  - leaving the app (MainActivity.onPause) with the screen on while the call still rings raises the native ring; a
 *    pause because the screen went off (the power button, which silences a phone's ringer) does not;
 *  - coming back (onResume) to a claimed ring that is up natively silences it again, as the card is still there;
 *  - answered, declined, replied to, cancelled or out of time: the ring is over and never raised again.
 *
 * Thread-safe: rings arrive on the FCM thread, everything else on the main thread.
 */
final class IncomingRingState {

    enum Step {
        /** Nothing to do. */
        NONE,
        /** Show the native ring (notification + ringtone) for ringCallId(). */
        RAISE,
        /** Stop the native ring for ringCallId() (the in-app card is the ring UI). */
        SILENCE,
        /** The app is in the foreground: wait APP_CLAIM_GRACE_MS for its card, then call onClaimGraceOver. */
        WAIT_FOR_APP,
    }

    /** How long a ring counts as ringing: CallForegroundService.RING_TIMEOUT_MS (the server times out at 60s). */
    static final long RING_WINDOW_MS = 55_000;
    /** How long a ring that arrived in the foreground waits for the page's card before ringing natively anyway. */
    static final long APP_CLAIM_GRACE_MS = 3_000;

    private String callId;
    private String callerName;
    private boolean isVideo;
    private boolean canReply;
    private long receivedAtMs;
    private boolean claimed;
    private boolean systemRingUp;

    // A claim for a call whose push hasn't arrived yet (the realtime signal can beat FCM).
    private String earlyClaimId;
    private long earlyClaimAtMs;

    synchronized Step onRingArrived(
        String callId,
        String callerName,
        boolean isVideo,
        boolean canReply,
        long nowMs,
        boolean appInForeground
    ) {
        if (callId == null) return Step.NONE;
        if (callId.equals(this.callId) && isRinging(nowMs)) {
            // A repeated push for the ring already known.
            if (!appInForeground && !systemRingUp) {
                systemRingUp = true;
                return Step.RAISE;
            }
            return Step.NONE;
        }
        this.callId = callId;
        this.callerName = callerName;
        this.isVideo = isVideo;
        this.canReply = canReply;
        this.receivedAtMs = nowMs;
        this.claimed = callId.equals(earlyClaimId) && nowMs - earlyClaimAtMs < RING_WINDOW_MS;
        this.systemRingUp = false;
        earlyClaimId = null;
        if (!appInForeground) {
            systemRingUp = true;
            return Step.RAISE;
        }
        return claimed ? Step.NONE : Step.WAIT_FOR_APP;
    }

    /** APP_CLAIM_GRACE_MS after a ring arrived in the foreground. */
    synchronized Step onClaimGraceOver(String callId, long nowMs) {
        if (!matches(callId) || !isRinging(nowMs) || claimed || systemRingUp) return Step.NONE;
        systemRingUp = true;
        return Step.RAISE;
    }

    /** The page's ring card for this call is on screen. */
    synchronized Step onAppClaimed(String callId, long nowMs, boolean appInForeground) {
        if (callId == null) return Step.NONE;
        if (!matches(callId) || !isRinging(nowMs)) {
            earlyClaimId = callId;
            earlyClaimAtMs = nowMs;
            return Step.NONE;
        }
        claimed = true;
        // A claim from a page still running in the background must not silence the only visible ring.
        if (appInForeground && systemRingUp) {
            systemRingUp = false;
            return Step.SILENCE;
        }
        return Step.NONE;
    }

    /** MainActivity.onPause. `screenInteractive`: false when the pause is the screen going off. */
    synchronized Step onAppLeft(long nowMs, boolean screenInteractive) {
        if (!isRinging(nowMs) || systemRingUp || !screenInteractive) return Step.NONE;
        systemRingUp = true;
        return Step.RAISE;
    }

    /** MainActivity.onResume. */
    synchronized Step onAppReturned(long nowMs) {
        if (!isRinging(nowMs) || !claimed || !systemRingUp) return Step.NONE;
        systemRingUp = false;
        return Step.SILENCE;
    }

    /**
     * The notification's Message action: the app opens on the reply panel, so the native ring stops, but the call is
     * still ringing (not declined) and comes back natively if the app is left before a reply is sent.
     */
    synchronized void onReplyOpened(String callId, long nowMs) {
        if (!matches(callId) || !isRinging(nowMs)) return;
        claimed = true;
        systemRingUp = false;
    }

    /** The ring is over: answered, declined, replied to, cancelled, missed, or the page let go of it. */
    synchronized void onResolved(String callId) {
        if (callId != null && callId.equals(earlyClaimId)) earlyClaimId = null;
        if (!matches(callId)) return;
        this.callId = null;
        claimed = false;
        systemRingUp = false;
    }

    synchronized String ringCallId() {
        return callId;
    }

    synchronized String ringCallerName() {
        return callerName;
    }

    synchronized boolean ringIsVideo() {
        return isVideo;
    }

    synchronized boolean ringCanReply() {
        return canReply;
    }

    private boolean matches(String id) {
        return id != null && id.equals(callId);
    }

    private boolean isRinging(long nowMs) {
        return callId != null && nowMs >= receivedAtMs && nowMs - receivedAtMs < RING_WINDOW_MS;
    }
}
