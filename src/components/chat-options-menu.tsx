"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, MoreHorizontal, ShieldCheck, type LucideIcon } from "lucide-react";
import { hideConversation, unhideConversation } from "@/app/actions/hidden-chats";
import { SetHiddenPinForm } from "@/components/hidden-chats-panel";
import { hiddenUnlockPath } from "@/lib/hidden-chats-rules";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useMessagesText } from "@/components/ui-text";

type ChatOptions = {
  privacyOpen: boolean;
  setPrivacyOpen: (open: boolean) => void;
};

const ChatOptionsContext = createContext<ChatOptions>({ privacyOpen: false, setPrivacyOpen: () => {} });

/**
 * Connects the "⋯" menu in a chat's header (rendered by the page) to the
 * sheets it opens, which live down in ChatThread because that is where the
 * chat's state is. Wrap both in this.
 */
export function ChatOptionsProvider({ children }: { children: ReactNode }) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const value = useMemo(() => ({ privacyOpen, setPrivacyOpen }), [privacyOpen]);
  return <ChatOptionsContext.Provider value={value}>{children}</ChatOptionsContext.Provider>;
}

export function useChatOptions() {
  return useContext(ChatOptionsContext);
}

/** First use of "Hide chat": there is no PIN yet, so choose one (twice), then the chat is hidden. */
function SetPinDialog({ onClose, onPinSet }: { onClose: () => void; onPinSet: () => void }) {
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose);
  const t = useMessagesText().t.options;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 outline-none sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-surface p-4 text-foreground sm:rounded-2xl"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {t.pinTitle}
        </h2>
        <p className="mt-1 text-sm text-foreground-soft">
          {t.pinBody}
        </p>
        <SetHiddenPinForm submitLabel={t.pinSubmit} onDone={onPinSet} />
        <button type="button" onClick={onClose} className="mt-3 w-full rounded-lg px-4 py-2 text-sm text-foreground-soft">
          {t.cancel}
        </button>
      </div>
    </div>
  );
}

/**
 * The "⋯" menu on every chat. "Chat privacy" (1:1 only) must look exactly the
 * same whatever the chat's privacy state is: an item that appeared, changed
 * its label or gained a badge only in a secret chat would give the chat away
 * to anyone glancing at the screen. State-dependent content belongs in the
 * sheet an item opens. "Hide chat" / "Unhide chat" is the one label that
 * follows state, and "Unhide" can only ever be seen inside a hidden chat that
 * has already been opened with the PIN.
 */
export function ChatOptionsMenu({
  conversationId,
  isGroup,
  hidden,
}: {
  conversationId: string;
  isGroup: boolean;
  hidden: boolean;
}) {
  const router = useRouter();
  const { setPrivacyOpen } = useChatOptions();
  const [open, setOpen] = useState(false);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useMessagesText().t.options;

  async function hide() {
    const result = await hideConversation(conversationId);
    if (result.error === "no_pin") return setPinDialogOpen(true);
    if (result.error) return;
    setPinDialogOpen(false);
    router.push("/messages");
    router.refresh();
  }

  async function unhide() {
    const result = await unhideConversation(conversationId);
    if (result.error === "hidden_locked") return router.push(hiddenUnlockPath(conversationId));
    router.refresh();
  }

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const items: { label: string; icon: LucideIcon; onSelect: () => void }[] = [
    // Secret chats are 1:1 only.
    ...(isGroup ? [] : [{ label: t.privacy, icon: ShieldCheck, onSelect: () => setPrivacyOpen(true) }]),
    hidden
      ? { label: t.unhide, icon: Eye, onSelect: () => void unhide() }
      : { label: t.hide, icon: EyeOff, onSelect: () => void hide() },
  ];

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t.label}
        aria-expanded={open}
        className="rounded-lg p-2 text-foreground-soft hover:bg-line"
      >
        <MoreHorizontal size={18} />
      </button>

      {open && (
        <div className="absolute end-0 z-20 mt-1 w-52 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {items.map(({ label, icon: Icon, onSelect }) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-line"
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}

      {pinDialogOpen && <SetPinDialog onClose={() => setPinDialogOpen(false)} onPinSet={() => void hide()} />}
    </div>
  );
}
