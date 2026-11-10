"use client";

import { useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Check, Link2, MessageCircle, MessageSquareText, Search, Share2, Users, X } from "lucide-react";
import type { ContactPayload } from "@capacitor-community/contacts";
import { captureError } from "@/lib/error-tracking";
import { Sheet } from "@/components/sheet";
import { PhoneNumberField } from "@/components/phone-number-field";
import { useInviteText } from "@/components/invite-text";
import { isValidE164 } from "@/lib/phone-number";
import { plural } from "@/lib/i18n/locales";
import { copyTextToClipboard } from "@/lib/copy-image";
import { canShareNatively, shareNative } from "@/lib/native-share";
import {
  buildInviteContactRows,
  matchesInviteSearch,
  mergeInviteContacts,
  type InviteContact,
  type RawInviteContact,
} from "@/lib/invite-contacts";
import {
  buildInviteMessage,
  buildInviteUrl,
  buildSmsInviteHref,
  buildWhatsAppInviteHref,
} from "@/lib/invite-link";

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

function nativeContactName(c: ContactPayload): string | null {
  const display = c.name?.display?.trim();
  if (display) return display;
  const parts = [c.name?.given, c.name?.family].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** The address book's contacts as invite-contacts.ts reads them (it does the normalizing and de-duplicating). */
function rawFromNativeContacts(contacts: ContactPayload[]): RawInviteContact[] {
  return contacts.map((c) => ({ name: nativeContactName(c), phones: c.phones ?? [] }));
}

export function InvitePanel({ defaultCountry }: { defaultCountry?: string | null }) {
  const { locale, t } = useInviteText();
  // The link and the full message are built in one place (invite-link.ts): always https://yukon3t.com/sign-up,
  // whatever host this page was opened on.
  const inviteUrl = buildInviteUrl();
  const inviteMessage = buildInviteMessage(t.message, inviteUrl);
  // Read directly during render rather than via useEffect+setState — same
  // convention as ShareModal's canNativeShare/url: these are plain,
  // synchronous browser-API reads with nothing to subscribe to, so an
  // effect would just add a redundant extra render for no benefit.
  const isNative = typeof window !== "undefined" && Capacitor.isNativePlatform();
  // The native share sheet in the app (navigator.share isn't reliable in its WebView), the Web Share API elsewhere.
  const canNativeShare = typeof window !== "undefined" && canShareNatively();
  const canShare =
    canNativeShare || (typeof navigator !== "undefined" && typeof navigator.share === "function");
  const canPickContacts = isNative || Boolean(getContactsManager());

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [contacts, setContacts] = useState<InviteContact[]>([]);
  // The full international number PhoneNumberField assembles from its country and number parts.
  const [manualNumber, setManualNumber] = useState("");
  // Bumped after a number is added, to remount the field empty (it keeps its own state).
  const [manualFieldKey, setManualFieldKey] = useState(0);
  const [pickError, setPickError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  // Native-only: the device's full contact list (fetched once per picker
  // open) and the in-app checkbox picker built from it — the OS's own
  // contact-picker sheet isn't reachable from inside a Capacitor WebView, so
  // this app renders its own instead of relying on one.
  const [nativeRows, setNativeRows] = useState<InviteContact[] | null>(null);
  const [nativeLoading, setNativeLoading] = useState(false);
  const [nativeSearch, setNativeSearch] = useState("");
  const [nativeSelected, setNativeSelected] = useState<Set<string>>(new Set());
  // The picker now needs to stay mounted through its own close animation
  // (Sheet's AnimatePresence — see that file), but nativeRows itself goes
  // null the instant it's dismissed, which would otherwise blank its
  // content mid-exit. Remembers the last real list for rendering while
  // `nativeRows !== null` alone still drives Sheet's `open`; adjusted
  // during render (React's documented pattern for this) rather than a
  // useEffect.
  const [rememberedNativeRows, setRememberedNativeRows] = useState<InviteContact[] | null>(null);
  if (nativeRows !== null && nativeRows !== rememberedNativeRows) setRememberedNativeRows(nativeRows);
  const displayedNativeRows = nativeRows ?? rememberedNativeRows;

  const filteredNativeRows = useMemo(() => {
    if (!displayedNativeRows) return [];
    return displayedNativeRows.filter((r) => matchesInviteSearch(r, nativeSearch));
  }, [displayedNativeRows, nativeSearch]);

  async function copyLink() {
    setCopyStatus((await copyTextToClipboard(inviteUrl)) ? "copied" : "failed");
    setTimeout(() => setCopyStatus("idle"), 2000);
  }

  async function shareLink() {
    setShareError(null);
    // The link goes inside the text (not as a separate `url`): some targets (WhatsApp, several SMS apps) keep only one
    // of the two, and the text is what they all keep.
    if (canNativeShare) {
      const result = await shareNative({ text: inviteMessage });
      if (result.warning) setShareError(t.shareFailed);
      return;
    }
    try {
      await navigator.share({ title: "YuKon3t", text: inviteMessage });
    } catch {
      // Cancelling the native share sheet also lands here — not an error worth surfacing.
    }
  }

  function phoneKindLabel(row: InviteContact): string | null {
    return row.customLabel ?? (row.kind ? t.phoneKinds[row.kind] : null);
  }

  async function openContactPicker() {
    setPickError(null);
    if (isNative) {
      setNativeLoading(true);
      setNativeSelected(new Set());
      setNativeSearch("");
      try {
        const { Contacts } = await import("@capacitor-community/contacts");
        let status = await Contacts.checkPermissions();
        if (status.contacts !== "granted" && status.contacts !== "limited") {
          status = await Contacts.requestPermissions();
        }
        if (status.contacts !== "granted" && status.contacts !== "limited") {
          setPickError(t.errors.permission);
          setNativeLoading(false);
          return;
        }
        const { contacts: fetched } = await Contacts.getContacts({
          projection: { name: true, phones: true },
        });
        const rows = buildInviteContactRows(rawFromNativeContacts(fetched), defaultCountry);
        if (rows.length === 0) {
          setPickError(t.errors.noNumbers);
          setNativeLoading(false);
          return;
        }
        setNativeRows(rows);
      } catch (err) {
        // Used to surface err.message inline — this app's release build
        // doesn't forward WebView console output to logcat and has no
        // client-side Sentry, so that was the only way to see a real
        // failure reason at all on-device. captureError now reaches Sentry
        // instead (see instrumentation-client.ts), so the raw detail still
        // isn't lost — it just doesn't go to the user's screen anymore.
        console.error("Native contact picker failed:", err);
        await captureError(err, { component: "invite-panel", flow: "native-contacts" });
        setPickError(t.errors.openFailed);
      } finally {
        setNativeLoading(false);
      }
      return;
    }

    const manager = getContactsManager();
    if (!manager) return;
    try {
      const picked = await manager.select(["name", "tel"], { multiple: true });
      const rows = buildInviteContactRows(
        picked.map((c) => ({ name: c.name?.[0], phones: (c.tel ?? []).map((number) => ({ number })) })),
        defaultCountry,
      );
      if (rows.length === 0) {
        setPickError(t.errors.pickedNoNumbers);
        return;
      }
      setContacts((prev) => mergeInviteContacts(prev, rows));
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
    // Only nativeRows — that's what drives Sheet's `open` (see below).
    // nativeSearch/nativeSelected deliberately aren't cleared here anymore:
    // doing so immediately would blank the visible search text/checkboxes
    // while the close animation is still playing. openContactPicker
    // already resets both the moment it's reopened instead.
    setNativeRows(null);
  }

  function confirmNativeSelection() {
    if (!nativeRows) return;
    const chosen = nativeRows.filter((r) => nativeSelected.has(r.id));
    setContacts((prev) => mergeInviteContacts(prev, chosen));
    closeNativePicker();
  }

  function addManualNumber() {
    const tel = manualNumber;
    if (!tel) return;
    // Nothing checks this number later (it only goes into an sms: link), so a mistyped one is caught here.
    if (!isValidE164(tel)) {
      setPickError(t.controls.phoneInvalid);
      return;
    }
    setPickError(null);
    // Same normalizing as picked contacts, so a number already in the list (picked or typed) isn't added twice.
    const rows = buildInviteContactRows([{ name: null, phones: [{ number: tel }] }], defaultCountry);
    setContacts((prev) => mergeInviteContacts(prev, rows));
    setManualNumber("");
    setManualFieldKey((k) => k + 1);
  }

  function removeContact(id: string) {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }


  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-medium">{t.linkHeading}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg bg-background px-3 py-2 text-start text-xs text-foreground-soft">
            {inviteUrl}
          </code>
          <button
            type="button"
            onClick={copyLink}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent hover:text-accent"
          >
            {copyStatus === "copied" ? <Check size={14} /> : <Link2 size={14} />}
            {copyStatus === "copied" ? t.copied : copyStatus === "failed" ? t.copyFailed : t.copy}
          </button>
          {canShare && (
            <button
              type="button"
              onClick={shareLink}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink"
            >
              <Share2 size={14} />
              {t.share}
            </button>
          )}
          <a
            href={buildWhatsAppInviteHref(inviteMessage)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.whatsAppLabel}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent hover:text-accent"
          >
            <MessageCircle size={14} />
            {t.whatsApp}
          </a>
        </div>
        {shareError && <p role="alert" className="mt-2 text-xs text-danger">{shareError}</p>}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-medium">{t.textHeading}</p>
        <p className="mt-1 text-xs text-foreground-soft">{t.textIntro}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canPickContacts && (
            <button
              type="button"
              onClick={openContactPicker}
              disabled={nativeLoading}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <Users size={14} />
              {nativeLoading ? t.openingContacts : t.chooseContacts}
            </button>
          )}
          <div
            className="min-w-56 flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
                e.preventDefault();
                addManualNumber();
              }
            }}
          >
            <label htmlFor="invite-phone" className="sr-only">
              {t.phoneLabel}
            </label>
            <PhoneNumberField
              key={manualFieldKey}
              id="invite-phone"
              name="invitePhone"
              required={false}
              defaultCountry={defaultCountry}
              controlClassName="py-2"
              onValueChange={setManualNumber}
              locale={locale}
              labels={t.controls.phoneField}
            />
          </div>
          <button
            type="button"
            onClick={addManualNumber}
            disabled={!manualNumber}
            className="rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {t.add}
          </button>
        </div>
        {pickError && <p role="alert" className="mt-2 text-xs text-danger">{pickError}</p>}

        {contacts.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {contacts.map((c) => (
              <div
                key={c.id}
                className="animate-rise-in flex items-center gap-2 rounded-lg border border-line px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  {c.name && <p dir="auto" className="truncate text-sm font-medium">{c.name}</p>}
                  <p className="truncate text-start text-xs text-foreground-soft">
                    <span dir="ltr">{c.display}</span>
                    {phoneKindLabel(c) && <span dir="auto"> · {phoneKindLabel(c)}</span>}
                  </p>
                </div>
                <a
                  href={buildSmsInviteHref(c.tel, inviteMessage)}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink"
                >
                  <MessageSquareText size={13} />
                  {t.invite}
                </a>
                {c.e164 && (
                  <a
                    href={buildWhatsAppInviteHref(inviteMessage, c.e164)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t.whatsAppLabel}
                    title={t.whatsAppLabel}
                    className="flex shrink-0 items-center rounded-md border border-line px-2 py-1 text-xs font-medium hover:border-accent hover:text-accent"
                  >
                    <MessageCircle size={13} />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => removeContact(c.id)}
                  aria-label={t.remove}
                  className="shrink-0 text-foreground-soft hover:text-danger"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={nativeRows !== null}
        onClose={closeNativePicker}
        title={t.pickerTitle}
        panelClassName="flex max-h-[80vh] flex-col"
      >
            <div className="relative shrink-0">
              <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-foreground-soft" />
              <input
                aria-label={t.searchContacts}
                type="search"
                value={nativeSearch}
                onChange={(e) => setNativeSearch(e.target.value)}
                placeholder={t.searchContacts}
                className="w-full rounded-lg border border-line bg-background py-2 ps-8 pe-3 text-sm outline-none focus:border-accent"
                autoFocus
              />
            </div>

            <div className="mt-3 flex-1 overflow-y-auto">
              {filteredNativeRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-foreground-soft">{t.noMatches}</p>
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
                        {row.name && <span dir="auto" className="block truncate text-sm font-medium">{row.name}</span>}
                        <span className="block truncate text-start text-xs text-foreground-soft">
                          <span dir="ltr">{row.display}</span>
                          {phoneKindLabel(row) && <span dir="auto"> · {phoneKindLabel(row)}</span>}
                        </span>
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
              {nativeSelected.size > 0 ? plural(locale, t.addSelected, nativeSelected.size) : t.selectToAdd}
            </button>
      </Sheet>
    </div>
  );
}
