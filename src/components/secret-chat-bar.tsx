"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Lock, ShieldAlert, X } from "lucide-react";
import type { SecretChat } from "@/lib/e2ee/use-secret-chat";
import { E2EE_MIN_PASSPHRASE_LENGTH } from "@/lib/e2ee/constants";

type Dialog = null | "setup" | "restore" | "reset" | "verify" | "turn-off";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="animate-modal-panel-in max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-surface p-5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 text-foreground-soft hover:text-accent">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const input =
  "mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";
const primary = "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50";
const secondary = "rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50";

/**
 * The secret-chat strip above a 1:1 conversation: the opt-in, the "waiting for
 * them" state, the "on" state and its honest description, plus the dialogs for
 * setting up / restoring keys, verifying the security code, and turning off.
 * Renders nothing for group chats (secret chats are 1:1 only).
 */
export function SecretChatBar({ secret, peerName }: { secret: SecretChat; peerName: string }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const state = secret.state;
  if (secret.phase === "unavailable" || secret.phase === "loading" || !state) return null;

  const name = peerName || state.peer.name || "They";
  const close = () => {
    setDialog(null);
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
      if (result.error) setError("Couldn't turn on secret chat — try again.");
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
      if (turned.error) setError("Keys are ready, but turning on secret chat failed — try again.");
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

  function submitTurnOff() {
    startTransition(async () => {
      await secret.disable();
      close();
    });
  }

  // ---------- the strip ----------
  let strip: ReactNode;
  if (state.active && secret.phase === "needs-restore") {
    strip = (
      <>
        <p className="min-w-0 flex-1">
          <b>Secret chat is on</b>, but this device can&apos;t read it yet. Enter your recovery passphrase to unlock it.
        </p>
        <button type="button" onClick={() => setDialog("restore")} className={secondary}>Unlock</button>
      </>
    );
  } else if (state.active) {
    strip = (
      <>
        <p className="min-w-0 flex-1">
          <b>Secret chat is on.</b> Messages you send here are end-to-end encrypted — text only; photos, videos and voice
          notes aren&apos;t. Anything sent before this was turned on wasn&apos;t encrypted.
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => setDialog("verify")} className={secondary}>Verify code</button>
          <button type="button" onClick={() => setDialog("turn-off")} className={secondary}>Turn off</button>
        </div>
      </>
    );
  } else if (state.meEnabled) {
    strip = (
      <>
        <p className="min-w-0 flex-1">
          <b>Secret chat requested.</b>{" "}
          {state.peerHasKeys ? `Waiting for ${name} to turn it on.` : `${name} hasn't set up secret chats yet.`} Until then,
          messages are <b>not</b> encrypted.
        </p>
        <button type="button" onClick={() => secret.disable()} className={secondary}>Cancel</button>
      </>
    );
  } else if (state.peerEnabled) {
    strip = (
      <>
        <p className="min-w-0 flex-1">
          <b>{name} wants to make this a secret chat</b> — end-to-end encrypted, so not even we can read the messages.
        </p>
        <button type="button" onClick={turnOn} disabled={busy} className={primary}>Turn on</button>
      </>
    );
  } else {
    strip = (
      <>
        <p className="min-w-0 flex-1 text-foreground-soft">Want this conversation private, even from us?</p>
        <button type="button" onClick={turnOn} disabled={busy} className={secondary}>
          <span className="inline-flex items-center gap-1.5">
            <Lock size={13} />
            Turn on secret chat
          </span>
        </button>
      </>
    );
  }

  return (
    <div className="mb-2 space-y-2 text-xs">
      <div
        className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
          state.active ? "border-accent bg-accent-soft" : "border-line bg-surface"
        }`}
      >
        <Lock size={14} className={state.active ? "shrink-0 text-accent" : "shrink-0 text-foreground-soft"} />
        {strip}
      </div>

      {error && !dialog && <p className="text-danger">{error}</p>}

      {secret.peerKeyChanged && state.active && (
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
      {dialog === "setup" && (
        <Modal title="Set up secret chats" onClose={close}>
          <p className="mt-3 text-foreground-soft">
            Your messages get locked with a key that only your devices hold. Choose a <b>recovery passphrase</b> so you can
            get that key back on a new phone.
          </p>
          <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            We can&apos;t see or reset this passphrase. If you forget it and lose your phone, your old secret messages are
            gone for good.
          </p>
          <label className="mt-3 block text-xs font-medium text-foreground-soft" htmlFor="sc-pass">Recovery passphrase</label>
          <input id="sc-pass" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className={input} />
          <label className="mt-2 block text-xs font-medium text-foreground-soft" htmlFor="sc-pass2">Type it again</label>
          <input id="sc-pass2" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} className={input} />
          <p className="mt-1 text-[11px] text-foreground-soft">
            At least {E2EE_MIN_PASSPHRASE_LENGTH} characters — a few random words works well. This is the only thing protecting
            your backup, so make it long.
          </p>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <button type="button" onClick={submitSetup} disabled={busy} className={`${primary} mt-3 w-full`}>
            {busy ? "Creating your keys… this takes a few seconds" : "Create keys and turn on"}
          </button>
        </Modal>
      )}

      {dialog === "restore" && (
        <Modal title="Unlock your secret chats" onClose={close}>
          <p className="mt-3 text-foreground-soft">This device doesn&apos;t have your key yet. Enter your recovery passphrase to restore it.</p>
          <label className="mt-3 block text-xs font-medium text-foreground-soft" htmlFor="sc-restore">Recovery passphrase</label>
          <input id="sc-restore" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} className={input} />
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <button type="button" onClick={submitRestore} disabled={busy || !pass} className={`${primary} mt-3 w-full`}>
            {busy ? "Unlocking… this takes a few seconds" : "Unlock"}
          </button>
          <button type="button" onClick={() => { setError(null); setDialog("reset"); }} className="mt-3 w-full text-xs text-foreground-soft hover:text-danger">
            I forgot my passphrase
          </button>
        </Modal>
      )}

      {dialog === "reset" && (
        <Modal title="Start over with new keys?" onClose={close}>
          <p className="mt-3 text-foreground-soft">
            Without your passphrase your old key can&apos;t be recovered. You can make new keys, but:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
            <li>Secret messages sent under the old key <b>can&apos;t be read again — by you or the other person</b>.</li>
            <li>Every secret chat you have will switch off until you both turn it back on.</li>
          </ul>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={submitReset} disabled={busy} className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Resetting…" : "Delete my keys and start over"}
            </button>
            <button type="button" onClick={close} className={secondary}>Cancel</button>
          </div>
        </Modal>
      )}

      {dialog === "verify" && (
        <Modal title="Verify security code" onClose={close}>
          <p className="mt-3 text-foreground-soft">
            If this code matches the one on <b>{name}&apos;s</b> phone, this chat is private even from us. Compare it in person
            or over a call you trust — not in this chat.
          </p>
          <p className="mt-3 rounded-lg border border-line bg-background px-3 py-3 text-center font-mono text-base tracking-wider" data-testid="security-code">
            {secret.securityCode ?? "…"}
          </p>
          <p className="mt-2 text-[11px] text-foreground-soft">
            Why it matters: we deliver each person&apos;s public key to the other. Comparing this code is how you know we
            didn&apos;t swap one for another.
          </p>
          <div className="mt-4 flex gap-2">
            {secret.peerKeyChanged && (
              <button type="button" onClick={() => { void secret.acceptKeyChange(); close(); }} className={primary}>
                It matches — trust it
              </button>
            )}
            <button type="button" onClick={close} className={secondary}>Close</button>
          </div>
        </Modal>
      )}

      {dialog === "turn-off" && (
        <Modal title="Turn off secret chat?" onClose={close}>
          <p className="mt-3 text-foreground-soft">
            New messages will be sent unencrypted again, and scanned for policy violations like any other chat. Messages
            already sent stay as they are.
          </p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={submitTurnOff} disabled={busy} className={primary}>{busy ? "Turning off…" : "Turn off"}</button>
            <button type="button" onClick={close} className={secondary}>Keep it on</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
