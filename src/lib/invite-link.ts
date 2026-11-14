// The one place the "invite a friend" message and the text/WhatsApp/share payloads are built (invite-panel.tsx).
// Pure and client-safe.
//
// The invite carries the real store links, not the web sign-up page: a friend who taps one lands straight on the app's
// App Store or Play Store listing. Each link sits alone at the end of its own line, labelled with the platform name
// ("iPhone" / "Android" are the same in every language), so SMS / WhatsApp / Messages make each tappable and the
// recipient knows which one is theirs. There is no referral or invite code in the app, so the links carry no parameter.

import { APP_PACKAGE_ID } from "@/lib/app-version";

/**
 * YuKon3t's App Store id (bundle id com.yukon3t.app). Source: Apple's iTunes lookup for that bundle id, which returned
 * trackId 6813083874 ("Yukon3t"). The same id is what AppVersionPolicy.appStoreId holds when the owner sets it.
 */
export const APP_STORE_APP_ID = "6813083874";

/** https://apps.apple.com/app/id6813083874 */
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_APP_ID}`;

/** https://play.google.com/store/apps/details?id=com.yukon3t.app */
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${APP_PACKAGE_ID}`;

/** The two store links with the label each is shown and sent under. Platform names, never translated. */
export const INVITE_STORE_LINKS = [
  { label: "iPhone", url: APP_STORE_URL },
  { label: "Android", url: PLAY_STORE_URL },
] as const;

/**
 * The full invite text: the localized sentence, then one line per store ("iPhone: <App Store link>",
 * "Android: <Play Store link>"). Each link is the last thing on its line with nothing touching it, and nothing follows
 * the last one, so every messaging client turns them into tappable links.
 */
export function buildInviteMessage(sentence: string): string {
  const links = INVITE_STORE_LINKS.map((l) => `${l.label}: ${l.url}`).join("\n");
  const text = sentence.trim();
  return text ? `${text}\n${links}` : links;
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
