"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { getIncomingCall, getCallStatus, respondToCall } from "@/app/actions/calls";
import { useCallSession } from "@/lib/call-session";
import { useReloadHold } from "@/lib/stale-build-client";
import { holdReload } from "@/lib/stale-build";
import {
  OUT_OF_APP_ANSWER_RETRY_DELAY_MS,
  answerOutcome,
  createCallAnswerTracker,
} from "@/lib/call-answer-tracker";
import { createCallKitRingSync, planCallKitEnd } from "@/lib/callkit-ring-sync";
import { createNativeCallKitRingPort } from "@/lib/native-callkit";
import { currentCallDevice } from "@/lib/call-device";
import { prewarmCall, cancelPrewarm } from "@/lib/call-prewarm";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { isCallOverStatus } from "@/lib/call-resilience";
import { endCallDurably } from "@/lib/end-call-durably";
import { RingtonePlayer, type RingtoneId } from "@/lib/ringtones";
import { pauseAllPlayingVideos, resumePausedVideos } from "@/lib/video-playback-guard";
import { hapticNotification, hapticImpact } from "@/lib/haptics";
import { useCallsText } from "@/components/calls-text";
import { answeredCallLabel, callLabel, isPrivateCaller } from "@/lib/call-names";
import { aroundPlaceholder } from "@/lib/i18n/locales";
import { UserAvatar } from "@/components/user-link";

type IncomingCall = {
  id: string;
  type: "AUDIO" | "VIDEO";
  // avatarUrl is null for a caller with no picture and for one announced as "Private call" (see call-avatar.ts).
  caller: { id: string; name: string | null; avatarUrl: string | null };
  // Both already minted/created at startCall time and present on the Call
  // row getIncomingCall() returns in full (see that action's own comment) —
  // just never read by this component until now. Nullable: a Call row
  // where calleeToken minting somehow failed at startCall time (see
  // schema.prisma's own comment on that column) falls back to minting on
  // accept the same way it always has, with no early prewarm to offer.
  roomUrl: string | null;
  calleeToken: string | null;
  // Not a fresh 1:1 call but a ring to join one already going (see
  // inviteToCall): `caller` is whoever added this user, and this is how
  // many other people are in it. 0 for an ordinary call.
  othersInCall: number;
};

/**
 * "<inviter> + N" for a ring into a call with other people already in it. `someone` stands in for a caller with no
 * name; a hidden caller's stand-in is left as the server sent it, and worded where the label is shown (callLabel).
 */
function incomingCallLabel(call: IncomingCall, someone: string) {
  const name = call.caller.name ?? someone;
  return call.othersInCall > 0 ? `${name} + ${call.othersInCall}` : name;
}

type ActiveCall = { callId: string; roomUrl: string; token: string; type: "AUDIO" | "VIDEO"; callerName: string };

/** Mounted once, app-wide, for any signed-in user — subscribes for a ring the same way ChatThread subscribes for messages. */
export function IncomingCallListener({ currentUserId }: { currentUserId: string }) {
  const { t: calls } = useCallsText();
  const t = calls.incoming;
  // Read by acceptCall (below) for the name of a caller who has none: a ref, for the same reason as incomingRef.
  const someoneRef = useRef(calls.someone);
  useEffect(() => {
    someoneRef.current = calls.someone;
  });
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [ringtone, setRingtone] = useState<RingtoneId>("CLASSIC");
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const { startSession, endSession, hangUp, session } = useCallSession();
  const sessionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    sessionKeyRef.current = session?.key ?? null;
  });
  // Ringing counts as a call for stale-build reloads: the banner would come
  // back after one, but seconds late, on a call that only rings for so long.
  useReloadHold("call", incoming !== null);
  // The call whose answer is being sent: its ring is hidden and silent from the tap on, not from the server's reply.
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  useReloadHold("call", answeringId !== null);

  const activeCallRef = useRef(activeCall);
  useEffect(() => {
    activeCallRef.current = activeCall;
  });

  // Read by acceptCall (below) to label the minimized call widget — a plain
  // dependency-array entry would recreate acceptCall on every realtime event.
  const incomingRef = useRef(incoming);
  useEffect(() => {
    incomingRef.current = incoming;
  });

  // Tracks the prewarm.ts key for a call this side has started joining
  // early (see the prewarm effect further down) but hasn't accepted yet —
  // cleared without cancelling once acceptCall adopts it (ownership passes
  // to DirectCallFrame, which looks itself up by the same key), or left
  // alone to be cancelled by that same effect's own cleanup wherever this
  // component gives up on the call first (declined, the caller hangs up/
  // cancels while still ringing, or this component unmounts mid-ring).
  const pendingPrewarmKeyRef = useRef<string | null>(null);

  // Calls being answered or just answered here, so a check that still finds them RINGING never puts up a second
  // Accept: CallKit's Accept (iOS) and the notification's Accept (Android) reach this page while it is also checking
  // for a ring, on a cold start and on every return from the background. See call-answer-tracker.ts.
  const [answers] = useState(createCallAnswerTracker);
  // iOS: stops CallKit's ring when the call is answered or declined in the app, or is resolved anywhere else
  // (another device, the caller, the timeout). See callkit-ring-sync.ts.
  const [callKitRing] = useState(() =>
    createCallKitRingSync(createNativeCallKitRingPort(), {
      status: async (callId) => {
        const result = await getCallStatus(callId);
        return result.error ? null : result.status;
      },
      answeringHere: (callId) => answers.ringDecision(callId) !== "show",
    }),
  );
  // iOS: CallKit's End on a call answered here is a hang-up (hungUpOutOfApp). The call it ended, so endCall can tell
  // the server this device's CallKit call is already over; and calls whose End came while their answer was still on
  // its way, ended as soon as that answer lands.
  const callKitEndedIdRef = useRef<string | null>(null);
  const callKitHungUpRef = useRef(new Set<string>());
  const retryTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = retryTimersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // Assigned below: checkIncoming needs acceptCall and the native drain, which are declared after it.
  const acceptCallRef = useRef<(callId: string) => Promise<void>>(async () => {});
  const syncNativeCallEventsRef = useRef<() => Promise<void>>(async () => {});

  const checkIncoming = useCallback(async () => {
    // iOS: a CallKit answer the live event didn't deliver (the page was suspended or not loaded yet when it was
    // tapped) is picked up here, before deciding whether this ring needs the in-app Accept at all.
    await syncNativeCallEventsRef.current();
    const { call, ringtone: userRingtone } = await getIncomingCall();
    void callKitRing.reconcile(call?.id ?? null);
    // Ignore a response that arrives after a call has since started.
    if (activeCallRef.current) return;
    if (userRingtone) setRingtone(userRingtone);
    if (call) {
      const decision = answers.ringDecision(call.id);
      if (decision === "accept") {
        void acceptCallRef.current(call.id);
        return;
      }
      if (decision === "hide") return;
    }
    setIncoming(call as IncomingCall | null);
  }, [answers, callKitRing]);

  // Fires immediately on mount (in case a call is already ringing by the
  // time this component appears — a cold start from a push notification,
  // or the app just regaining focus) and again whenever a call just ended
  // (there could already be another one waiting) — ref indirection avoids
  // a "setState synchronously within an effect" lint false-positive for
  // what's actually an async fetch-then-setState, same pattern chat-thread's
  // own refetchRef uses.
  const checkIncomingRef = useRef(checkIncoming);
  useEffect(() => {
    checkIncomingRef.current = checkIncoming;
  });
  useEffect(() => {
    if (!activeCall) checkIncomingRef.current();
  }, [activeCall]);

  // Replaces the old 5s ring poll — startCall publishes onto the callee's
  // own call:{userId} channel the instant a call is placed (see
  // REALTIME_CHANNELS.callSignal in actions/calls.ts). Its immediate resync on
  // every return to the foreground is also what drains a CallKit answer
  // tapped while the app was in the background (checkIncoming).
  useRealtimeEvent(
    !activeCall ? REALTIME_CHANNELS.callSignal(currentUserId) : null,
    "changed",
    checkIncoming,
    { resync: "immediate" },
  );

  // Fallback for the caller hanging up mid-call: normally that ejects us
  // from the Daily room, which fires CallFrame's "left-meeting" -> onLeave
  // below. But deleteCallRoom (daily.ts) is best-effort, so if that ejection
  // is delayed or never arrives, this catches the DB's Call.status flipping
  // to ENDED/MISSED independently and tears the call down locally. Replaces
  // the old 5s fallback poll — respondToCall/endCall publish onto this same
  // channel on every status change, so this fires instantly instead.
  const checkActiveCallStatus = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call) return;
    const result = await getCallStatus(call.callId);
    if (result.error) return;
    if (result.status === "ENDED" || result.status === "MISSED" || result.status === "DECLINED") {
      endSession();
      setActiveCall((current) => (current?.callId === call.callId ? null : current));
      return;
    }
    // iOS: CallKit may be ringing for this very call (its VoIP push arrived after the answer here), or for one
    // resolved elsewhere meanwhile. See callkit-ring-sync.ts.
    void callKitRing.reconcileDuringCall(call.callId);
  }, [endSession, callKitRing]);
  useRealtimeEvent(
    activeCall ? REALTIME_CHANNELS.callSignal(currentUserId) : null,
    "changed",
    checkActiveCallStatus,
    { resync: "immediate" },
  );

  // Hands the fullscreen/minimizable UI off to the root-mounted
  // GlobalCallFrame the moment the call connects (see call-session.tsx).
  useEffect(() => {
    if (!activeCall) return;
    startSession({
      key: `call:${activeCall.callId}`,
      roomUrl: activeCall.roomUrl,
      token: activeCall.token,
      type: activeCall.type,
      renderer: "direct",
      label: activeCall.callerName,
      onLeave: () => {
        // Can now be reached with the network still down (a reconnect that
        // ran out of retries), so this keeps retrying after the call UI is
        // gone — see endCallDurably. If it never gets through, the other
        // side's own grace period, or failing that the stale-ACCEPTED sweep,
        // closes the row. For someone who was added to a call, the server
        // takes the same endCall as "I leave" and the call carries on. A
        // hang-up from CallKit's End says so: that CallKit call is already
        // over, and needs no cancel push.
        endCallDurably(
          activeCall.callId,
          callKitEndedIdRef.current === activeCall.callId ? currentCallDevice({ callKitEnded: true }) : undefined,
        );
        setActiveCall(null);
      },
      isOver: async () => {
        const result = await getCallStatus(activeCall.callId);
        return result.error ? true : isCallOverStatus(result.status);
      },
      call: { callId: activeCall.callId, currentUserId },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall?.callId]);

  // Joins the Daily room — muted, nothing captured or sent (see
  // prewarmCall's `muted` option) — the moment we know a call is ringing,
  // instead of only starting to connect after Accept is tapped. Supersedes
  // the old "just warm the dynamic import" version of this effect: joining
  // already does that import as its own first step, so by the time
  // acceptCall's response comes back, DirectCallFrame can adopt an
  // already-connected call object instead of starting the
  // import+createCallObject+join sequence from scratch. Needs roomUrl/
  // calleeToken, which getIncomingCall() already returns ahead of Accept
  // (see Call.calleeToken's own schema comment) — previously unused here.
  //
  // The cleanup below is what actually tears a never-accepted prewarm back
  // down — it fires whenever `incoming` changes away from this call for
  // ANY reason (declined, the caller hangs up/cancels while still ringing,
  // or this component unmounts), except when acceptCall has already
  // cleared pendingPrewarmKeyRef to hand ownership to DirectCallFrame
  // first, in which case the guard below correctly does nothing.
  useEffect(() => {
    if (!incoming?.roomUrl || !incoming.calleeToken) return;
    const key = `call:${incoming.id}`;
    prewarmCall(key, { roomUrl: incoming.roomUrl, token: incoming.calleeToken, type: incoming.type, muted: true });
    pendingPrewarmKeyRef.current = key;
    return () => {
      if (pendingPrewarmKeyRef.current === key) {
        cancelPrewarm(key);
        pendingPrewarmKeyRef.current = null;
      }
    };
  }, [incoming?.id, incoming?.roomUrl, incoming?.calleeToken, incoming?.type]);

  // Plays the callee's chosen ringtone on loop for as long as a call is
  // actually ringing, and stops the moment it isn't — accepted, declined,
  // hung up by the caller, or this component unmounts.
  const playerRef = useRef<RingtonePlayer | null>(null);
  const ringingId = incoming && incoming.id !== answeringId ? incoming.id : null;
  useEffect(() => {
    if (!ringingId) return undefined;
    if (!playerRef.current) playerRef.current = new RingtonePlayer();
    playerRef.current.start(ringtone);
    return () => {
      playerRef.current?.stop();
    };
    // Keyed on the ringing call's id, not incoming itself — a fresh object
    // can come back from a re-check even when it's the same ringing call,
    // and restarting the loop then would glitch the audio.
  }, [ringingId, ringtone]);

  // Pauses any feed/story/live video already playing the moment a call
  // starts ringing, so it doesn't compete with the ringtone before the call
  // is even answered — only covers this pre-answer window on the callee
  // side (there's no equivalent "ringing" state for whoever placed the
  // call). Once answered, CallSessionProvider's startSession/endSession
  // take over the pause for the rest of the call's duration on *both*
  // sides — video-playback-guard.ts's reference counting means this
  // ringing-phase pause and that one don't stomp on each other regardless
  // of which order they fire/clear in.
  const isRinging = Boolean(incoming);
  useEffect(() => {
    if (!isRinging) return;
    pauseAllPlayingVideos();
    return () => {
      resumePausedVideos();
    };
  }, [isRinging]);

  // Callable by callId directly (not just from `incoming` state) so the
  // notification-tap deep-link handler below can accept/decline a call this
  // component's own subscription hasn't necessarily caught up to yet.
  // Answers each call once however many paths ask (in-app button, CallKit's
  // live event, its pending queue, the ring check's auto-accept); the server
  // still guards the RINGING -> ACCEPTED write on its own.
  const acceptCall = useCallback(async (callId: string) => {
    if (!answers.begin(callId)) return;
    setAnsweringId(callId);
    const ringLabel =
      incomingRef.current?.id === callId ? incomingCallLabel(incomingRef.current, someoneRef.current) : null;
    // A stale-build reload mid-answer would lose the reply (room and token)
    // while the server has already marked the call ACCEPTED. Taken right
    // away (the useReloadHold below only starts once this state commits),
    // and kept a moment past the reply, until that hold and the call
    // session's own have taken over.
    const release = holdReload("call");
    let result: Awaited<ReturnType<typeof respondToCall>> | null;
    try {
      result = await respondToCall(callId, true, currentCallDevice());
    } catch {
      result = null;
    } finally {
      setTimeout(release, 1_000);
    }
    const outcome = answerOutcome(result);
    const followUp = answers.finish(callId, outcome);
    setAnsweringId((current) => (current === callId ? null : current));
    if (callKitHungUpRef.current.delete(callId)) {
      // CallKit's End was pressed while this answer was on its way: the user hung up. Its CallKit call is over.
      const device = currentCallDevice({ callKitEnded: true });
      if (outcome === "connected") endCallDurably(callId, device);
      else if (outcome === "failed") void respondToCall(callId, false, device).catch(() => {});
      setIncoming((current) => (current?.id === callId ? null : current));
      return;
    }
    if (outcome === "refused") {
      void callKitRing.settle(callId);
      setIncoming((current) => (current?.id === callId ? null : current));
      return;
    }
    if (!result || result.error || !("roomUrl" in result) || !result.roomUrl || !result.token) {
      if (followUp === "retry") {
        const timer = setTimeout(() => {
          retryTimersRef.current.delete(timer);
          void acceptCallRef.current(callId);
        }, OUT_OF_APP_ANSWER_RETRY_DELAY_MS);
        retryTimersRef.current.add(timer);
      } else if (followUp === "show") {
        void checkIncomingRef.current();
      }
      return;
    }
    // The in-app ring isn't loaded yet when this is an Accept from the notification or CallKit (a cold start, or
    // the phone was locked): the name then comes from respondToCall, masked like the ring, so a hidden caller stays
    // "Private call" and everyone else is named rather than "Someone".
    const callerName = answeredCallLabel(
      ringLabel,
      "callerName" in result ? result.callerName : undefined,
      someoneRef.current,
    );
    // Ownership of any prewarmed join for this exact call transfers to
    // DirectCallFrame now (it looks itself up by this same `call:${callId}`
    // key, via the `key` passed to startSession below) — only clear the
    // ref when it's actually this call's own prewarm, never a different
    // one that happens to still be pending (shouldn't happen given "one
    // RINGING call at a time", but this is cheap insurance against ever
    // orphaning a different call's prewarmed, connected-but-unadopted Daily
    // call object). The prewarm effect's own cleanup is what would
    // otherwise cancel it once `incoming` changes below — clearing the ref
    // first is what makes that cleanup correctly do nothing here.
    if (pendingPrewarmKeyRef.current === `call:${callId}`) {
      pendingPrewarmKeyRef.current = null;
    }
    void callKitRing.answeredHere(callId);
    const next = { callId, roomUrl: result.roomUrl, token: result.token, type: result.type, callerName };
    // Set now, not on the next render: a CallKit End arriving in between must find the call it hangs up.
    activeCallRef.current = next;
    setActiveCall(next);
    setIncoming((current) => (current?.id === callId ? null : current));
  }, [answers, callKitRing]);

  // Layout effects, so both refs are set before the mount ring check (a
  // passive effect further up) first reads them.
  useLayoutEffect(() => {
    acceptCallRef.current = acceptCall;
  });

  const declineCall = useCallback(async (callId: string) => {
    await respondToCall(callId, false, currentCallDevice());
    void callKitRing.declinedHere(callId);
    setIncoming((current) => (current?.id === callId ? null : current));
  }, [callKitRing]);

  // An Accept or Decline tapped outside the app: CallKit on iOS, the
  // incoming-call notification on Android.
  const answeredOutOfApp = useCallback(
    (callId: string) => {
      if (answers.noteOutOfAppAnswer(callId)) void acceptCall(callId);
    },
    [answers, acceptCall],
  );
  const declinedOutOfApp = useCallback(
    (callId: string) => {
      if (answers.noteOutOfAppDecline(callId)) void declineCall(callId);
    },
    [answers, declineCall],
  );

  // iOS: CallKit's End (side button, lock screen, system call UI) on a call
  // answered on this device. The native side ends its CallKit call and audio
  // session itself; this leaves the room and ends the call server-side the
  // same way the in-call Hang up button does. Builds before callEnded report
  // that End as callDeclined, which stays decline-only (see below).
  const hungUpOutOfApp = useCallback(
    (callId: string) => {
      const plan = planCallKitEnd(callId, activeCallRef.current?.callId ?? null, answers.ringDecision(callId));
      if (plan === "afterAnswer") callKitHungUpRef.current.add(callId);
      if (plan !== "hangUp") return;
      callKitEndedIdRef.current = callId;
      if (sessionKeyRef.current === `call:${callId}`) {
        hangUp();
        return;
      }
      // Answered a moment ago, before the call UI took over.
      endCallDurably(callId, currentCallDevice({ callKitEnded: true }));
      setActiveCall((current) => (current?.callId === callId ? null : current));
    },
    [answers, hangUp],
  );

  // iOS: CallKit queues every Accept/Decline natively as well as firing it as
  // a live event (NativeCallManager.swift), because the event is lost when
  // the page isn't listening: not loaded yet on a cold start, or suspended
  // while the app is in the background or the phone is locked. Drained
  // before every ring check, so opening the app after answering on CallKit
  // goes straight into the call instead of showing the in-app Accept.
  const syncNativeCallEvents = useCallback(async () => {
    if (Capacitor.getPlatform() !== "ios") return;
    const { NativeCallKit } = await import("@/lib/native-callkit");
    const pending = await NativeCallKit.getPendingCallEvents().catch(() => null);
    pending?.answered.forEach(answeredOutOfApp);
    pending?.declined.forEach(declinedOutOfApp);
    pending?.ended?.forEach(hungUpOutOfApp);
  }, [answeredOutOfApp, declinedOutOfApp, hungUpOutOfApp]);
  useLayoutEffect(() => {
    syncNativeCallEventsRef.current = syncNativeCallEvents;
  });

  // Haptics live in these two in-app-button wrappers, not acceptCall/
  // declineCall themselves — those are shared with the CallKit/Android
  // notification-tap/deep-link paths below, where the OS's own native
  // Accept/Decline UI already provides its own system feedback; firing
  // ours there too would double up on top of it.
  async function accept() {
    hapticNotification("success");
    if (incoming) await acceptCall(incoming.id);
  }

  async function decline() {
    hapticImpact("light");
    if (incoming) await declineCall(incoming.id);
  }

  // Native Android only: the incoming-call notification (CallMessagingService,
  // native side) opens yukon3t://call?callId=...&action=accept|decline when
  // its Accept/Decline actions are tapped — this is what lets a call raised
  // while the phone was asleep/backgrounded actually be answered/declined,
  // routed through the same respondToCall flow the in-app buttons use.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let cancelled = false;
    let listener: { remove: () => void } | undefined;

    function handleUrl(url: string | undefined) {
      if (!url) return;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      if (parsed.protocol !== "yukon3t:" || parsed.hostname !== "call") return;
      const callId = parsed.searchParams.get("callId");
      const action = parsed.searchParams.get("action");
      if (!callId) return;
      if (action === "accept") answeredOutOfApp(callId);
      else if (action === "decline") declinedOutOfApp(callId);
      // No action (notification body tap) — just foregrounding the app is
      // enough; the mount-check above picks up the ringing banner.
    }

    (async () => {
      const { App } = await import("@capacitor/app");
      if (cancelled) return;
      // Cold start: the app was launched by the notification tap, so
      // appUrlOpen (below) never fires for this original launch intent —
      // getLaunchUrl() is what surfaces it instead.
      const launch = await App.getLaunchUrl().catch(() => undefined);
      if (!cancelled) handleUrl(launch?.url);
      // Warm start: app already running, singleTask launch mode routes the
      // tap through onNewIntent, which the plugin surfaces as this event.
      listener = await App.addListener("appUrlOpen", (event) => {
        handleUrl(event.url);
      });
    })();

    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, [answeredOutOfApp, declinedOutOfApp]);

  // iOS only: CallKit's native Accept/Decline buttons (shown even while the
  // app is fully terminated, via PushKit — see NativeCallKitPlugin.swift)
  // report straight to the OS, not to this component, so this is what
  // routes that outcome back into the exact same respondToCall flow the
  // in-app buttons and Android's notification-tap deep link above already
  // use. These live events only arrive while the page is running; an answer
  // tapped while it wasn't comes from the native queue, drained before every
  // ring check (syncNativeCallEvents). iOS doesn't bring the app forward
  // after an audio call is answered (the system call screen stays up until
  // the user opens the app); opening it is what the drain is for.
  useEffect(() => {
    if (Capacitor.getPlatform() !== "ios") return undefined;
    let cancelled = false;
    let answeredListener: { remove: () => void } | undefined;
    let declinedListener: { remove: () => void } | undefined;
    let endedListener: { remove: () => void } | undefined;

    (async () => {
      const { NativeCallKit } = await import("@/lib/native-callkit");
      if (cancelled) return;
      answeredListener = await NativeCallKit.addListener("callAnswered", (event) => {
        answeredOutOfApp(event.callId);
        // The same answer also sits in the native queue; consume it now so a
        // later drain can't replay it into a re-invite to the same call.
        void syncNativeCallEvents();
      });
      declinedListener = await NativeCallKit.addListener("callDeclined", (event) => {
        // The decline path only, even when this is the call already in
        // progress (where respondToCall no-ops: it only acts on a RINGING
        // call). Builds before callEnded report a mid-call CallKit End this
        // way too, but they also leave CallKit ringing after an in-app
        // answer, so a callDeclined for the call in progress can be the user
        // dismissing that stale ring: never a hang-up.
        declinedOutOfApp(event.callId);
        void syncNativeCallEvents();
      });
      endedListener = await NativeCallKit.addListener("callEnded", (event) => {
        hungUpOutOfApp(event.callId);
        void syncNativeCallEvents();
      });
      // An answer tapped between the mount ring check's drain and the
      // listeners attaching reached neither.
      if (!cancelled) await syncNativeCallEvents();
    })();

    return () => {
      cancelled = true;
      answeredListener?.remove();
      declinedListener?.remove();
      endedListener?.remove();
    };
  }, [answeredOutOfApp, declinedOutOfApp, hungUpOutOfApp, syncNativeCallEvents]);

  // Once active, the call itself renders via the root-mounted GlobalCallFrame
  // (see the startSession effect above) — nothing left to render here.
  if (activeCall) return null;

  // Nothing to answer while this call's answer is already on its way.
  if (!incoming || incoming.id === answeringId) return null;

  // One sentence per kind of ring, the caller's name in bold wherever that language puts it. A caller whose chat
  // the reader has hidden is shown as the app's stand-in for the name, in a sentence worded for it.
  const isGroupRing = incoming.othersInCall > 0;
  const isVideo = incoming.type === "VIDEO";
  const shownName = callLabel(incoming.caller.name, calls);
  const sentence =
    !isGroupRing && isPrivateCaller(incoming.caller.name)
      ? isVideo
        ? t.callingPrivateVideo
        : t.callingPrivate
      : isGroupRing
        ? isVideo
          ? t.callingGroupVideo
          : t.callingGroup
        : isVideo
          ? t.callingVideo
          : t.calling;
  const [beforeName, afterName] = aroundPlaceholder(sentence, "name");

  return (
    <div className="fixed inset-x-0 top-[calc(1rem+max(env(safe-area-inset-top),var(--status-bar-inset-top,0px)))] z-50 mx-auto w-fit rounded-xl border border-line bg-surface p-4 shadow-lg" role="group" aria-label={t.label}>
      {/* role="alert": an incoming call is the one thing here worth
          interrupting a screen reader for — without it the banner appears
          silently and the call rings out unanswered. */}
      <div className="flex items-center gap-3">
        <UserAvatar
          avatarUrl={incoming.caller.avatarUrl}
          name={isPrivateCaller(incoming.caller.name) ? null : incoming.caller.name}
          size={40}
        />
        <p role="alert" className="text-sm">
          {beforeName}
          <bdi className="font-semibold">{isGroupRing ? `${shownName} + ${incoming.othersInCall}` : shownName}</bdi>
          {afterName}
        </p>
      </div>
      <div className="mt-3 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={decline}
          className="flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2.5 text-sm font-medium text-white transition-transform active:scale-[0.95]"
        >
          <PhoneOff size={16} /> {t.decline}
        </button>
        <button
          type="button"
          onClick={accept}
          className="flex items-center gap-1.5 rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-white transition-transform active:scale-[0.95]"
        >
          {incoming.type === "VIDEO" ? <Video size={16} /> : <Phone size={16} />} {t.accept}
        </button>
      </div>
    </div>
  );
}
