"use client";

import { useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Check, Link2, MessageSquareText, Search, Share2, Users, X } from "lucide-react";
import type { ContactPayload } from "@capacitor-community/contacts";

const INVITE_MESSAGE = "Join me on YuKon3t — connect across cultures, interests, and borders:";

type InviteContact = { id: string; name: string | null; tel: string };

// The Contact Picker API (navigator.contacts.select) is real but experimental
// and Chromium-only (Android Chrome, and desktop Chrome) — no type in the
// standard DOM lib, and no fallback worth pretending exists on browsers that
// lack it. Kept as the picking mechanism for ordinary browser/PWA visits,
// where it works well and needs no native permission. It is NOT available
// inside this app's own wrapped WebView, though (Capacitor's WebView doesn't
// expose navigator.contacts) — that's what the native path below is for.
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

function flattenNativeContacts(contacts: ContactPayload[]): InviteContact[] {
  const rows = contacts.flatMap((c) =>
    (c.phones ?? [])
      .map((p) => p.number)
      .filter((n): n is string => Boolean(n && n.trim()))
      .map((tel) => ({ id: String(contactRowId++), name: c.name?.display ?? null, tel })),
  );
  return rows.sort((a, b) => (a.name ?? "￿").localeCompare(b.name ?? "￿"));
}

export function InvitePanel() {
  // Read directly during render rather than via useEffect+setState — same
  // convention as ShareModal's canNativeShare/url: these are plain,
  // synchronous browser-API reads with nothing to subscribe to, so an
  // effect would just add a redundant extra render for no benefit.
  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/sign-up` : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const isNative = typeof window !== "undefined" && Capacitor.isNativePlatform();
  const canPickContacts = isNative || Boolean(getContactsManager());

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [contacts, setContacts] = useState<InviteContact[]>([]);
  const [manualNumber, setManualNumber] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);

  // Native-only: the device's full contact list (fetched once per picker
  // open) and the in-app checkbox picker built from it — the OS's own
  // contact-picker sheet isn't reachable from inside a Capacitor WebView, so
  // this app renders its own instead of relying on one.
  const [nativeRows, setNativeRows] = useState<InviteContact[] | null>(null);
  const [nativeLoading, setNativeLoading] = useState(false);
  const [nativeSearch, setNativeSearch] = useState("");
  const [nativeSelected, setNativeSelected] = useState<Set<string>>(new Set());

  const filteredNativeRows = useMemo(() => {
    if (!nativeRows) return [];
    const q = nativeSearch.trim().toLowerCase();
    if (!q) return nativeRows;
    return nativeRows.filter(
      (r) => r.name?.toLowerCase().includes(q) || r.tel.toLowerCase().includes(q),
    );
  }, [nativeRows, nativeSearch]);

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

  async function openContactPicker() {
    setPickError(null);
    if (isNative) {
      setNativeLoading(true);
      setNativeSelected(new Set());
      try {
        const { Contacts } = await import("@capacitor-community/contacts");
        let status = await Contacts.checkPermissions();
        if (status.contacts !== "granted" && status.contacts !== "limited") {
          status = await Contacts.requestPermissions();
        }
        if (status.contacts !== "granted" && status.contacts !== "limited") {
          setPickError(
            "Contacts permission was denied — enable it for YuKon3t in your phone's Settings to invite from your contacts.",
          );
          setNativeLoading(false);
          return;
        }
        const { contacts: fetched } = await Contacts.getContacts({
          projection: { name: true, phones: true },
        });
        const rows = flattenNativeContacts(fetched);
        if (rows.length === 0) {
          setPickError("None of your contacts have a phone number saved.");
          setNativeLoading(false);
          return;
        }
        setNativeRows(rows);
      } catch {
        setPickError("Couldn't open your contacts — please try again.");
      } finally {
        setNativeLoading(false);
      }
      return;
    }

    const manager = getContactsManager();
    if (!manager) return;
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

  function toggleNativeSelected(id: string) {
    setNativeSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function closeNativePicker() {
    setNativeRows(null);
    setNativeSearch("");
    setNativeSelected(new Set());
  }

  function confirmNativeSelection() {
    if (!nativeRows) return;
    const chosen = nativeRows.filter((r) => nativeSelected.has(r.id));
    setContacts((prev) => [...prev, ...chosen]);
    closeNativePicker();
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
              onClick={openContactPicker}
              disabled={nativeLoading}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <Users size={14} />
              {nativeLoading ? "Opening contacts…" : "Choose from contacts"}
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
                className="animate-rise-in flex items-center gap-2 rounded-lg border border-line px-3 py-2"
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

      {nativeRows && (
        <div
          className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeNativePicker}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="animate-modal-panel-in flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Choose contacts</h2>
              <button type="button" onClick={closeNativePicker} aria-label="Close" className="text-foreground-soft hover:text-foreground">
                <X size={18} />
              </button>
            </div>

            <div className="relative mt-3 shrink-0">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-soft" />
              <input
                type="search"
                value={nativeSearch}
                onChange={(e) => setNativeSearch(e.target.value)}
                placeholder="Search contacts"
                className="w-full rounded-lg border border-line bg-background py-2 pl-8 pr-3 text-sm outline-none focus:border-accent"
                autoFocus
              />
            </div>

            <div className="mt-3 flex-1 overflow-y-auto">
              {filteredNativeRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-foreground-soft">No matching contacts.</p>
              ) : (
                <div className="flex flex-col">
                  {filteredNativeRows.map((row) => (
                    <label
                      key={row.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-line/40"
                    >
                      <input
                        type="checkbox"
                        checked={nativeSelected.has(row.id)}
                        onChange={() => toggleNativeSelected(row.id)}
                        className="h-4 w-4 shrink-0 accent-accent"
                      />
                      <span className="min-w-0 flex-1">
                        {row.name && <span className="block truncate text-sm font-medium">{row.name}</span>}
                        <span className="block truncate text-xs text-foreground-soft">{row.tel}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={confirmNativeSelection}
              disabled={nativeSelected.size === 0}
              className="mt-3 shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
            >
              {nativeSelected.size > 0 ? `Add ${nativeSelected.size} selected` : "Select contacts to add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
