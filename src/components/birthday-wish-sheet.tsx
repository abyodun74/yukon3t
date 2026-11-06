"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Sheet } from "@/components/sheet";
import { useUiText } from "@/components/ui-text";
import { sendBirthdayWish } from "@/app/actions/birthdays";
import {
  BIRTHDAY_EMOJIS,
  BIRTHDAY_PRESET_IDS,
  BIRTHDAY_WISH_TEXT_MAX,
  type BirthdayWishChoice,
} from "@/lib/birthdays";
import { announce } from "@/lib/announce";
import { byCode, format } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * The quick-wish sheet: pick one reaction, one ready-made message or write your own, and send it to the person as a
 * direct message (sendBirthdayWish). One wish per person per year, so the sheet sends once and then shows where the
 * wish went. Only the person's id and the choice go to the server; a ready-made message is worded there, in the
 * sender's language.
 */
export function BirthdayWishSheet({
  person,
  onClose,
  onSent,
}: {
  person: { id: string; name: string | null } | null;
  onClose: () => void;
  onSent: (personId: string) => void;
}) {
  const { t: ui } = useUiText();
  const t = ui.birthdays;
  const [choice, setChoice] = useState<BirthdayWishChoice | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // A sheet opened for someone else starts clean (adjusted during render, as forward-message-sheet.tsx does).
  const [shownFor, setShownFor] = useState(person?.id ?? null);
  if ((person?.id ?? null) !== shownFor) {
    setShownFor(person?.id ?? null);
    setChoice(null);
    setText("");
    setError(null);
    setSentTo(null);
  }

  const name = person?.name ?? ui.unknownName;
  const done = sentTo !== null;

  function send() {
    if (!person || !choice || isPending || done) return;
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof sendBirthdayWish>>;
      try {
        result = await sendBirthdayWish({ celebrantId: person.id, ...choice });
      } catch {
        setError(t.errors.network);
        return;
      }
      if (result.error) {
        setError(byCode(t.errors, result.error));
        // Already wished from another device: show it as done here too.
        if (result.error === "already_wished") onSent(person.id);
        return;
      }
      const line = format(t.sent, { name });
      setSentTo(result.conversationId);
      announce(line);
      onSent(person.id);
    });
  }

  return (
    <Sheet
      open={person !== null}
      onClose={onClose}
      variant="bottom-sheet"
      responsive
      title={<span dir="auto">{format(t.sheetTitle, { name })}</span>}
      panelClassName="sm:max-w-sm"
    >
      {done ? (
        <div className="mt-3 space-y-3">
          <p role="status" className="text-sm text-success">
            {format(t.sent, { name })}
          </p>
          <div className="flex gap-2">
            <Link
              href={`/messages/${sentTo}`}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink"
            >
              {t.openChat}
            </Link>
            <button type="button" onClick={onClose} className="rounded-full border border-line px-4 py-1.5 text-sm">
              {t.close}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <fieldset>
            <legend className="text-sm font-medium">{t.reactions}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {BIRTHDAY_EMOJIS.map((emoji) => {
                const selected = choice?.kind === "emoji" && choice.emoji === emoji;
                return (
                  <button
                    key={emoji}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setText("");
                      setChoice({ kind: "emoji", emoji });
                    }}
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full border text-2xl",
                      selected ? "border-accent bg-accent/10" : "border-line hover:border-accent",
                    )}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">{t.presetsHeading}</legend>
            <div className="mt-2 space-y-2">
              {BIRTHDAY_PRESET_IDS.map((presetId) => {
                const selected = choice?.kind === "preset" && choice.presetId === presetId;
                return (
                  <button
                    key={presetId}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setText("");
                      setChoice({ kind: "preset", presetId });
                    }}
                    className={cn(
                      "block w-full rounded-lg border px-3 py-2 text-start text-sm",
                      selected ? "border-accent bg-accent/10" : "border-line hover:border-accent",
                    )}
                  >
                    {t.presets[presetId]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor="birthday-wish-text" className="block text-sm font-medium">
              {t.customLabel}
            </label>
            <textarea
              id="birthday-wish-text"
              dir="auto"
              rows={2}
              maxLength={BIRTHDAY_WISH_TEXT_MAX}
              value={text}
              placeholder={t.customPlaceholder}
              onChange={(e) => {
                setText(e.target.value);
                setChoice(e.target.value.trim() ? { kind: "custom", text: e.target.value } : null);
              }}
              className="ph-no-capture mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <p className="text-end text-xs text-foreground-soft" aria-hidden>
              {text.length}/{BIRTHDAY_WISH_TEXT_MAX}
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={send}
              disabled={!choice || isPending || !person}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
            >
              {isPending ? t.sending : t.send}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
