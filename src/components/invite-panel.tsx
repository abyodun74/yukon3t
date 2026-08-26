"use client";

import { useState } from "react";
import { Check, Link2, MessageSquareText, Share2, Users, X } from "lucide-react";

const INVITE_MESSAGE = "Join me on YuKon3t — connect across cultures, interests, and borders:";

type InviteContact = { id: string; name: string | null; tel: string };

// The Contact Picker API (navigator.contacts.select) is real but experimental
// and Chromium-only (Android Chrome, and this app's own Android WebView) —
// no type in the standard DOM lib, and no fallback worth pretending exists
// on browsers that lack it. Feature-detected at call time; every other
// control here (copy link, Web Share, sms: links) is plain, universally
// supported web platform behavior with no plugin or native permission
// needed, which is also why it already works inside the wrapped mobile app
// today (capacitor.config.ts loads the live site directly — see CLAUDE.md).
type ContactsManager = {
  select: (
    properties: Array<"name" | "tel">,
    options?: { multiple?: boolean },
  ) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
};

function getContactsManager(): ContactsManager | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { contacts?: ContactsManager };
  return nav.contacts ?? null;
}

let contactRowId = 0;

export function InvitePanel() {
  // Read directly during render rather than via useEffect+setState — same
  // convention as ShareModal's canNativeShare/url: these are plain,
  // synchronous browser-API reads with nothing to subscribe to, so an
  // effect would just add a redundant extra render for no benefit.
  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/sign-up` : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const canPickContacts = Boolean(getContactsManager());

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [contacts, setContacts] = useState<InviteContact[]>([]);
  const [manualNumber, setManualNumber] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    setTimeout(() => setCopyStatus("idle"), 2000);
  }

  async function shareLink() {
    try {
      await navigator.share({ title: "YuKon3t", text: INVITE_MESSAGE, url: inviteUrl });
    } catch {
      // Cancelling the native share sheet also lands here — not an error worth surfacing.
    }
  }

  async function pickContacts() {
    const manager = getContactsManager();
    if (!manager) return;
    setPickError(null);
    try {
      const picked = await manager.select(["name", "tel"], { multiple: true });
      const rows: InviteContact[] = picked.flatMap((c) =>
        (c.tel ?? []).map((tel) => ({ id: String(contactRowId++), name: c.name?.[0] ?? null, tel })),
      );
      if (rows.length === 0) {
        setPickError("Those contacts don't have a phone number saved.");
        return;
      }
      setContacts((prev) => [...prev, ...rows]);
    } catch {
      // User dismissed the picker — not an error worth surfacing.
    }
  }

  function addManualNumber() {
    const tel = manualNumber.trim();
    if (!tel) return;
    setContacts((prev) => [...prev, { id: String(contactRowId++), name: null, tel }]);
    setManualNumber("");
  }

  function removeContact(id: string) {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  function smsHref(tel: string) {
    return `sms:${encodeURIComponent(tel)}?body=${encodeURIComponent(`${INVITE_MESSAGE} ${inviteUrl}`)}`;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-medium">Your invite link</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-background px-3 py-2 text-xs text-foreground-soft">
            {inviteUrl || "…"}
          </code>
          <button
            type="button"
            onClick={copyLink}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent hover:text-accent"
          >
            {copyStatus === "copied" ? <Check size={14} /> : <Link2 size={14} />}
            {copyStatus === "copied" ? "Copied!" : copyStatus === "failed" ? "Couldn't copy" : "Copy"}
          </button>
          {canShare && (
            <button
              type="button"
              onClick={shareLink}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink"
            >
              <Share2 size={14} />
              Share
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-medium">Invite by text message</p>
        <p className="mt-1 text-xs text-foreground-soft">
          Pick contacts (where supported) or enter a number, then send each one a text with your invite link.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canPickContacts && (
            <button
              type="button"
              onClick={pickContacts}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent hover:text-accent"
            >
              <Users size={14} />
              Choose from contacts
            </button>
          )}
          <input
            type="tel"
            value={manualNumber}
            onChange={(e) => setManualNumber(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManualNumber();
              }
            }}
            placeholder="Or enter a phone number"
            className="min-w-0 flex-1 rounded-lg border border-line bg-background px-3 py-2 text-xs outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={addManualNumber}
            disabled={!manualNumber.trim()}
            className="rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {pickError && <p className="mt-2 text-xs text-danger">{pickError}</p>}

        {contacts.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {contacts.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  {c.name && <p className="truncate text-sm font-medium">{c.name}</p>}
                  <p className="truncate text-xs text-foreground-soft">{c.tel}</p>
                </div>
                <a
                  href={smsHref(c.tel)}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink"
                >
                  <MessageSquareText size={13} />
                  Invite
                </a>
                <button
                  type="button"
                  onClick={() => removeContact(c.id)}
                  aria-label="Remove"
                  className="shrink-0 text-foreground-soft hover:text-danger"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
