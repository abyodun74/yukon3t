"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createPoll, updatePoll } from "@/app/actions/polls";
import { Sheet } from "@/components/sheet";
import { useUiText } from "@/components/ui-text";
import { byCode, format, plural } from "@/lib/i18n/locales";
import {
  POLL_DESCRIPTION_MAX,
  POLL_OPTION_TEXT_MAX,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  POLL_QUESTION_MAX,
  dateToUtcInput,
  utcInputToDate,
  type PollKindValue,
} from "@/lib/polls";
import type { PollView } from "@/lib/polls-data";

type OptionRow = { key: string; id?: string; text: string; time: string };

let rowSeq = 0;
const newRow = (row: Omit<OptionRow, "key"> = { text: "", time: "" }): OptionRow => ({ key: `row-${++rowSeq}`, ...row });

const inputClass =
  "mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * Creating a poll (`parent` set) or editing one (`poll` set). Times are typed in UTC (datetime-local inputs read as
 * UTC). Editing can't change the kind or single/multiple choice. When saving would remove votes (an option with votes
 * changed or removed — see planPollOptionEdits) the server answers `confirm_clear` and this asks first.
 */
export function PollFormSheet({
  open,
  onClose,
  parent,
  channels = [],
  poll,
}: {
  open: boolean;
  onClose: () => void;
  parent?: { circleId?: string; collabId?: string };
  /** A Circle's text channels the creator can post in; empty means the poll is for the whole Circle / collab. */
  channels?: { id: string; name: string }[];
  poll?: PollView;
}) {
  const { t: ui } = useUiText();
  const t = ui.polls;
  const router = useRouter();
  const formId = useId();
  const [kind, setKind] = useState<PollKindValue>(poll?.kind ?? "GENERAL");
  const [question, setQuestion] = useState(poll?.question ?? "");
  const [description, setDescription] = useState(poll?.description ?? "");
  const [allowMultiple, setAllowMultiple] = useState(poll?.allowMultiple ?? false);
  const [channelId, setChannelId] = useState("");
  const [closesAt, setClosesAt] = useState(poll?.closesAt ? dateToUtcInput(new Date(poll.closesAt)) : "");
  const [rows, setRows] = useState<OptionRow[]>(() =>
    poll
      ? poll.options.map((o) =>
          newRow({ id: o.id, text: o.text ?? "", time: o.startsAt ? dateToUtcInput(new Date(o.startsAt)) : "" }),
        )
      : [newRow(), newRow()],
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const { locale } = useUiText();

  function updateRow(key: string, patch: Partial<OptionRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setConfirmClear(null);
  }

  function payload() {
    const options = rows.map((row) => {
      if (kind === "SCHEDULE") {
        const date = utcInputToDate(row.time);
        return { id: row.id, startsAt: date ? date.toISOString() : null };
      }
      return { id: row.id, text: row.text };
    });
    const closing = closesAt ? utcInputToDate(closesAt) : null;
    return {
      question,
      description: description || null,
      closesAt: closing ? closing.toISOString() : null,
      options,
    };
  }

  function submit(confirmed: boolean) {
    setError(null);
    if (kind === "SCHEDULE" && rows.some((row) => !utcInputToDate(row.time))) {
      setError(t.errors.invalid);
      return;
    }
    if (closesAt && !utcInputToDate(closesAt)) {
      setError(t.errors.invalid);
      return;
    }
    startTransition(async () => {
      try {
        const result = poll
          ? await updatePoll(poll.id, payload(), confirmed)
          : await createPoll({
              ...payload(),
              kind,
              allowMultiple,
              circleId: parent?.circleId ?? null,
              collabId: parent?.collabId ?? null,
              channelId: channelId || null,
            });
        if (result.error === "confirm_clear" && "votesCleared" in result) {
          setConfirmClear(Number(result.votesCleared));
          return;
        }
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        setConfirmClear(null);
        onClose();
        if (!poll) {
          setQuestion("");
          setDescription("");
          setClosesAt("");
          setRows([newRow(), newRow()]);
        }
        router.refresh();
      } catch {
        setError(t.errors.network);
      }
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={poll ? t.editTitle : t.newPoll} panelClassName="max-h-[85vh] max-w-md overflow-y-auto">
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          submit(false);
        }}
        className="space-y-3 text-sm"
      >
        {!poll && (
          <fieldset>
            <legend className="text-xs font-medium text-foreground-soft">{t.kind}</legend>
            <div className="mt-1 space-y-1.5">
              {(
                [
                  ["GENERAL", t.kindGeneral, t.kindGeneralHelp],
                  ["SCHEDULE", t.kindSchedule, t.kindScheduleHelp],
                ] as const
              ).map(([value, label, help]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2 has-[:checked]:border-accent"
                >
                  <input
                    type="radio"
                    name={`${formId}-kind`}
                    value={value}
                    checked={kind === value}
                    onChange={() => setKind(value)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-[0.6875rem] text-foreground-soft">{help}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div>
          <label htmlFor={`${formId}-question`} className="text-xs font-medium text-foreground-soft">
            {t.question}
          </label>
          <input
            id={`${formId}-question`}
            dir="auto"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t.questionPlaceholder}
            required
            minLength={3}
            maxLength={POLL_QUESTION_MAX}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={`${formId}-description`} className="text-xs font-medium text-foreground-soft">
            {t.description}
          </label>
          <textarea
            id={`${formId}-description`}
            dir="auto"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={POLL_DESCRIPTION_MAX}
            rows={2}
            className={inputClass}
          />
        </div>

        {!poll && channels.length > 0 && (
          <div>
            <label htmlFor={`${formId}-channel`} className="text-xs font-medium text-foreground-soft">
              {t.where}
            </label>
            <select
              id={`${formId}-channel`}
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t.wholeCircle}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <fieldset>
          <legend className="text-xs font-medium text-foreground-soft">{t.options}</legend>
          {kind === "SCHEDULE" && <p className="mt-0.5 text-[0.6875rem] text-foreground-soft">{t.utcNote}</p>}
          <ol className="mt-1 space-y-1.5">
            {rows.map((row, index) => {
              const label = format(kind === "SCHEDULE" ? t.optionTime : t.option, { number: index + 1 });
              return (
                <li key={row.key} className="flex items-center gap-2">
                  {kind === "SCHEDULE" ? (
                    <input
                      type="datetime-local"
                      aria-label={label}
                      value={row.time}
                      onChange={(e) => updateRow(row.key, { time: e.target.value })}
                      required
                      className={`${inputClass} mt-0`}
                    />
                  ) : (
                    <input
                      aria-label={label}
                      placeholder={label}
                      dir="auto"
                      value={row.text}
                      onChange={(e) => updateRow(row.key, { text: e.target.value })}
                      required
                      maxLength={POLL_OPTION_TEXT_MAX}
                      className={`${inputClass} mt-0`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setRows((current) => current.filter((r) => r.key !== row.key));
                      setConfirmClear(null);
                    }}
                    disabled={rows.length <= POLL_OPTIONS_MIN}
                    aria-label={format(t.removeOption, { number: index + 1 })}
                    className="shrink-0 rounded-lg p-1.5 text-foreground-soft hover:bg-line hover:text-danger disabled:opacity-30"
                  >
                    <X size={16} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ol>
          {rows.length < POLL_OPTIONS_MAX && (
            <button
              type="button"
              onClick={() => setRows((current) => [...current, newRow()])}
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
            >
              <Plus size={14} aria-hidden />
              {t.addOption}
            </button>
          )}
        </fieldset>

        {!poll && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowMultiple} onChange={(e) => setAllowMultiple(e.target.checked)} />
            {t.allowMultiple}
          </label>
        )}

        <div>
          <label htmlFor={`${formId}-closes`} className="text-xs font-medium text-foreground-soft">
            {t.closesAt}
          </label>
          <input
            id={`${formId}-closes`}
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
            className={inputClass}
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}

        {confirmClear !== null ? (
          <div role="alert" className="space-y-2 rounded-lg border border-danger/40 p-3">
            <p className="text-xs">{plural(locale, t.confirmClear, confirmClear)}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => submit(true)}
                className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {isPending ? t.saving : t.confirmClearYes}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setConfirmClear(null)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {ui.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {poll ? (isPending ? t.saving : t.save) : isPending ? t.creating : t.create}
          </button>
        )}
      </form>
    </Sheet>
  );
}
