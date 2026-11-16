"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Plus, Send, X } from "lucide-react";
import { Sheet } from "@/components/sheet";
import { cn } from "@/lib/utils";
import { format } from "@/lib/i18n/locales";
import type { messagesEn } from "@/lib/i18n/en/messages";
import {
  SHOPPING_LIST_ITEM_MAX,
  SHOPPING_LIST_MAX_ITEMS,
  SHOPPING_LIST_TITLE_MAX,
  shoppingListItems,
} from "@/lib/shopping-list";

type ShoppingListText = (typeof messagesEn)["thread"]["composer"]["shoppingList"];

export type ShoppingListRow = { id: string; text: string };
export type ShoppingListDraft = { title: string; rows: ShoppingListRow[] };

let rowSeq = 0;
function newRow(text = ""): ShoppingListRow {
  rowSeq += 1;
  return { id: `row-${rowSeq}`, text };
}

export function emptyShoppingListDraft(): ShoppingListDraft {
  return { title: "", rows: [newRow()] };
}

/**
 * The chat composer's "Shopping list" editor. `onSend` gets the title as typed and the rows, and the composer's
 * handleSend decides how it goes out (a shared checklist, or encrypted plain text in a secret chat): this sheet looks
 * and behaves the same in every chat. The draft lives in the composer (so a failed send or an accidental close keeps
 * it); `onSend` answers an error sentence to show here, or null once the send has started.
 */
export function ShoppingListSheet({
  open,
  onClose,
  draft,
  onDraftChange,
  onSend,
  sending,
  t,
}: {
  open: boolean;
  onClose: () => void;
  draft: ShoppingListDraft;
  onDraftChange: (draft: ShoppingListDraft) => void;
  onSend: (list: { title: string; items: string[] }) => string | null;
  sending: boolean;
  t: ShoppingListText;
}) {
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  // A row id to focus once it has rendered (after Enter adds a row, or Backspace removes one).
  const focusIdRef = useRef<string | null>(null);

  useEffect(() => {
    const id = focusIdRef.current;
    if (!id) return;
    focusIdRef.current = null;
    inputRefs.current.get(id)?.focus();
  }, [draft.rows]);

  function close() {
    setError(null);
    onClose();
  }

  const rows = draft.rows;
  const filled = shoppingListItems(rows.map((r) => r.text)).length;
  const full = rows.length >= SHOPPING_LIST_MAX_ITEMS;

  function update(next: Partial<ShoppingListDraft>) {
    setError(null);
    onDraftChange({ ...draft, ...next });
  }

  function addRowAfter(index: number) {
    if (full) return;
    const row = newRow();
    const next = [...rows.slice(0, index + 1), row, ...rows.slice(index + 1)];
    update({ rows: next });
    focusIdRef.current = row.id;
  }

  function removeRow(index: number) {
    if (rows.length <= 1) {
      update({ rows: [newRow()] });
      return;
    }
    const next = rows.filter((_, i) => i !== index);
    update({ rows: next });
    const target = next[Math.max(0, index - 1)];
    if (target) focusIdRef.current = target.id;
  }

  function handleItemKeyDown(e: KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      addRowAfter(index);
    } else if (e.key === "Backspace" && rows[index]?.text === "" && rows.length > 1) {
      e.preventDefault();
      removeRow(index);
    }
  }

  function send() {
    if (sending) return;
    const items = shoppingListItems(rows.map((r) => r.text));
    if (items.length === 0) {
      setError(t.empty);
      return;
    }
    const failure = onSend({ title: draft.title, items });
    if (failure) setError(failure);
  }

  return (
    <Sheet open={open} onClose={close} variant="bottom-sheet" responsive title={t.sheetTitle} dragFromHandle bodyClassName="flex min-h-0 flex-col px-4 pb-4">
      <div className="flex max-h-[70dvh] min-h-0 flex-col gap-3">
        <label className="block shrink-0">
          <span className="mb-1 block text-xs font-medium text-foreground-soft">{t.titleLabel}</span>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (rows[0]) inputRefs.current.get(rows[0].id)?.focus();
              }
            }}
            maxLength={SHOPPING_LIST_TITLE_MAX}
            placeholder={t.titlePlaceholder}
            dir="auto"
            enterKeyHint="next"
            className="w-full rounded-lg border border-line bg-background px-3 py-2 text-base outline-none focus:border-accent sm:text-sm"
          />
        </label>

        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain">
          {rows.map((row, index) => (
            <li key={row.id} className="flex items-center gap-2">
              <span aria-hidden className="shrink-0 text-foreground-soft">☐</span>
              <input
                ref={(el) => {
                  if (el) inputRefs.current.set(row.id, el);
                  else inputRefs.current.delete(row.id);
                }}
                type="text"
                value={row.text}
                onChange={(e) => update({ rows: rows.map((r) => (r.id === row.id ? { ...r, text: e.target.value } : r)) })}
                onKeyDown={(e) => handleItemKeyDown(e, index)}
                maxLength={SHOPPING_LIST_ITEM_MAX}
                placeholder={t.itemPlaceholder}
                aria-label={format(t.itemLabel, { number: index + 1 })}
                dir="auto"
                enterKeyHint={full ? "done" : "next"}
                className="min-w-0 flex-1 rounded-lg border border-line bg-background px-3 py-2 text-base outline-none focus:border-accent sm:text-sm"
              />
              <button
                type="button"
                onClick={() => removeRow(index)}
                aria-label={format(t.removeItem, { number: index + 1 })}
                className="shrink-0 rounded-lg p-2.5 -m-1 text-foreground-soft hover:bg-line hover:text-danger"
              >
                <X size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        <div className="shrink-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => addRowAfter(rows.length - 1)}
              disabled={full}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-accent hover:bg-line disabled:opacity-40"
            >
              <Plus size={16} aria-hidden />
              {t.addItem}
            </button>
            <span className="text-xs text-foreground-soft" aria-live="polite">
              {format(t.count, { count: filled, max: SHOPPING_LIST_MAX_ITEMS })}
            </span>
          </div>
          {full && <p className="text-xs text-foreground-soft">{t.full}</p>}
          <p className="text-xs text-foreground-soft">{t.hint}</p>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={send}
            disabled={sending || filled === 0}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink",
              "disabled:opacity-50",
            )}
          >
            <Send size={16} aria-hidden className="rtl:-scale-x-100" />
            {t.send}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
