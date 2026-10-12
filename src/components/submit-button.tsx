"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";
import { sharedEn } from "@/lib/i18n/en";

/**
 * Submit button for a server-action <form>. useFormStatus flips `pending`
 * synchronously on tap, so the button visibly presses/disables/relabels
 * itself the instant it's tapped instead of sitting there looking inert
 * until the round trip finishes — the "did my tap register?" gap that
 * feels broken on a slow or flaky mobile connection. Also tracks
 * navigator.onLine so a fully offline tap gets an explicit message rather
 * than silently hanging (a server action can't complete with no
 * connection at all — this makes that failure visible instead of mysterious).
 */
export function SubmitButton({
  label,
  pendingLabel,
  className,
  pending: pendingOverride,
  offlineMessage = sharedEn.submitButton.offline,
}: {
  label: ReactNode;
  pendingLabel: ReactNode;
  className?: string;
  /** For a form that calls its action from onSubmit rather than through `action`, where useFormStatus never reports pending. */
  pending?: boolean;
  /** The offline notice, for the account screens that aren't in English. */
  offlineMessage?: string;
}) {
  const status = useFormStatus();
  const pending = pendingOverride ?? status.pending;
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <div className="w-full">
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          if (offline) e.preventDefault();
        }}
        className={cn(className, "transition-transform active:scale-[0.97] disabled:opacity-60")}
      >
        {pending ? pendingLabel : label}
      </button>
      {offline && !pending && (
        <p role="alert" className="mt-2 text-center text-xs text-danger">
          {offlineMessage}
        </p>
      )}
    </div>
  );
}
