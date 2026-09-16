import { HONEYPOT_FIELD, FORM_TIMESTAMP_FIELD, currentTimeMs } from "@/lib/bot-protection";

/**
 * Drop inside any public `<form action={serverAction}>` (no auth wall) to
 * pair with `isBotSubmission` in the action itself — see bot-protection.ts
 * for what these two fields defend against. A plain server component: the
 * timestamp is stamped at server render time, so this works even with JS
 * disabled and needs no client-side effect to set it.
 */
export function BotProtectionFields() {
  return (
    <>
      <input
        type="text"
        name={HONEYPOT_FIELD}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        // Off-screen rather than display:none/hidden — some bots skip
        // fields a cheap CSS check can detect as invisible.
        style={{ position: "absolute", left: "-9999px", top: "auto", width: 1, height: 1, overflow: "hidden" }}
      />
      <input type="hidden" name={FORM_TIMESTAMP_FIELD} value={currentTimeMs()} />
    </>
  );
}
