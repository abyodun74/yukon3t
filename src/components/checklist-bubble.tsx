"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import {
  addChecklistItem,
  editChecklistItem,
  removeChecklistItem,
  setChecklistItemChecked,
} from "@/app/actions/checklists";
import { cn } from "@/lib/utils";
import { format } from "@/lib/i18n/locales";
import type { messagesEn } from "@/lib/i18n/en/messages";
import {
  SHOPPING_LIST_ITEM_MAX,
  canAddChecklistItem,
  checklistProgress,
  cleanShoppingListItem,
  type ChecklistData,
} from "@/lib/shopping-list";

type ChecklistText = (typeof messagesEn)["thread"]["checklist"];

// Stands in for the server's tick time while a tick is on its way (only "is it ticked" is read from it).
const PENDING_TICK_AT = new Date(0);

/**
 * A shared checklist message inside its chat bubble (the bubble itself carries `ph-no-capture` and the message's
 * colours). Any member of the chat can tick and untick rows, add a row and edit or remove one; each change goes to
 * src/app/actions/checklists.ts and the answer (the whole list as it now stands) replaces what is shown, while the
 * conversation's realtime signal refreshes everyone else's open thread.
 *
 * A tick shows at once and is put back if the server refuses it. Adding and editing write text, which is never done in
 * a secret chat (`textEditable` false there, and the server refuses it too): only lists sent before a chat became
 * secret can be seen there, since a list typed into a secret chat is sent as encrypted plain text instead.
 */
export function ChecklistBubble({
  checklist,
  mine,
  disabled,
  textEditable,
  onChanged,
  onHiddenLocked,
  t,
}: {
  checklist: ChecklistData;
  mine: boolean;
  /** Still sending, or deleted: nothing is interactive. */
  disabled: boolean;
  /** Adding, editing and removing rows (false in a secret chat). */
  textEditable: boolean;
  onChanged: (checklist: ChecklistData) => void;
  onHiddenLocked: () => void;
  t: ChecklistText;
}) {
  const [isPending, startTransition] = useTransition();
  // Ticks shown before the server answers: item id -> ticked.
  const [pendingTicks, setPendingTicks] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const items = checklist.items.map((item) =>
    item.id in pendingTicks ? { ...item, checkedAt: pendingTicks[item.id] ? (item.checkedAt ?? PENDING_TICK_AT) : null } : item,
  );
  const { done, total } = checklistProgress(items);
  const canAdd = textEditable && canAddChecklistItem(checklist.items.length);
  const soft = mine ? "text-accent-ink/70" : "text-foreground-soft";
  const field = cn(
    "min-w-0 flex-1 rounded-lg bg-black/10 px-2 py-1.5 text-base outline-none sm:text-sm",
    mine ? "text-accent-ink placeholder:text-accent-ink/60" : "text-foreground",
  );

  type Result = Awaited<ReturnType<typeof setChecklistItemChecked>>;
  /** Applies an answer; false when it was a refusal (already shown). */
  function apply(result: Result | undefined): boolean {
    if (!result) {
      setError(t.errors.update);
      return false;
    }
    if (result.error === null) {
      onChanged(result.checklist);
      setError(null);
      return true;
    }
    if (result.error === "hidden_locked") onHiddenLocked();
    setError(
      result.error === "rate_limited"
        ? t.errors.rateLimited
        : result.error === "full"
          ? t.errors.full
          : t.errors.update,
    );
    return false;
  }

  async function call<T extends Result>(run: () => Promise<T>): Promise<T | undefined> {
    try {
      return await run();
    } catch {
      return undefined;
    }
  }

  function toggle(itemId: string, checked: boolean) {
    if (disabled) return;
    setPendingTicks((prev) => ({ ...prev, [itemId]: checked }));
    startTransition(async () => {
      const result = await call(() => setChecklistItemChecked(itemId, checked));
      apply(result);
      setPendingTicks((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    });
  }

  function saveEdit(itemId: string) {
    const text = cleanShoppingListItem(editDraft);
    const current = checklist.items.find((item) => item.id === itemId)?.text;
    if (!text || text === current) {
      setEditingId(null);
      return;
    }
    startTransition(async () => {
      if (apply(await call(() => editChecklistItem(itemId, text)))) setEditingId(null);
    });
  }

  function remove(itemId: string) {
    startTransition(async () => {
      if (apply(await call(() => removeChecklistItem(itemId)))) setEditingId(null);
    });
  }

  function add() {
    const text = cleanShoppingListItem(addDraft);
    if (!text) {
      setAdding(false);
      return;
    }
    startTransition(async () => {
      // Stays open for the next row, like the editor's Enter.
      if (apply(await call(() => addChecklistItem(checklist.id, text)))) setAddDraft("");
    });
  }

  function onEditKey(e: KeyboardEvent<HTMLInputElement>, itemId: string) {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      saveEdit(itemId);
    } else if (e.key === "Escape") {
      setEditingId(null);
    }
  }

  return (
    <div className="min-w-[12rem]">
      <div className="flex items-baseline justify-between gap-3">
        <p dir="auto" className="min-w-0 break-words font-medium">
          {checklist.title}
        </p>
        <span className={cn("shrink-0 text-[0.6875rem]", soft)}>{format(t.progress, { done, total })}</span>
      </div>

      {items.length === 0 && <p className={cn("mt-1 text-xs", soft)}>{t.empty}</p>}

      <ul className="mt-1">
        {items.map((item) => {
          const checked = item.checkedAt !== null;
          const labelId = `checklist-item-${item.id}`;
          return (
            <li key={item.id} className="flex items-center">
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                aria-labelledby={labelId}
                disabled={disabled}
                onClick={() => toggle(item.id, !checked)}
                // A 44px target around a small box.
                className="-ms-2.5 flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-60"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded border-2",
                    mine ? "border-accent-ink/70" : "border-foreground-soft",
                    checked && (mine ? "bg-accent-ink text-accent" : "bg-accent border-accent text-accent-ink"),
                  )}
                >
                  {checked && <Check size={14} strokeWidth={3} />}
                </span>
              </button>
              {editingId === item.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <input
                    type="text"
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => onEditKey(e, item.id)}
                    maxLength={SHOPPING_LIST_ITEM_MAX}
                    aria-label={t.itemField}
                    dir="auto"
                    autoFocus
                    className={field}
                  />
                  <span id={labelId} className="sr-only">
                    {item.text}
                  </span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => saveEdit(item.id)}
                    aria-label={t.save}
                    className="flex h-11 w-9 shrink-0 items-center justify-center disabled:opacity-50"
                  >
                    <Check size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => remove(item.id)}
                    aria-label={format(t.removeItem, { item: item.text })}
                    className="flex h-11 w-9 shrink-0 items-center justify-center text-danger disabled:opacity-50"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    aria-label={t.cancel}
                    className="-me-2 flex h-11 w-9 shrink-0 items-center justify-center"
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
              ) : textEditable && !disabled ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(item.id);
                    setEditDraft(item.text);
                    setError(null);
                  }}
                  aria-label={format(t.editItem, { item: item.text })}
                  className="min-h-11 min-w-0 flex-1 py-2 text-start"
                >
                  <span id={labelId} dir="auto" className={cn("block break-words", checked && cn("line-through", soft))}>
                    {item.text}
                  </span>
                </button>
              ) : (
                <span id={labelId} dir="auto" className={cn("min-w-0 flex-1 break-words py-2", checked && cn("line-through", soft))}>
                  {item.text}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {!disabled && textEditable && (
        adding ? (
          <div className="mt-1 flex items-center gap-1">
            <input
              type="text"
              value={addDraft}
              onChange={(e) => setAddDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  add();
                } else if (e.key === "Escape") {
                  setAdding(false);
                  setAddDraft("");
                }
              }}
              maxLength={SHOPPING_LIST_ITEM_MAX}
              placeholder={t.addPlaceholder}
              aria-label={t.addItem}
              dir="auto"
              autoFocus
              enterKeyHint="done"
              className={field}
            />
            <button
              type="button"
              disabled={isPending || !addDraft.trim()}
              onClick={add}
              aria-label={t.addItem}
              className="flex h-11 w-9 shrink-0 items-center justify-center disabled:opacity-50"
            >
              <Check size={16} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setAddDraft("");
              }}
              aria-label={t.cancel}
              className="-me-2 flex h-11 w-9 shrink-0 items-center justify-center"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        ) : canAdd ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setError(null);
            }}
            className={cn("mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium", mine ? "text-accent-ink" : "text-accent")}
          >
            <Plus size={16} aria-hidden />
            {t.addItem}
          </button>
        ) : (
          <p className={cn("mt-1 text-xs", soft)}>{t.full}</p>
        )
      )}

      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
