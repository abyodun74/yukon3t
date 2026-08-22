"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

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
}: {
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
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
        <p className="mt-2 text-center text-xs text-danger">
          You&apos;re offline — check your connection and try again.
        </p>
      )}
    </div>
  );
}
