"use client";

import { useState, useTransition } from "react";
import { fixAppReviewDemoAccount } from "@/app/actions/password-auth";

type Result = Awaited<ReturnType<typeof fixAppReviewDemoAccount>>;

/**
 * Admin one-click repair for the App Store review demo accounts — see fixAppReviewDemoAccount's own doc comment. The
 * password comes from the server's APP_REVIEW_DEMO_PASSWORD environment variable; it is never shown here. Shows what
 * was wrong beforehand (if the account already existed) so an admin can tell whether the account had drifted.
 */
export function FixAppReviewDemoButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  return (
    <div className="rounded-xl border border-line p-4">
      <h2 className="text-sm font-semibold">App Store review demo accounts</h2>
      <p className="mt-1 text-xs text-foreground-soft">
        Finds (or creates) the account App Store Connect&apos;s demo credentials point at, sets the password of every
        demo account to the server&apos;s APP_REVIEW_DEMO_PASSWORD value (not shown here), and clears any
        lockout/verification gate that could block Apple&apos;s reviewer from signing in. Refuses if that variable
        isn&apos;t set.
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
        {isPending ? "Fixing…" : "Fix demo accounts"}
      </button>
      {result?.error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {result.message}
        </p>
      )}
      {result && !result.error && (
        <div role="status" className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
          <p>
            {result.action === "created"
              ? "Account did not exist — created with the configured password, ready to sign in."
              : "Account repaired — password set to the configured value, lockout/verification cleared."}
            {result.othersRepaired > 0 && ` ${result.othersRepaired} other demo account(s) updated the same way.`}
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
