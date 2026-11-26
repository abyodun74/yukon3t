// Which of a user's iPhones get a `call_cancelled` VoIP push, and why. Pure, so it is unit-tested without APNs.
//
// When a ring is answered or declined, every OTHER iPhone of that person that CallKit is ringing must stop. A VoIP
// push is the only thing that reaches a locked iPhone whose app isn't running, but the iPhone that answered must never
// get one: installed builds end their CallKit call on any `call_cancelled` for it, and ending the call just answered
// tears down its audio. So the answering device names itself (CallDevice, built by the browser) and is matched only
// against the signed-in user's own registered tokens: a token that isn't theirs matches nothing, which sends nothing,
// so nobody can use this to stop or keep someone else's ring.
//
// What was cleared at answer time is stored on the call (Call for the callee of a 1:1, CallParticipant for someone
// added later). At hang-up only the device that is in the call is sent the cancel that ends its CallKit call; the
// others already stopped ringing, and an iPhone with no call to end must report a throwaway one to CallKit (or, on an
// older build, is killed by iOS for not doing so).

export const VOIP_TOKEN_MAX_LENGTH = 512;

/** The device a call action came from, as the browser describes it. Untrusted: only ever matched against the
 * signed-in user's own tokens. */
export type CallDevice =
  | {
      platform: "ios";
      /** This app's PushKit token, if the page knows it. */
      voipToken: string | null;
      /** CallKit on this device already ended the call (its End button): it needs no cancel push. */
      callKitEnded: boolean;
    }
  | { platform: "other" };

export function parseCallDevice(input: unknown): CallDevice | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (value.platform === "other") return { platform: "other" };
  if (value.platform !== "ios") return null;
  const token =
    typeof value.voipToken === "string" && value.voipToken.length > 0 && value.voipToken.length <= VOIP_TOKEN_MAX_LENGTH
      ? value.voipToken
      : null;
  return { platform: "ios", voipToken: token, callKitEnded: value.callKitEnded === true };
}

export type VoipTokenRef = { id: string; token: string };

/** Stored with the answer. Not cleared (the default, and every row from before this existed): every iPhone of the
 * person still gets the cancel at hang-up, as before. */
export type VoipAnswerRecord = { voipOthersCleared: boolean; answerVoipTokenId: string | null };

export const NO_VOIP_ANSWER_RECORD: VoipAnswerRecord = { voipOthersCleared: false, answerVoipTokenId: null };

/**
 * An answer or decline: which of the responder's iPhones to send the cancel to now, and what to store with an answer.
 * - No device (an older page): nobody. The answering iPhone can't be told apart from the rest.
 * - Not an iPhone app (Android, a browser): every iPhone.
 * - An iPhone app whose token is one of the user's own: every other iPhone.
 * - An iPhone app with no token, or one that isn't the user's: nobody, for the first reason.
 */
export function planResponderVoipCancel(
  tokens: readonly VoipTokenRef[],
  device: CallDevice | null,
): { cancel: VoipTokenRef[]; record: VoipAnswerRecord } {
  if (!device) return { cancel: [], record: NO_VOIP_ANSWER_RECORD };
  if (device.platform === "other") {
    return { cancel: [...tokens], record: { voipOthersCleared: true, answerVoipTokenId: null } };
  }
  const own = device.voipToken ? tokens.find((t) => t.token === device.voipToken) : undefined;
  if (!own) return { cancel: [], record: NO_VOIP_ANSWER_RECORD };
  return {
    cancel: tokens.filter((t) => t.id !== own.id),
    record: { voipOthersCleared: true, answerVoipTokenId: own.id },
  };
}

/**
 * The call is over for this person: which of their iPhones get the cancel that ends CallKit's call. With nothing
 * cleared at answer time, all of them (as before); otherwise only the one that answered, if it is still registered.
 * `endedHereToken` is the raw token of a device of this person whose CallKit already ended the call; it is left out.
 */
export function planHangUpVoipCancel(
  tokens: readonly VoipTokenRef[],
  record: VoipAnswerRecord,
  endedHereToken: string | null,
): VoipTokenRef[] {
  const targets = record.voipOthersCleared ? tokens.filter((t) => t.id === record.answerVoipTokenId) : [...tokens];
  return endedHereToken ? targets.filter((t) => t.token !== endedHereToken) : targets;
}

/** The token of a hang-up that CallKit's own End made, or null. */
export function callKitEndedToken(device: CallDevice | null): string | null {
  return device?.platform === "ios" && device.callKitEnded ? device.voipToken : null;
}

export function voipAnswerRecord(row: VoipAnswerRecord): VoipAnswerRecord {
  return { voipOthersCleared: row.voipOthersCleared, answerVoipTokenId: row.answerVoipTokenId };
}

/**
 * Whose answer counts for someone in a call people were added to. The original callee's row is backfilled when the
 * first person is added (invitedById null) and says nothing about how they answered: their answer is on the Call.
 * Anyone rung by an invite (including the callee, re-invited after leaving) answered on their own row.
 */
export function participantAnswerRecord(
  call: { calleeId: string } & VoipAnswerRecord,
  row: { userId: string; invitedById: string | null } & VoipAnswerRecord,
): VoipAnswerRecord {
  return voipAnswerRecord(row.userId === call.calleeId && row.invitedById === null ? call : row);
}
