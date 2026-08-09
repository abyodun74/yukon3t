"use client";

import { useState, useTransition } from "react";
import { adminResendVerificationEmail } from "@/app/actions/password-auth";

/** Support tool: re-send the sign-up confirmation email to a customer stuck unverified. */
export function AdminResendVerificationButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");

  return (
    <div>
      <button
        type="button"
        disabled={isPending || status === "sent"}
        onClick={() =>
          startTransition(async () => {
            const result = await adminResendVerificationEmail(userId);
            setStatus(result.error ? "error" : "sent");
          })
        }
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {status === "sent" ? "Confirmation email sent" : "Resend confirmation email"}
      </button>
      {status === "error" && (
        <p className="mt-1 text-xs text-danger">Couldn&apos;t send — try again.</p>
      )}
    </div>
  );
}
