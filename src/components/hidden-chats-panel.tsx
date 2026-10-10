"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import {
  changeHiddenPin,
  lockHiddenChats,
  requestHiddenPinResetCode,
  resetHiddenPin,
  resetHiddenPinWithCode,
  setHiddenPin,
  unlockHiddenChats,
} from "@/app/actions/hidden-chats";
import { HiddenPinField, hiddenPinErrorMessage } from "@/components/hidden-pin-field";
import { MessagesInboxList, type InboxItem } from "@/components/messages-inbox-list";
import { PasswordInput } from "@/components/password-input";
import { HIDDEN_CHATS_PATH } from "@/lib/hidden-chats-rules";

const PRIMARY_BUTTON =
  "w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50";
const LINK_BUTTON = "text-sm font-medium text-accent hover:underline";
const TEXT_INPUT =
  "w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent";
const PINS_DIFFER = "Those two PINs don't match.";

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
      {error}
    </p>
  );
}

function FormShell({
  onSubmit,
  error,
  children,
}: {
  onSubmit: () => void;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <form
      className="mt-5 space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <ErrorNote error={error} />
    </form>
  );
}

function NewPinFields({
  pin,
  confirmPin,
  onPin,
  onConfirmPin,
  autoFocus,
}: {
  pin: string;
  confirmPin: string;
  onPin: (v: string) => void;
  onConfirmPin: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <>
      <HiddenPinField
        id="hidden-new-pin"
        label="New PIN (4 to 8 digits)"
        value={pin}
        onChange={onPin}
        autoFocus={autoFocus}
      />
      <HiddenPinField id="hidden-confirm-pin" label="Enter it again" value={confirmPin} onChange={onConfirmPin} />
    </>
  );
}

export function SetHiddenPinForm({ submitLabel, onDone }: { submitLabel: string; onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (pin !== confirmPin) return setError(PINS_DIFFER);
    startTransition(async () => {
      const result = await setHiddenPin(pin, confirmPin);
      if (result.error && result.error !== "already_set") return setError(hiddenPinErrorMessage(result));
      onDone();
    });
  }

  return (
    <FormShell onSubmit={submit} error={error}>
      <NewPinFields pin={pin} confirmPin={confirmPin} onPin={setPin} onConfirmPin={setConfirmPin} autoFocus />
      <button type="submit" disabled={isPending} className={PRIMARY_BUTTON}>
        {isPending ? "Saving..." : submitLabel}
      </button>
    </FormShell>
  );
}

function UnlockForm({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await unlockHiddenChats(pin);
      if (result.error) {
        setPin("");
        return setError(hiddenPinErrorMessage(result));
      }
      onDone();
    });
  }

  return (
    <FormShell onSubmit={submit} error={error}>
      <HiddenPinField id="hidden-unlock-pin" label="PIN" value={pin} onChange={setPin} autoFocus />
      <button type="submit" disabled={isPending || pin.length < 4} className={PRIMARY_BUTTON}>
        {isPending ? "Checking..." : "Unlock"}
      </button>
    </FormShell>
  );
}

function ChangePinForm({ onDone }: { onDone: () => void }) {
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (pin !== confirmPin) return setError(PINS_DIFFER);
    startTransition(async () => {
      const result = await changeHiddenPin(currentPin, pin, confirmPin);
      if (result.error) return setError(hiddenPinErrorMessage(result));
      onDone();
    });
  }

  return (
    <FormShell onSubmit={submit} error={error}>
      <HiddenPinField
        id="hidden-current-pin"
        label="Current PIN"
        value={currentPin}
        onChange={setCurrentPin}
        autoFocus
      />
      <NewPinFields pin={pin} confirmPin={confirmPin} onPin={setPin} onConfirmPin={setConfirmPin} />
      <button type="submit" disabled={isPending} className={PRIMARY_BUTTON}>
        {isPending ? "Saving..." : "Change PIN"}
      </button>
    </FormShell>
  );
}

/** "Forgot PIN": the account password where there is one, otherwise a code emailed to the account's address. */
function ResetPinForm({ hasPassword, onDone }: { hasPassword: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function sendCode() {
    setError(null);
    startTransition(async () => {
      const result = await requestHiddenPinResetCode();
      if (result.error !== null) return setError(hiddenPinErrorMessage(result));
      setChallengeId(result.challengeId);
    });
  }

  function submit() {
    if (pin !== confirmPin) return setError(PINS_DIFFER);
    startTransition(async () => {
      const result = hasPassword
        ? await resetHiddenPin(password, pin, confirmPin)
        : await resetHiddenPinWithCode(challengeId ?? "", code, pin, confirmPin);
      if (result.error) return setError(hiddenPinErrorMessage(result, "password"));
      onDone();
    });
  }

  if (!hasPassword && !challengeId) {
    return (
      <div className="mt-5 space-y-4">
        <p className="text-sm text-foreground-soft">
          We&apos;ll email a code to your account&apos;s address. Your hidden chats stay hidden.
        </p>
        <ErrorNote error={error} />
        <button type="button" disabled={isPending} onClick={sendCode} className={PRIMARY_BUTTON}>
          {isPending ? "Sending..." : "Email me a code"}
        </button>
      </div>
    );
  }

  return (
    <FormShell onSubmit={submit} error={error}>
      {hasPassword ? (
        <div>
          <label htmlFor="hidden-account-password" className="block text-sm font-medium">
            Your account password
          </label>
          <PasswordInput
            id="hidden-account-password"
            required
            maxLength={72}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            wrapperClassName="mt-1"
            className={`ph-no-capture ${TEXT_INPUT}`}
          />
        </div>
      ) : (
        <div>
          <label htmlFor="hidden-reset-code" className="block text-sm font-medium">
            Code from the email
          </label>
          <input
            id="hidden-reset-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={`ph-no-capture mt-1 ${TEXT_INPUT}`}
          />
        </div>
      )}
      <NewPinFields pin={pin} confirmPin={confirmPin} onPin={setPin} onConfirmPin={setConfirmPin} />
      <p className="text-xs text-foreground-soft">Your hidden chats stay hidden. Only the PIN changes.</p>
      <button type="submit" disabled={isPending} className={PRIMARY_BUTTON}>
        {isPending ? "Saving..." : "Reset PIN"}
      </button>
    </FormShell>
  );
}

type Mode = "main" | "change" | "reset";

export function HiddenChatsPanel({
  state,
  hasPassword,
  items,
  next,
}: {
  state: "no_pin" | "locked" | "unlocked";
  hasPassword: boolean;
  items: InboxItem[];
  /** The hidden thread that sent the user here to unlock; they go back to it afterwards. */
  next: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("main");
  const [notice, setNotice] = useState<string | null>(null);
  const [isLocking, startLocking] = useTransition();

  function refresh(message: string | null) {
    setMode("main");
    setNotice(message);
    router.refresh();
  }

  function lockNow() {
    startLocking(async () => {
      await lockHiddenChats();
      router.replace(HIDDEN_CHATS_PATH);
      router.refresh();
    });
  }

  const cancel = (
    <button type="button" onClick={() => setMode("main")} className={`mt-4 ${LINK_BUTTON}`}>
      Cancel
    </button>
  );

  if (mode === "reset") {
    return (
      <div>
        <h2 className="text-lg font-semibold">Reset your PIN</h2>
        <ResetPinForm hasPassword={hasPassword} onDone={() => refresh("PIN reset. Enter the new one to continue.")} />
        {cancel}
      </div>
    );
  }
  if (mode === "change") {
    return (
      <div>
        <h2 className="text-lg font-semibold">Change your PIN</h2>
        <ChangePinForm onDone={() => refresh("PIN changed.")} />
        {cancel}
      </div>
    );
  }

  if (state === "no_pin") {
    return (
      <div>
        <p className="text-sm text-foreground-soft">
          Hide a chat from its menu and it leaves your Messages list, badges and notifications. It can only be opened
          here, with a PIN. Choose one to get started.
        </p>
        <SetHiddenPinForm submitLabel="Set PIN" onDone={() => refresh("PIN set. Enter it to continue.")} />
      </div>
    );
  }

  if (state === "locked") {
    return (
      <div>
        {notice && <p className="mb-3 rounded-lg bg-accent-soft px-4 py-2 text-sm">{notice}</p>}
        <p className="text-sm text-foreground-soft">Enter your PIN to continue.</p>
        <UnlockForm
          onDone={() => {
            setNotice(null);
            if (next) router.replace(next);
            router.refresh();
          }}
        />
        <button type="button" onClick={() => setMode("reset")} className={`mt-4 ${LINK_BUTTON}`}>
          Forgot PIN?
        </button>
      </div>
    );
  }

  return (
    <div>
      {notice && <p className="mb-4 rounded-lg bg-accent-soft px-4 py-2 text-sm">{notice}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={lockNow}
          disabled={isLocking}
          className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <Lock size={14} /> Lock now
        </button>
        <button type="button" onClick={() => setMode("change")} className={LINK_BUTTON}>
          Change PIN
        </button>
        <button type="button" onClick={() => setMode("reset")} className={LINK_BUTTON}>
          Forgot PIN?
        </button>
      </div>
      <div className="mt-5">
        {items.length > 0 ? (
          <MessagesInboxList items={items} />
        ) : (
          <p className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-foreground-soft">
            Nothing here yet. Open a chat, tap the menu at the top and choose &ldquo;Hide chat&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
