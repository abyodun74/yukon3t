// Keeps iOS CallKit's ringing screen in step with what happened to the call everywhere else. Pure: the native side is
// reached through a CallKitRingPort (native-callkit.ts), so this is unit-tested without a device.
//
// CallKit only learns about a ring from the VoIP push (NativeCallManager.swift) and only stops ringing when told to.
// The caller hanging up and the ring timing out already reach it as a `call_cancelled` VoIP push, but an answer or a
// decline from the in-app ring, and an answer or decline on another device, never did: CallKit kept ringing after the
// call was picked up. IncomingCallListener now reports each of those here.
//
// Why each native call is what it is (NativeCallManager.swift):
//  - Answered on this device in the app: a CXAnswerCallAction requested through CXCallController, exactly what
//    CallKit's own Accept produces. The call becomes CallKit's active call (green indicator, audio session), the same
//    state a CallKit-answered call is in today, and is ended by the existing `call_cancelled` push at hang-up.
//  - Declined on this device in the app: a CXEndCallAction requested through CXCallController, a user action like
//    CallKit's own Decline.
//  - Anything that happened elsewhere (another device, the caller, the timeout): reportCall(endedAt:reason:) with the
//    matching CXCallEndedReason, which is how CallKit is told about an end it did not perform.

export type CallKitRingEndReason = "declined" | "answeredElsewhere" | "declinedElsewhere" | "remoteEnded" | "unanswered";

/** getCallStatus's statuses, as the person asking sees them. */
export type ServerCallStatus = "RINGING" | "ACCEPTED" | "DECLINED" | "ENDED" | "MISSED";

/**
 * How CallKit should end a ring the server no longer reports as ringing for this user, or null to leave it ringing.
 * `null` status: the server doesn't know the call for this user (not_found), so nothing will ever answer it here.
 */
export function ringEndReasonForStatus(status: ServerCallStatus | null): CallKitRingEndReason | null {
  switch (status) {
    case "RINGING":
      return null;
    case "ACCEPTED":
      return "answeredElsewhere";
    case "DECLINED":
      return "declinedElsewhere";
    case "MISSED":
      return "unanswered";
    case "ENDED":
    case null:
      return "remoteEnded";
  }
}

type PluginHeader = { name: string; methods: readonly { name: string }[] };

/**
 * Whether the installed native build has `method` on `plugin`. Capacitor injects one header per native plugin
 * listing its methods (CAP_PLUGIN_METHOD on iOS); a method an older build lacks is missing from it, and calling it
 * would only reject with UNIMPLEMENTED.
 */
export function nativePluginHasMethod(
  headers: readonly PluginHeader[] | undefined,
  plugin: string,
  method: string,
): boolean {
  return Boolean(headers?.find((h) => h.name === plugin)?.methods.some((m) => m.name === method));
}

/**
 * The native half. Each method resolves without doing anything on a build that doesn't have it, and is a no-op for a
 * call CallKit isn't ringing (unknown, already answered or already ended).
 */
export interface CallKitRingPort {
  answered(callId: string): Promise<void>;
  end(callId: string, reason: CallKitRingEndReason): Promise<void>;
  /** Calls CallKit is ringing right now (reported and not answered on this device). */
  ringing(): Promise<string[]>;
}

export interface CallKitRingSyncDeps {
  /** The call's status for this user; null if the server doesn't know it, undefined if the request failed. */
  status(callId: string): Promise<ServerCallStatus | null | undefined>;
  /** True while this page is answering the call or has just answered it: never end that ring from here. */
  answeringHere(callId: string): boolean;
}

export function createCallKitRingSync(port: CallKitRingPort, deps: CallKitRingSyncDeps) {
  const checking = new Set<string>();

  async function settle(callId: string) {
    if (checking.has(callId)) return;
    checking.add(callId);
    try {
      const status = await deps.status(callId).catch(() => undefined);
      if (status === undefined) return;
      const reason = ringEndReasonForStatus(status);
      if (reason) await port.end(callId, reason).catch(() => {});
    } finally {
      checking.delete(callId);
    }
  }

  return {
    /** This device answered the call (any path): CallKit hands its ring over to an active call. */
    async answeredHere(callId: string) {
      await port.answered(callId).catch(() => {});
    },

    /** This device declined the call. A no-op natively when the decline came from CallKit itself. */
    async declinedHere(callId: string) {
      await port.end(callId, "declined").catch(() => {});
    },

    /** An answer from this device was refused: the ring was resolved somewhere else. End it the way it ended. */
    settle,

    /**
     * After a ring check: every call CallKit is still ringing that the server didn't just report as ringing is looked
     * up and ended if it is over. `serverRingingId` is the call the server says is ringing for this user, if any.
     */
    async reconcile(serverRingingId: string | null) {
      const ringing = await port.ringing().catch(() => [] as string[]);
      await Promise.all(
        ringing
          .filter((id) => id !== serverRingingId && !deps.answeringHere(id))
          .map((id) => settle(id)),
      );
    },
  };
}

export type CallKitRingSync = ReturnType<typeof createCallKitRingSync>;
