"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { UserPlus } from "lucide-react";
import { Sheet } from "@/components/sheet";
import { useShellText } from "@/components/ui-text";
import { leaveGuestPreview } from "@/app/actions/guest-preview";

// Guest preview's client half (rules: src/lib/guest-preview.ts). The server is what enforces read-only (requireUser
// refuses a guest in every write action); this only turns a guest's tap on something members-only into the friendly
// "Create a free account to do this" sheet instead of an error:
// - any form submit, unless the form (or an ancestor) carries data-guest-ok (read-only forms: search, filters, and
//   the sheet's own sign-up / sign-in forms);
// - a click on, or inside, an element marked data-guest-block (like, react, repost, connect, message, call, join,
//   RSVP, vote, subscribe, the composers' fields).
// Both are captured at the document before React's own handlers run, so the action is never even called.

type GuestPreviewContextValue = { isGuest: boolean; promptSignUp: () => void };

const GuestPreviewContext = createContext<GuestPreviewContextValue>({ isGuest: false, promptSignUp: () => {} });

export function useGuestPreview() {
  return useContext(GuestPreviewContext);
}

export function GuestPreviewProvider({
  isGuest,
  feedbackUrl,
  children,
}: {
  isGuest: boolean;
  feedbackUrl: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const promptSignUp = useCallback(() => setOpen(true), []);

  useEffect(() => {
    if (!isGuest) return;
    function onClick(e: MouseEvent) {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest("[data-guest-block]")) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    }
    function onSubmit(e: Event) {
      const form = e.target instanceof Element ? e.target : null;
      if (form?.closest("[data-guest-ok]")) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [isGuest]);

  const value = useMemo(() => ({ isGuest, promptSignUp }), [isGuest, promptSignUp]);

  return (
    <GuestPreviewContext.Provider value={value}>
      {isGuest && <GuestBanner feedbackUrl={feedbackUrl} />}
      {children}
      {isGuest && <GuestSignUpSheet open={open} onClose={() => setOpen(false)} />}
    </GuestPreviewContext.Provider>
  );
}

/** The sheet's and the gated screens' two buttons: end the guest session, then open sign-up or sign-in. */
function GuestExitButtons({ className }: { className?: string }) {
  const { t } = useShellText();
  return (
    <div className={className ?? "flex flex-wrap gap-2"} data-guest-ok>
      <form action={leaveGuestPreview}>
        <input type="hidden" name="to" value="/sign-up" />
        <button type="submit" className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink">
          {t.guest.signUp}
        </button>
      </form>
      <form action={leaveGuestPreview}>
        <input type="hidden" name="to" value="/sign-in" />
        <button type="submit" className="rounded-full border border-line px-5 py-2.5 text-sm font-medium">
          {t.guest.signIn}
        </button>
      </form>
    </div>
  );
}

function GuestBanner({ feedbackUrl }: { feedbackUrl: string }) {
  const { t } = useShellText();
  return (
    <div
      role="region"
      aria-label={t.guest.banner}
      className="border-b border-line bg-accent-soft px-4 py-2 text-sm"
      data-guest-ok
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0">{t.guest.banner}</span>
        <form action={leaveGuestPreview} className="inline">
          <input type="hidden" name="to" value="/sign-up" />
          <button type="submit" className="font-semibold text-accent underline-offset-2 hover:underline">
            {t.guest.bannerSignUp}
          </button>
        </form>
        <a
          href={feedbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ms-auto text-foreground-soft underline-offset-2 hover:underline"
        >
          {t.guest.feedback}
        </a>
      </div>
    </div>
  );
}

function GuestSignUpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useShellText();
  return (
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" responsive title={t.guest.sheetTitle} panelClassName="sm:max-w-sm">
      <div className="space-y-4 p-4 pt-0">
        <div className="flex items-start gap-3">
          <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
          <p className="text-sm text-foreground-soft">{t.guest.sheetBody}</p>
        </div>
        <GuestExitButtons />
        <button type="button" onClick={onClose} className="text-sm text-foreground-soft hover:underline">
          {t.guest.keepExploring}
        </button>
      </div>
    </Sheet>
  );
}

/** A members-only screen, as a guest sees it (server-rendered pages: messages, connections, settings, …). */
export function GuestGatedScreen({ kind }: { kind: "messages" | "connections" | "notifications" | "settings" | "profile" | "create" }) {
  const { t } = useShellText();
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{t.guest.gatedTitle}</h1>
      <p className="mt-3 text-sm text-foreground-soft">{t.guest.gated[kind]}</p>
      <GuestExitButtons className="mt-6 flex flex-wrap justify-center gap-2" />
    </div>
  );
}
