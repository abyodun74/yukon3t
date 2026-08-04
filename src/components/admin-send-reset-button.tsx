"use client";

import { useState, useTransition } from "react";
import { adminSendPasswordReset } from "@/app/actions/password-auth";

/** Support tool: send a password reset link to a customer's registered email on their behalf. */
export function AdminSendResetButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");

  return (
    <div>
      <button
        type="button"
        disabled={isPending || status === "sent"}
        onClick={() =>
          startTransition(async () => {
            const result = await adminSendPasswordReset(userId);
            setStatus(result.error ? "error" : "sent");
          })
        }
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {status === "sent" ? "Reset link sent" : "Send password reset link"}
      </button>
      {status === "error" && (
        <p className="mt-1 text-xs text-danger">Couldn&apos;t send — try again.</p>
      )}
    </div>
  );
}
