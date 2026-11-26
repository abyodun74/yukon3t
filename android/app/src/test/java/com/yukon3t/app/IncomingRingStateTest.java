package com.yukon3t.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.yukon3t.app.IncomingRingState.Step;

import org.junit.Before;
import org.junit.Test;

public class IncomingRingStateTest {

    private static final long T0 = 1_000_000;
    private IncomingRingState state;

    @Before
    public void setUp() {
        state = new IncomingRingState();
    }

    private Step arriveInBackground() {
        return state.onRingArrived("c1", "Ana", true, true, T0, false);
    }

    private Step arriveInForeground() {
        return state.onRingArrived("c1", "Ana", true, true, T0, true);
    }

    @Test
    public void ringsNativelyWhenTheAppIsOutOfSight() {
        assertEquals(Step.RAISE, arriveInBackground());
        assertEquals("c1", state.ringCallId());
        assertEquals("Ana", state.ringCallerName());
        assertTrue(state.ringIsVideo());
        assertTrue(state.ringCanReply());
    }

    @Test
    public void neverRaisesTheNativeRingOverTheAppsOwnCard() {
        assertEquals(Step.WAIT_FOR_APP, arriveInForeground());
        assertEquals(Step.NONE, state.onAppClaimed("c1", T0 + 500, true));
        assertEquals(Step.NONE, state.onClaimGraceOver("c1", T0 + IncomingRingState.APP_CLAIM_GRACE_MS));
        assertEquals(Step.NONE, state.onAppReturned(T0 + 4_000));
    }

    @Test
    public void ringsNativelyAfterAllWhenTheCardNeverComes() {
        assertEquals(Step.WAIT_FOR_APP, arriveInForeground());
        assertEquals(Step.RAISE, state.onClaimGraceOver("c1", T0 + IncomingRingState.APP_CLAIM_GRACE_MS));
        // A late card then takes over.
        assertEquals(Step.SILENCE, state.onAppClaimed("c1", T0 + 5_000, true));
    }

    @Test
    public void aClaimThatBeatThePushKeepsTheNativeRingDown() {
        assertEquals(Step.NONE, state.onAppClaimed("c1", T0 - 300, true));
        assertEquals(Step.NONE, arriveInForeground());
        assertEquals(Step.NONE, state.onClaimGraceOver("c1", T0 + IncomingRingState.APP_CLAIM_GRACE_MS));
    }

    @Test
    public void anEarlyClaimStillRingsNativelyWhenTheAppIsOutOfSight() {
        state.onAppClaimed("c1", T0 - 300, true);
        assertEquals(Step.RAISE, arriveInBackground());
    }

    @Test
    public void theCardSilencesARingThatCameInTheBackground() {
        arriveInBackground();
        assertEquals(Step.SILENCE, state.onAppClaimed("c1", T0 + 2_000, true));
    }

    @Test
    public void aClaimFromAPageRunningInTheBackgroundSilencesNothing() {
        arriveInBackground();
        assertEquals(Step.NONE, state.onAppClaimed("c1", T0 + 1_000, false));
        // ...but the card is back on screen once the app is.
        assertEquals(Step.SILENCE, state.onAppReturned(T0 + 2_000));
    }

    @Test
    public void leavingTheAppWhileItStillRingsRaisesTheNativeRing() {
        arriveInForeground();
        state.onAppClaimed("c1", T0 + 500, true);
        assertEquals(Step.RAISE, state.onAppLeft(T0 + 10_000, true));
        assertEquals(Step.NONE, state.onAppLeft(T0 + 10_500, true));
        // Back in the app: the card is the ring again.
        assertEquals(Step.SILENCE, state.onAppReturned(T0 + 12_000));
        assertEquals(Step.NONE, state.onAppReturned(T0 + 12_500));
    }

    @Test
    public void theScreenGoingOffIsNotLeavingTheApp() {
        arriveInForeground();
        state.onAppClaimed("c1", T0 + 500, true);
        assertEquals(Step.NONE, state.onAppLeft(T0 + 10_000, false));
    }

    @Test
    public void anUnclaimedRingIsNotSilencedOnReturn() {
        arriveInBackground();
        assertEquals(Step.NONE, state.onAppReturned(T0 + 1_000));
    }

    @Test
    public void aRingThatIsOverIsNeverRaisedAgain() {
        arriveInForeground();
        state.onAppClaimed("c1", T0 + 500, true);
        state.onResolved("c1");
        assertNull(state.ringCallId());
        assertEquals(Step.NONE, state.onAppLeft(T0 + 1_000, true));
        assertEquals(Step.NONE, state.onClaimGraceOver("c1", T0 + IncomingRingState.APP_CLAIM_GRACE_MS));
        assertEquals(Step.NONE, state.onAppReturned(T0 + 2_000));
    }

    @Test
    public void aRingOutOfTimeIsNeverRaisedAgain() {
        arriveInForeground();
        assertEquals(Step.NONE, state.onAppLeft(T0 + IncomingRingState.RING_WINDOW_MS, true));
        assertEquals(Step.NONE, state.onClaimGraceOver("c1", T0 + IncomingRingState.RING_WINDOW_MS));
    }

    @Test
    public void resolvingAnotherCallLeavesThisRingAlone() {
        arriveInForeground();
        state.onResolved("c2");
        state.onResolved(null);
        assertEquals("c1", state.ringCallId());
        assertEquals(Step.RAISE, state.onAppLeft(T0 + 1_000, true));
    }

    @Test
    public void theMessageActionStopsTheRingButKeepsTheCallRinging() {
        arriveInBackground();
        state.onReplyOpened("c1", T0 + 2_000);
        assertEquals("c1", state.ringCallId());
        // The reply panel is on screen: nothing to silence on return, and the ring comes back if the app is left.
        assertEquals(Step.NONE, state.onAppReturned(T0 + 2_100));
        assertEquals(Step.NONE, state.onAppClaimed("c1", T0 + 2_200, true));
        assertEquals(Step.RAISE, state.onAppLeft(T0 + 20_000, true));
    }

    @Test
    public void aRepeatedPushForTheSameRingDoesNotRingTwice() {
        arriveInBackground();
        assertEquals(Step.NONE, state.onRingArrived("c1", "Ana", true, true, T0 + 1_000, false));
        assertEquals(Step.NONE, state.onRingArrived("c1", "Ana", true, true, T0 + 1_000, true));
    }

    @Test
    public void aNewCallReplacesTheOldRing() {
        arriveInForeground();
        state.onAppClaimed("c1", T0 + 500, true);
        assertEquals(Step.RAISE, state.onRingArrived("c2", "Ben", false, false, T0 + 2_000, false));
        assertEquals("c2", state.ringCallId());
        assertFalse(state.ringCanReply());
        // The old call's claim doesn't carry over.
        assertEquals(Step.NONE, state.onAppReturned(T0 + 3_000));
    }

    @Test
    public void claimsAndPushesWithoutACallIdAreIgnored() {
        assertEquals(Step.NONE, state.onRingArrived(null, "Ana", false, false, T0, false));
        assertEquals(Step.NONE, state.onAppClaimed(null, T0, true));
        assertNull(state.ringCallId());
    }
}
