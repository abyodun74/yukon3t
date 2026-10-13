"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Info, ShieldAlert } from "lucide-react";
import type { SecretChat } from "@/lib/e2ee/use-secret-chat";
import { E2EE_MIN_PASSPHRASE_LENGTH } from "@/lib/e2ee/constants";
import { Sheet } from "@/components/sheet";
import { PasswordInput } from "@/components/password-input";
import { useChatOptions } from "@/components/chat-options-menu";
import { useMessagesText } from "@/components/messages-text";
import { format } from "@/lib/i18n/locales";

type Dialog = null | "privacy" | "setup" | "restore" | "reset" | "verify" | "turn-off";

const DIALOG_TITLES = {
  privacy: "privacy",
  setup: "setup",
  restore: "restore",
  reset: "reset",
  verify: "verify",
  "turn-off": "turnOff",
} as const satisfies Record<Exclude<Dialog, null>, string>;

/** A dictionary sentence around one emphasised part: `<b>` for the part, the rest as written. */
function Lead({ strong, rest }: { strong: string; rest: string }) {
  return (
    <>
      <b>{strong}</b> {rest}
    </>
  );
}

const input =
  "w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";
const primary = "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50";
const secondary = "rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50";

/**
 * Secret-chat controls for a 1:1 conversation. A secret chat that is on and
 * working must look like any other chat to someone glancing at the screen, so
 * this renders NOTHING for it - and nothing for an ordinary chat either
 * (an opt-in strip on ordinary chats would make its absence the tell).
 * Everything is reached from "Chat privacy" in the header's menu
 * (chat-options-menu.tsx), which is identical on every 1:1 chat.
 *
 * A strip appears above the thread only when the user has to act or is at
 * risk: the other person asked to turn it on, my own request is still pending
 * (messages are NOT encrypted yet - also what shows the moment the other
 * person turns it off), this device can't read the messages yet, or the other
 * person's key changed. Keep any new strip to that rule, and keep its wording
 * free of "secret", locks and accent colour.
 */
export function SecretChatBar({ secret, peerName }: { secret: SecretChat; peerName: string }) {
  const { privacyOpen, setPrivacyOpen } = useChatOptions();
  const [ownDialog, setDialog] = useState<Dialog>(null);
  const dialog: Dialog = ownDialog ?? (privacyOpen ? "privacy" : null);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const { t: messages } = useMessagesText();
  const t = messages.privacy;
  const passwordLabels = messages.controls.passwordInput;
  // The 6 dialogs below now share one Sheet instance (see that file), but
  // `dialog` itself goes null the instant it's dismissed — which would
  // otherwise blank the dialog's content/title mid-close-animation.
  // Remembers the last real dialog type for content purposes while
  // `dialog !== null` alone still drives the Sheet's `open`; adjusted
  // during render (React's documented pattern for this) rather than a
  // useEffect.
  const [displayedDialog, setDisplayedDialog] = useState<Dialog>(null);
  if (dialog !== null && dialog !== displayedDialog) setDisplayedDialog(dialog);

  const state = secret.phase === "unavailable" || secret.phase === "loading" ? null : secret.state;

  const name = peerName || state?.peer.name || messages.fallback.someone;
  const close = () => {
    setDialog(null);
    setPrivacyOpen(false);
    setPass("");
    setPass2("");
    setError(null);
  };

  /** "Turn on" takes whatever route the device needs: set up keys, restore keys, or just flip the switch. */
  function turnOn() {
    setError(null);
    if (secret.phase === "no-keys") return setDialog("setup");
    if (secret.phase === "needs-restore") return setDialog("restore");
    startTransition(async () => {
      const result = await secret.enable();
      if (result.error) setError(t.errors.turnOn);
    });
  }

  function submitSetup() {
    setError(null);
    if (pass.length < E2EE_MIN_PASSPHRASE_LENGTH) {
      return setError(format(t.errors.tooShort, { min: E2EE_MIN_PASSPHRASE_LENGTH }));
    }
    if (pass !== pass2) return setError(t.errors.mismatch);
    startTransition(async () => {
      const made = await secret.setup(pass);
      if (made.error) {
        setError(made.error === "already_setup" ? t.errors.alreadySetup : t.errors.setup);
        return;
      }
      const turned = await secret.enable();
      if (turned.error) setError(t.errors.keysReady);
      else close();
    });
  }

  function submitRestore() {
    setError(null);
    startTransition(async () => {
      const result = await secret.restore(pass);
      if (result.error) {
        setError(
          result.error === "wrong_passphrase"
            ? t.errors.wrongPassphrase
            : result.error === "rate_limited"
              ? t.errors.rateLimited
              : t.errors.restore,
        );
        return;
      }
      close();
    });
  }

  function submitReset() {
    setError(null);
    startTransition(async () => {
      const result = await secret.reset();
      if (result.error) return setError(t.errors.reset);
      setPass("");
      setPass2("");
      setDialog("setup");
    });
  }

  /** From the "Chat privacy" sheet into one of its own dialogs: the two share one Sheet, so swap rather than stack. */
  function openFromPrivacy(next: Exclude<Dialog, null | "privacy">) {
    setError(null);
    setPrivacyOpen(false);
    setDialog(next);
  }

  function submitTurnOff() {
    startTransition(async () => {
      await secret.disable();
      close();
    });
  }

  // "Waiting for … to turn it on." / "… hasn't set it up yet.", shown while my own request is pending.
  const pendingNote = format(state?.peerHasKeys ? t.strip.waiting : t.strip.peerNotSetUp, { name });

  // ---------- the strip (only for states that need the user) ----------
  let strip: ReactNode = null;
  if (!state) {
    strip = null;
  } else if (state.active && secret.phase === "needs-restore") {
    strip = (
      <>
        <p className="min-w-0 flex-1">{t.strip.needsRestore}</p>
        <button type="button" onClick={() => setDialog("restore")} className={secondary}>{t.unlockMessages}</button>
      </>
    );
  } else if (state.active) {
    strip = null;
  } else if (state.meEnabled) {
    strip = (
      <>
        <p className="min-w-0 flex-1">
          <Lead strong={t.strip.requested} rest={pendingNote} /> <b>{t.strip.notEncryptedYet}</b>
        </p>
        <button type="button" onClick={() => secret.disable()} className={secondary}>{t.cancel}</button>
      </>
    );
  } else if (state.peerEnabled) {
    strip = (
      <>
        <p className="min-w-0 flex-1">
          <Lead strong={format(t.strip.peerWants, { name })} rest={t.strip.peerWantsDetail} />
        </p>
        <button type="button" onClick={turnOn} disabled={busy} className={primary}>{t.turnOn}</button>
      </>
    );
  }

  // ---------- what "Chat privacy" in the header menu opens ----------
  let privacy: ReactNode;
  if (secret.phase === "loading") {
    privacy = <p className="text-foreground-soft">{t.loading}</p>;
  } else if (!state) {
    privacy = <p className="text-foreground-soft">{t.unavailable}</p>;
  } else if (state.active && secret.phase === "needs-restore") {
    privacy = (
      <>
        <p className="text-foreground-soft">{t.sheet.needsRestore}</p>
        <button type="button" onClick={() => openFromPrivacy("restore")} className={`${primary} mt-3 w-full`}>
          {t.unlockMessages}
        </button>
      </>
    );
  } else if (state.active) {
    privacy = (
      <>
        <p className="text-foreground-soft">
          <Lead strong={t.sheet.on} rest={t.sheet.onDetail} />
        </p>
        <p className="mt-2 text-xs text-foreground-soft">{t.sheet.onNote}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => openFromPrivacy("verify")} className={secondary}>{t.verifyCode}</button>
          <button type="button" onClick={() => openFromPrivacy("turn-off")} className={secondary}>{t.turnOff}</button>
        </div>
      </>
    );
  } else if (state.meEnabled) {
    privacy = (
      <>
        <p className="text-foreground-soft">
          {t.sheet.asked} {pendingNote} <b>{t.strip.notEncryptedYet}</b>
        </p>
        <button type="button" onClick={() => secret.disable()} className={`${secondary} mt-3`}>{t.cancelRequest}</button>
      </>
    );
  } else {
    privacy = (
      <>
        <p className="text-foreground-soft">
          {format(state.peerEnabled ? t.sheet.peerWants : t.sheet.offer, { name })}
        </p>
        <p className="mt-2 text-xs text-foreground-soft">{t.sheet.offerNote}</p>
        <button type="button" onClick={turnOn} disabled={busy} className={`${primary} mt-3 w-full`}>{t.turnOn}</button>
      </>
    );
  }

  const keyChanged = secret.peerKeyChanged && Boolean(state?.active);
  const inlineError = error && !dialog ? error : null;

  return (
    <div className={strip || inlineError || keyChanged ? "mb-2 space-y-2 text-xs" : "text-xs"}>
      {strip && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
          <Info size={14} className="shrink-0 text-foreground-soft" />
          {strip}
        </div>
      )}

      {inlineError && <p role="alert" className="text-danger">{inlineError}</p>}

      {keyChanged && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger bg-danger/10 px-3 py-2 text-danger">
          <ShieldAlert size={14} className="shrink-0" />
          <p className="min-w-0 flex-1">
            <Lead strong={format(t.strip.keyChanged, { name })} rest={t.strip.keyChangedDetail} />
          </p>
          <button type="button" onClick={() => setDialog("verify")} className={secondary}>{t.compare}</button>
        </div>
      )}

      {/* ---------- dialogs ---------- */}
      <Sheet
        open={dialog !== null}
        onClose={close}
        title={displayedDialog ? t.titles[DIALOG_TITLES[displayedDialog]] : undefined}
        panelClassName="max-h-[90vh] overflow-y-auto"
      >
        {displayedDialog === "privacy" && (
          <>
            {privacy}
            {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
          </>
        )}

        {displayedDialog === "setup" && (
          <>
            <p className="text-foreground-soft">{t.setup.intro}</p>
            <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{t.setup.warning}</p>
            <label className="mt-3 block text-xs font-medium text-foreground-soft" htmlFor="sc-pass">
              {t.setup.passphrase}
            </label>
            <PasswordInput
              id="sc-pass"
              defaultVisible
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              className={input}
              wrapperClassName="ph-no-capture mt-1"
              labels={passwordLabels}
            />
            <label className="mt-2 block text-xs font-medium text-foreground-soft" htmlFor="sc-pass2">
              {t.setup.again}
            </label>
            <PasswordInput
              id="sc-pass2"
              defaultVisible
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={pass2}
              onChange={(e) => setPass2(e.target.value)}
              className={input}
              wrapperClassName="ph-no-capture mt-1"
              labels={passwordLabels}
            />
            <p className="mt-1 text-[0.6875rem] text-foreground-soft">
              {format(t.setup.hint, { min: E2EE_MIN_PASSPHRASE_LENGTH })}
            </p>
            {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
            <button type="button" onClick={submitSetup} disabled={busy} className={`${primary} mt-3 w-full`}>
              {busy ? t.setup.busy : t.setup.submit}
            </button>
          </>
        )}

        {displayedDialog === "restore" && (
          <>
            <p className="text-foreground-soft">{t.restore.intro}</p>
            <label className="mt-3 block text-xs font-medium text-foreground-soft" htmlFor="sc-restore">
              {t.setup.passphrase}
            </label>
            <PasswordInput
              id="sc-restore"
              defaultVisible
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              className={input}
              wrapperClassName="ph-no-capture mt-1"
              labels={passwordLabels}
            />
            {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
            <button type="button" onClick={submitRestore} disabled={busy || !pass} className={`${primary} mt-3 w-full`}>
              {busy ? t.restore.busy : t.restore.submit}
            </button>
            <button
              type="button"
              onClick={() => { setError(null); setDialog("reset"); }}
              className="mt-3 w-full text-xs text-foreground-soft hover:text-danger"
            >
              {t.restore.forgot}
            </button>
          </>
        )}

        {displayedDialog === "reset" && (
          <>
            <p className="text-foreground-soft">{t.reset.intro}</p>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-foreground-soft">
              <li>
                <b>{t.reset.lost}</b>
              </li>
              <li>{t.reset.switchedOff}</li>
            </ul>
            {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={submitReset}
                disabled={busy}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? t.reset.busy : t.reset.submit}
              </button>
              <button type="button" onClick={close} className={secondary}>{t.cancel}</button>
            </div>
          </>
        )}

        {displayedDialog === "verify" && (
          <>
            <p className="text-foreground-soft">{format(t.verify.intro, { name })}</p>
            <p
              // Digits in groups, read left to right in every language.
              dir="ltr"
              className="mt-3 rounded-lg border border-line bg-background px-3 py-3 text-center font-mono text-base tracking-wider"
              data-testid="security-code"
            >
              {secret.securityCode ?? "…"}
            </p>
            <p className="mt-2 text-[0.6875rem] text-foreground-soft">
              {t.verify.why}
            </p>
            <div className="mt-4 flex gap-2">
              {secret.peerKeyChanged && (
                <button type="button" onClick={() => { void secret.acceptKeyChange(); close(); }} className={primary}>
                  {t.verify.trust}
                </button>
              )}
              <button type="button" onClick={close} className={secondary}>{t.close}</button>
            </div>
          </>
        )}

        {displayedDialog === "turn-off" && (
          <>
            <p className="text-foreground-soft">{t.turnOffBody}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={submitTurnOff} disabled={busy} className={primary}>
                {busy ? t.turningOff : t.turnOff}
              </button>
              <button type="button" onClick={close} className={secondary}>{t.keepOn}</button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
