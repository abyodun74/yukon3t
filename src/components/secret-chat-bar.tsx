"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Info, ShieldAlert } from "lucide-react";
import type { SecretChat } from "@/lib/e2ee/use-secret-chat";
import { E2EE_MIN_PASSPHRASE_LENGTH } from "@/lib/e2ee/constants";
import { Sheet } from "@/components/sheet";
import { PasswordInput } from "@/components/password-input";
import { useChatOptions } from "@/components/chat-options-menu";

type Dialog = null | "privacy" | "setup" | "restore" | "reset" | "verify" | "turn-off";

const DIALOG_TITLES: Record<Exclude<Dialog, null>, string> = {
  privacy: "Chat privacy",
  setup: "Set up chat privacy",
  restore: "Unlock your messages",
  reset: "Start over with new keys?",
  verify: "Verify security code",
  "turn-off": "Turn off chat privacy?",
};

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

  const name = peerName || state?.peer.name || "They";
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
      if (result.error) setError("Couldn't turn that on — try again.");
    });
  }

  function submitSetup() {
    setError(null);
    if (pass.length < E2EE_MIN_PASSPHRASE_LENGTH) return setError(`Use at least ${E2EE_MIN_PASSPHRASE_LENGTH} characters.`);
    if (pass !== pass2) return setError("Those two passphrases don't match.");
    startTransition(async () => {
      const made = await secret.setup(pass);
      if (made.error) {
        setError(made.error === "already_setup" ? "You already set this up — restore it with your passphrase instead." : "Couldn't set that up — try again.");
        return;
      }
      const turned = await secret.enable();
      if (turned.error) setError("Keys are ready, but turning it on failed — try again.");
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
            ? "That passphrase didn't unlock your keys."
            : result.error === "rate_limited"
              ? "Too many tries — wait a bit and try again."
              : "Couldn't restore your keys — try again.",
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
      if (result.error) return setError("Couldn't reset — try again shortly.");
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

  // ---------- the strip (only for states that need the user) ----------
  let strip: ReactNode = null;
  if (!state) {
    strip = null;
  } else if (state.active && secret.phase === "needs-restore") {
    strip = (
      <>
        <p className="min-w-0 flex-1">
          This device can&apos;t read some messages in this chat yet. Enter your recovery passphrase to unlock them.
        </p>
        <button type="button" onClick={() => setDialog("restore")} className={secondary}>Unlock messages</button>
      </>
    );
  } else if (state.active) {
    strip = null;
  } else if (state.meEnabled) {
    strip = (
      <>
        <p className="min-w-0 flex-1">
          <b>Chat privacy requested.</b>{" "}
          {state.peerHasKeys ? `Waiting for ${name} to turn it on.` : `${name} hasn't set it up yet.`} Until then,
          messages are <b>not</b> encrypted.
        </p>
        <button type="button" onClick={() => secret.disable()} className={secondary}>Cancel</button>
      </>
    );
  } else if (state.peerEnabled) {
    strip = (
      <>
        <p className="min-w-0 flex-1">
          <b>{name} wants to turn on chat privacy</b> — end-to-end encryption, so not even we can read the messages.
        </p>
        <button type="button" onClick={turnOn} disabled={busy} className={primary}>Turn on</button>
      </>
    );
  }

  // ---------- what "Chat privacy" in the header menu opens ----------
  let privacy: ReactNode;
  if (secret.phase === "loading") {
    privacy = <p className="text-foreground-soft">Loading…</p>;
  } else if (!state) {
    privacy = <p className="text-foreground-soft">Privacy options aren&apos;t available for this chat right now.</p>;
  } else if (state.active && secret.phase === "needs-restore") {
    privacy = (
      <>
        <p className="text-foreground-soft">
          Messages in this chat are end-to-end encrypted, but this device can&apos;t read them yet. Enter your recovery
          passphrase to unlock them.
        </p>
        <button type="button" onClick={() => openFromPrivacy("restore")} className={`${primary} mt-3 w-full`}>
          Unlock messages
        </button>
      </>
    );
  } else if (state.active) {
    privacy = (
      <>
        <p className="text-foreground-soft">
          <b>End-to-end encryption is on.</b> Messages you send here are encrypted — text only; photos, videos and
          voice notes aren&apos;t. Anything sent before this was turned on wasn&apos;t encrypted.
        </p>
        <p className="mt-2 text-xs text-foreground-soft">
          Nothing in this chat, your inbox or your notifications marks it as encrypted. This menu is the only place
          that says so.
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => openFromPrivacy("verify")} className={secondary}>Verify code</button>
          <button type="button" onClick={() => openFromPrivacy("turn-off")} className={secondary}>Turn off</button>
        </div>
      </>
    );
  } else if (state.meEnabled) {
    privacy = (
      <>
        <p className="text-foreground-soft">
          You asked to turn on end-to-end encryption.{" "}
          {state.peerHasKeys ? `Waiting for ${name} to turn it on.` : `${name} hasn't set it up yet.`} Until then,
          messages are <b>not</b> encrypted.
        </p>
        <button type="button" onClick={() => secret.disable()} className={`${secondary} mt-3`}>Cancel request</button>
      </>
    );
  } else {
    privacy = (
      <>
        <p className="text-foreground-soft">
          {state.peerEnabled
            ? `${name} wants to turn on end-to-end encryption for this chat, so not even we can read the text of your messages.`
            : `Turn on end-to-end encryption for this chat, so not even we can read the text of your messages. ${name} has to turn it on too.`}
        </p>
        <p className="mt-2 text-xs text-foreground-soft">
          Once it&apos;s on, nothing in this chat, your inbox or your notifications marks it as encrypted. You&apos;ll
          find the controls here.
        </p>
        <button type="button" onClick={turnOn} disabled={busy} className={`${primary} mt-3 w-full`}>Turn on</button>
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
            <b>{name}&apos;s security code changed.</b> They may have a new phone or reset their keys — or someone may be in
            the middle. Compare the code with them before trusting new messages.
          </p>
          <button type="button" onClick={() => setDialog("verify")} className={secondary}>Compare</button>
        </div>
      )}

      {/* ---------- dialogs ---------- */}
      <Sheet
        open={dialog !== null}
        onClose={close}
        title={displayedDialog ? DIALOG_TITLES[displayedDialog] : undefined}
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
            <p className="text-foreground-soft">
              Your messages get locked with a key that only your devices hold. Choose a <b>recovery passphrase</b> so
              you can get that key back on a new phone.
            </p>
            <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              We can&apos;t see or reset this passphrase. If you forget it and lose your phone, your old encrypted
              messages are gone for good.
            </p>
            <label className="mt-3 block text-xs font-medium text-foreground-soft" htmlFor="sc-pass">
              Recovery passphrase
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
            />
            <label className="mt-2 block text-xs font-medium text-foreground-soft" htmlFor="sc-pass2">
              Type it again
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
            />
            <p className="mt-1 text-[0.6875rem] text-foreground-soft">
              At least {E2EE_MIN_PASSPHRASE_LENGTH} characters — a few random words works well. This is the only thing
              protecting your backup, so make it long.
            </p>
            {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
            <button type="button" onClick={submitSetup} disabled={busy} className={`${primary} mt-3 w-full`}>
              {busy ? "Creating your keys… this takes a few seconds" : "Create keys and turn on"}
            </button>
          </>
        )}

        {displayedDialog === "restore" && (
          <>
            <p className="text-foreground-soft">
              This device doesn&apos;t have your key yet. Enter your recovery passphrase to restore it.
            </p>
            <label className="mt-3 block text-xs font-medium text-foreground-soft" htmlFor="sc-restore">
              Recovery passphrase
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
            />
            {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
            <button type="button" onClick={submitRestore} disabled={busy || !pass} className={`${primary} mt-3 w-full`}>
              {busy ? "Unlocking… this takes a few seconds" : "Unlock"}
            </button>
            <button
              type="button"
              onClick={() => { setError(null); setDialog("reset"); }}
              className="mt-3 w-full text-xs text-foreground-soft hover:text-danger"
            >
              I forgot my passphrase
            </button>
          </>
        )}

        {displayedDialog === "reset" && (
          <>
            <p className="text-foreground-soft">
              Without your passphrase your old key can&apos;t be recovered. You can make new keys, but:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
              <li>
                Encrypted messages sent under the old key <b>can&apos;t be read again — by you or the other person</b>.
              </li>
              <li>Every encrypted chat you have will switch off until you both turn it back on.</li>
            </ul>
            {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={submitReset}
                disabled={busy}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Resetting…" : "Delete my keys and start over"}
              </button>
              <button type="button" onClick={close} className={secondary}>Cancel</button>
            </div>
          </>
        )}

        {displayedDialog === "verify" && (
          <>
            <p className="text-foreground-soft">
              If this code matches the one on <b>{name}&apos;s</b> phone, this chat is private even from us. Compare
              it in person or over a call you trust — not in this chat.
            </p>
            <p
              className="mt-3 rounded-lg border border-line bg-background px-3 py-3 text-center font-mono text-base tracking-wider"
              data-testid="security-code"
            >
              {secret.securityCode ?? "…"}
            </p>
            <p className="mt-2 text-[0.6875rem] text-foreground-soft">
              Why it matters: we deliver each person&apos;s public key to the other. Comparing this code is how you
              know we didn&apos;t swap one for another.
            </p>
            <div className="mt-4 flex gap-2">
              {secret.peerKeyChanged && (
                <button type="button" onClick={() => { void secret.acceptKeyChange(); close(); }} className={primary}>
                  It matches — trust it
                </button>
              )}
              <button type="button" onClick={close} className={secondary}>Close</button>
            </div>
          </>
        )}

        {displayedDialog === "turn-off" && (
          <>
            <p className="text-foreground-soft">
              New messages will be sent unencrypted again, and scanned for policy violations like any other chat.
              Messages already sent stay as they are.
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={submitTurnOff} disabled={busy} className={primary}>
                {busy ? "Turning off…" : "Turn off"}
              </button>
              <button type="button" onClick={close} className={secondary}>Keep it on</button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
