"use client";

import { useState, useTransition } from "react";
import { exportMyData, deleteMyAccount, deactivateAccount } from "@/app/actions/profile";
import { requestAccountReauthCode } from "@/app/actions/account-reauth";
import { useSettingsText } from "@/components/settings-text";
import { PasswordInput } from "@/components/password-input";
import type { ReauthAction, ReauthMethod, ReauthProof } from "@/lib/account-reauth-rules";
import type { sharedEn } from "@/lib/i18n/en/shared";

const TEXT_INPUT =
  "w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent";

type ReauthErrorKey = keyof ReturnType<typeof useSettingsText>["t"]["data"]["reauth"]["errors"] | "demo_account";

function reauthErrorKey(error: string): ReauthErrorKey {
  switch (error) {
    case "reauth_required":
    case "wrong_password":
    case "wrong_code":
    case "code_expired":
    case "rate_limited":
    case "demo_account": // APP_REVIEW_DEMO_REFUSED: the shared App Review accounts can't export or delete
      return error;
    default:
      return "send_failed";
  }
}

/**
 * "Confirm it's you" before an irreversible action (account-reauth-rules.ts): the account password, or a code emailed
 * to the account's address for an account without a usable password. The proof goes to the action itself, which
 * checks it on the server; nothing here decides anything.
 */
function ReauthForm({
  action,
  method,
  passwordLabels,
  confirmLabel,
  confirmClassName,
  rateLimitedMessage,
  onConfirm,
  onCancel,
}: {
  action: ReauthAction;
  method: ReauthMethod;
  passwordLabels?: typeof sharedEn.passwordInput;
  confirmLabel: string;
  confirmClassName: string;
  /** Shown instead of the generic "too many attempts" (the export has its own limit). */
  rateLimitedMessage?: string;
  /** Runs the action with the proof; resolves to an error code to show, or null once it has succeeded. */
  onConfirm: (proof: ReauthProof) => Promise<string | null>;
  onCancel: () => void;
}) {
  const settingsText = useSettingsText().t;
  const data = settingsText.data;
  const t = data.reauth;
  const [isPending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ReauthErrorKey | null>(null);

  function sendCode() {
    startTransition(async () => {
      setError(null);
      const result = await requestAccountReauthCode(action);
      if (result.error === null) {
        setChallengeId(result.challengeId);
        setCode("");
        setSent(true);
        return;
      }
      setError(reauthErrorKey(result.error));
    });
  }

  function confirm(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      setError(null);
      const proof: ReauthProof =
        method === "password" ? { password } : { challengeId: challengeId ?? undefined, code: code.trim() };
      const failure = await onConfirm(proof);
      if (failure) setError(reauthErrorKey(failure));
    });
  }

  const ready = method === "password" ? password.length > 0 : challengeId !== null && /^\d{6}$/.test(code.trim());
  const errorId = `reauth-${action}-error`;

  return (
    <form onSubmit={confirm} className="mt-3 space-y-3">
      {method === "password" ? (
        <div>
          <p className="text-sm text-foreground-soft">{t.passwordPrompt}</p>
          <label htmlFor={`reauth-${action}-password`} className="mt-2 block text-sm font-medium">
            {t.passwordLabel}
          </label>
          <PasswordInput
            id={`reauth-${action}-password`}
            required
            maxLength={256}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            wrapperClassName="mt-1"
            className={`ph-no-capture ${TEXT_INPUT}`}
            invalid={error === "wrong_password"}
            describedBy={error ? errorId : undefined}
            labels={passwordLabels}
          />
        </div>
      ) : (
        <div>
          <p className="text-sm text-foreground-soft">{sent ? t.codeSent : t.codePrompt}</p>
          <button
            type="button"
            onClick={sendCode}
            disabled={isPending}
            className="mt-2 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {sent ? t.sendAgain : t.sendCode}
          </button>
          {challengeId && (
            <div className="mt-3">
              <label htmlFor={`reauth-${action}-code`} className="block text-sm font-medium">
                {t.codeLabel}
              </label>
              <input
                id={`reauth-${action}-code`}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                dir="ltr"
                aria-invalid={error === "wrong_code" || error === "code_expired" || undefined}
                aria-describedby={error ? errorId : undefined}
                className={`ph-no-capture mt-1 ${TEXT_INPUT}`}
              />
            </div>
          )}
        </div>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error === "demo_account"
            ? settingsText.errors.demo_account
            : error === "rate_limited" && rateLimitedMessage
              ? rateLimitedMessage
              : t.errors[error]}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={isPending || !ready} className={confirmClassName}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-foreground-soft">
          {data.cancel}
        </button>
      </div>
    </form>
  );
}

/**
 * Settings → Your data. `reauthMethod` (accountReauthMethod, from the page) says how "Export my data" and "Delete
 * account" confirm it's the account holder; `passwordLabels` are the show/hide button's names in the page's language.
 * showHeading: false when the page already titles this block "Your data" (Settings' collapsible section).
 */
export function AccountDangerZone({
  showHeading = true,
  reauthMethod,
  passwordLabels,
}: {
  showHeading?: boolean;
  reauthMethod: ReauthMethod;
  passwordLabels?: typeof sharedEn.passwordInput;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const t = useSettingsText().t.data;
  // Under the page's own "Your data" heading these are its sub-headings.
  const Sub = showHeading ? "h2" : "h3";

  async function runExport(proof: ReauthProof): Promise<string | null> {
    const result = await exportMyData(proof);
    if (result.error !== null) return result.error;
    const blob = new Blob([result.data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "yukon3t-my-data.json";
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
    return null;
  }

  async function runDelete(proof: ReauthProof): Promise<string | null> {
    // On success this signs out and redirects, so it only ever comes back with an error.
    const result = await deleteMyAccount(proof);
    return result?.error ?? null;
  }

  return (
    <div className="space-y-4 rounded-xl border border-danger/40 p-5">
      <div>
        {showHeading && <h2 className="font-semibold">{t.heading}</h2>}
        <p className={`${showHeading ? "mt-1 " : ""}text-sm text-foreground-soft`}>{t.stored}</p>
        <p className="mt-2 text-sm text-foreground-soft">{t.exportIntro}</p>
        {!exporting ? (
          <button
            type="button"
            onClick={() => setExporting(true)}
            className="mt-3 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent"
          >
            {t.export}
          </button>
        ) : (
          <ReauthForm
            action="export"
            method={reauthMethod}
            passwordLabels={passwordLabels}
            confirmLabel={t.reauth.exportConfirm}
            rateLimitedMessage={t.exportLimited}
            confirmClassName="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
            onConfirm={runExport}
            onCancel={() => setExporting(false)}
          />
        )}
      </div>

      <div className="border-t border-line pt-4">
        <Sub className="font-semibold">{t.deactivateHeading}</Sub>
        <p className="mt-1 text-sm text-foreground-soft">{t.deactivateIntro}</p>
        {!confirmingDeactivate ? (
          <button
            type="button"
            onClick={() => setConfirmingDeactivate(true)}
            className="mt-3 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent"
          >
            {t.deactivate}
          </button>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => deactivateAccount())}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {t.deactivateConfirm}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDeactivate(false)}
              className="text-sm text-foreground-soft"
            >
              {t.cancel}
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <Sub className="font-semibold text-danger">{t.deleteHeading}</Sub>
        <p className="mt-1 text-sm text-foreground-soft">{t.deleteIntro}</p>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-3 rounded-lg border border-danger px-4 py-2 text-sm font-medium text-danger"
          >
            {t.delete}
          </button>
        ) : (
          <ReauthForm
            action="delete"
            method={reauthMethod}
            passwordLabels={passwordLabels}
            confirmLabel={t.deleteConfirm}
            confirmClassName="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onConfirm={runDelete}
            onCancel={() => setConfirming(false)}
          />
        )}
      </div>
    </div>
  );
}
