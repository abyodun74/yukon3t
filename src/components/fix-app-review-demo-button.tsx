"use client";

import { useState, useTransition } from "react";
import { fixAppReviewDemoAccount } from "@/app/actions/password-auth";

type Result = Awaited<ReturnType<typeof fixAppReviewDemoAccount>>;

/**
 * Admin one-click repair for the App Store review demo account — see
 * fixAppReviewDemoAccount's own doc comment for why this exists as a real
 * button instead of a local script. Shows exactly what was wrong
 * beforehand (if the account already existed) so an admin can tell at a
 * glance whether this was "just resetting the password to be sure" or
 * "the account had genuinely drifted" before resubmitting to Apple.
 */
export function FixAppReviewDemoButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  return (
    <div className="rounded-xl border border-line p-4">
      <h2 className="text-sm font-semibold">App Store review demo account</h2>
      <p className="mt-1 text-xs text-foreground-soft">
        Finds (or creates) the account App Store Connect&apos;s demo credentials
        point at, resets its password to the known value, and clears any
        lockout/verification gate that could block Apple&apos;s reviewer from
        signing in.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setResult(await fixAppReviewDemoAccount());
          })
        }
        className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
      >
        {isPending ? "Fixing…" : "Fix demo account"}
      </button>
      {result && (
        <div role="status" className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
          <p>
            {result.action === "created"
              ? "Account did not exist — created fresh, ready to sign in."
              : "Account repaired — password reset, lockout/verification cleared."}
          </p>
          {result.before && (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-foreground-soft">
              {JSON.stringify(result.before, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
