// The one place the "invite a friend" link and the text/WhatsApp/share payloads are built (invite-panel.tsx).
// Pure and client-safe.
//
// The link is always the canonical production address, never `window.location.origin`: that used to be the source,
// so an invite sent from a Vercel preview, a *.vercel.app / *.netlify.app host or a local dev server carried that host
// instead of yukon3t.com. The native apps load https://yukon3t.com (capacitor.config.ts), so they already sent the
// right host, but a link copied anywhere else didn't. There is no referral or invite code in the app (nothing reads
// one on sign-up), so the link carries no parameter.

export const INVITE_ORIGIN = "https://yukon3t.com";
export const INVITE_PATH = "/sign-up";

/** https://yukon3t.com/sign-up */
export function buildInviteUrl(): string {
  return new URL(INVITE_PATH, INVITE_ORIGIN).toString();
}

/**
 * The full invite text: the localized sentence, then the link alone on its own line, so every SMS/WhatsApp/Messages
 * client turns it into a tappable link (no punctuation touching it, nothing after it).
 */
export function buildInviteMessage(sentence: string, url: string = buildInviteUrl()): string {
  const text = sentence.trim();
  return text ? `${text}\n${url}` : url;
}

/** Only "+" and digits survive: what an sms:/wa.me address may contain. Empty when there are no digits. */
function dialableNumber(tel: string): string {
  const trimmed = tel.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/**
 * An sms: link that opens the Messages app on that number with the invite text filled in. The number is reduced to
 * "+" and digits (left unencoded: several Android SMS apps don't decode "%2B"), the body is percent-encoded.
 * `?body=` is what both Android and current iOS read.
 */
export function buildSmsInviteHref(tel: string, message: string): string {
  return `sms:${dialableNumber(tel)}?body=${encodeURIComponent(message)}`;
}

/**
 * A WhatsApp click-to-chat link with the invite text filled in. With a full international number it opens that
 * person's chat (wa.me wants the digits without "+"); without one, or for a number that isn't international, it opens
 * WhatsApp's own "send to…" picker, since wa.me can't guess a country.
 */
export function buildWhatsAppInviteHref(message: string, e164?: string | null): string {
  const text = `text=${encodeURIComponent(message)}`;
  const dialable = e164 ? dialableNumber(e164) : "";
  return dialable.startsWith("+") ? `https://wa.me/${dialable.slice(1)}?${text}` : `https://wa.me/?${text}`;
}
