"use client";

import { useState, useSyncExternalStore } from "react";
import { Send, Share2, Link2, Check, UserPlus } from "lucide-react";

type PickedContact = { name: string; tel: string };

// Chrome/Android (and Android TWAs, which is how this app ships on the Play
// Store) expose the Contact Picker API behind `navigator.contacts` — no
// standard TS lib covers it yet, so it's accessed defensively at runtime.
type ContactsManager = {
  select: (
    props: string[],
    opts?: { multiple?: boolean },
  ) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
};

function getContactsManager(): ContactsManager | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { contacts?: ContactsManager };
  return "contacts" in navigator && nav.contacts ? nav.contacts : null;
}

function inviteMessage() {
  const url = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "");
  return { url, text: `Join me on YuKon3t — connect across cultures, interests, and borders: ${url}` };
}

// iOS and Android disagree on how an `sms:` URI separates the number from
// the `body` query param (iOS wants `&`, everyone else wants `?`).
function smsHref(tel: string | null, body: string) {
  const isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const sep = isIOS ? "&" : "?";
  return `sms:${tel ?? ""}${sep}body=${encodeURIComponent(body)}`;
}

// navigator.share support can't change during the component's lifetime, so
// there's nothing to subscribe to — just a browser-only value read once.
function noopSubscribe() {
  return () => {};
}

function getShareSnapshot() {
  return typeof navigator !== "undefined" && !!navigator.share;
}

function getShareServerSnapshot() {
  return false;
}

/** Lets a user invite phone contacts who don't already have the app, via whatever share mechanism their device supports. */
export function InviteContactsButton() {
  const [picked, setPicked] = useState<PickedContact[] | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [unsupportedShare, setUnsupportedShare] = useState(false);
  const canShare = useSyncExternalStore(noopSubscribe, getShareSnapshot, getShareServerSnapshot);

  async function pickContacts() {
    const manager = getContactsManager();
    const { text } = inviteMessage();
    if (!manager) {
      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          await navigator.share({ title: "YuKon3t", text });
        } catch {
          // User cancelled the share sheet — not an error worth surfacing.
        }
      } else {
        setUnsupportedShare(true);
      }
      return;
    }
    try {
      const results = await manager.select(["name", "tel"], { multiple: true });
      const contacts = results
        .map((c) => ({ name: c.name?.[0] ?? "Contact", tel: c.tel?.[0] ?? "" }))
        .filter((c) => c.tel);
      setPicked(contacts);
    } catch {
      // User cancelled the picker, or permission was denied — not an error.
    }
  }

  async function copyLink() {
    const { url } = inviteMessage();
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    setTimeout(() => setCopyStatus("idle"), 2000);
  }

  const { text } = inviteMessage();

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={pickContacts}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          <UserPlus size={15} /> Invite from contacts
        </button>
        <button
          type="button"
          onClick={copyLink}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-foreground-soft hover:border-accent hover:text-accent"
        >
          {copyStatus === "copied" ? <Check size={14} /> : <Link2 size={14} />}
          {copyStatus === "copied" ? "Copied!" : copyStatus === "failed" ? "Couldn't copy" : "Copy invite link"}
        </button>
      </div>

      {unsupportedShare && (
        <p className="mt-2 text-xs text-foreground-soft">
          Your browser doesn&apos;t support picking contacts or sharing directly — use{" "}
          <a href="#" onClick={(e) => { e.preventDefault(); copyLink(); }} className="text-accent underline">
            copy invite link
          </a>{" "}
          instead.
        </p>
      )}

      {picked && (
        <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
          {picked.length === 0 ? (
            <p className="text-sm text-foreground-soft">No contacts with a phone number were selected.</p>
          ) : (
            <>
              <p className="text-xs font-medium text-foreground-soft">
                Tap a contact to text them the app link:
              </p>
              <ul className="space-y-1.5">
                {picked.map((c, i) => (
                  <li key={`${c.tel}-${i}`}>
                    <a
                      href={smsHref(c.tel, text)}
                      className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:border-accent hover:text-accent"
                    >
                      <Send size={14} /> {c.name} <span className="text-foreground-soft">({c.tel})</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="text-xs text-foreground-soft hover:text-accent"
          >
            Done
          </button>
        </div>
      )}

      {canShare && (
        <button
          type="button"
          onClick={() => navigator.share({ title: "YuKon3t", text }).catch(() => {})}
          className="mt-2 flex items-center gap-1.5 text-xs text-foreground-soft hover:text-accent"
        >
          <Share2 size={13} /> Or share via any app
        </button>
      )}
    </div>
  );
}
