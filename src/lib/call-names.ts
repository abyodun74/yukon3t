import { HIDDEN_CALLER_NAME } from "@/lib/hidden-chats-rules";
import type { callsEn } from "@/lib/i18n/en/calls";
import { format } from "@/lib/i18n/locales";

// How the call screens word whoever is on the other end. Pure: the components pass in their own language's slice.

type CallsText = typeof callsEn;

/** Whether `name` is the stand-in the server sends for a caller whose chat the reader has hidden. */
export function isPrivateCaller(name: string | null | undefined) {
  return name === HIDDEN_CALLER_NAME;
}

/**
 * A call's label as the reader sees it: the stand-in for a hidden caller in their language, "Someone" when there is
 * no name, otherwise the name as it is ("Ana", "Ana + 2").
 */
export function callLabel(label: string | null | undefined, t: CallsText): string {
  if (!label) return t.someone;
  return isPrivateCaller(label) ? t.privateCall : label;
}

/**
 * The session label for a call the reader just answered. `ringLabel` is the in-app ring's own label when that ring
 * was loaded (it already carries "+ N" for a ring into a call with others in it); `answeredName` is the caller's name
 * as respondToCall announces it, masked like the ring (undefined when it didn't say, null for a caller with no name).
 * An answer from the notification's or CallKit's Accept usually comes before the in-app ring has loaded, so the
 * server's name is what keeps the in-call screen from saying "Someone" for a caller who has a name. `someone` is
 * only for a caller who really has no name.
 */
export function answeredCallLabel(
  ringLabel: string | null | undefined,
  answeredName: string | null | undefined,
  someone: string,
): string {
  return ringLabel || answeredName || someone;
}

/** Who a notice in the call screen is about, when it can't just name them. */
export type CallPeer = { kind: "name"; name: string } | { kind: "private" } | { kind: "other" } | { kind: "everyone" };

export function callPeer(name: string | null | undefined): CallPeer {
  if (!name) return { kind: "other" };
  return isPrivateCaller(name) ? { kind: "private" } : { kind: "name", name };
}

/** One of the call screen's notices about `peer`, from its four wordings (see `direct` in en/calls.ts). */
export function peerNotice(
  peer: CallPeer,
  forms: { named: string; other: string; everyone: string; private: string },
): string {
  switch (peer.kind) {
    case "name":
      return format(forms.named, { name: peer.name });
    case "private":
      return forms.private;
    case "everyone":
      return forms.everyone;
    default:
      return forms.other;
  }
}
