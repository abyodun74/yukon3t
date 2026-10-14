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
