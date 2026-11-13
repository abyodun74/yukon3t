"use client";

import { useState, useTransition } from "react";
import { Trophy } from "lucide-react";
import {
  cancelChallenge,
  createChallenge,
  declareChallengeWinners,
  editChallengeWinners,
  joinChallenge,
  leaveChallenge,
  type ChallengeError,
} from "@/app/actions/challenges";
import { useChallengesText } from "@/components/challenges-text";
import { ReportModal } from "@/components/report-form";
import type { ChallengeView } from "@/lib/challenges-data";
import { CHALLENGE_DESCRIPTION_MAX, CHALLENGE_TITLE_MAX, CHALLENGE_WINNERS_MAX } from "@/lib/challenges";
import { byCode, plural } from "@/lib/i18n/locales";

// The challenge list and its controls (Gift Universe Phase B), shared by the Circle page's Challenges section and the
// live room's panel. Only rendered behind challengesEnabledFor (the server answers "disabled" to everything else
// anyway). Every button calls a server action that re-checks every rule; this only offers what the view says the
// viewer may do (canRun / canEdit / joined). Winners are shown as equals, in the order they were declared.

type Place = { context: "CIRCLE"; circleId: string } | { context: "LIVE"; liveStreamId: string };

/** "Start a challenge": a title (<= 80) and optional details (<= 280), both moderated on the server. */
export function ChallengeCreateForm({ place, onCreated }: { place: Place; onCreated: () => void }) {
  const { t } = useChallengesText();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await createChallenge({ place, title, description: description || null });
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        setTitle("");
        setDescription("");
        onCreated();
      } catch {
        setError(t.errors.other);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border border-line p-3">
      <h3 className="text-sm font-semibold">{t.createHeading}</h3>
      <label className="block text-xs font-medium">
        {t.titleLabel}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={CHALLENGE_TITLE_MAX}
          placeholder={t.titlePlaceholder}
          dir="auto"
          required
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-xs font-medium">
        {t.descriptionLabel}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={CHALLENGE_DESCRIPTION_MAX}
          rows={2}
          dir="auto"
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </label>
      <p className="text-xs text-foreground-soft">{t.awardNote}</p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || title.trim().length === 0}
        className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
      >
        {pending ? t.creating : t.create}
      </button>
    </form>
  );
}

export function ChallengeList({ challenges, onChanged }: { challenges: ChallengeView[]; onChanged: () => void }) {
  const { t } = useChallengesText();
  const [reporting, setReporting] = useState<string | null>(null);
  if (challenges.length === 0) return <p className="text-sm text-foreground-soft">{t.empty}</p>;
  return (
    <>
      <ul className="space-y-3">
        {challenges.map((challenge) => (
          <ChallengeCard key={challenge.id} challenge={challenge} onChanged={onChanged} onReport={() => setReporting(challenge.id)} />
        ))}
      </ul>
      <ReportModal targetType="CHALLENGE" targetId={reporting ?? ""} open={reporting !== null} onClose={() => setReporting(null)} />
    </>
  );
}

function ChallengeCard({
  challenge,
  onChanged,
  onReport,
}: {
  challenge: ChallengeView;
  onChanged: () => void;
  onReport: () => void;
}) {
  const { locale, t } = useChallengesText();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // "declare" while picking winners of an OPEN challenge, "edit" while changing a decided one's; null otherwise.
  const [picking, setPicking] = useState<"declare" | "edit" | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmCancel, setConfirmCancel] = useState(false);

  function run(action: () => Promise<{ error: ChallengeError | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        after?.();
        onChanged();
      } catch {
        setError(t.errors.other);
      }
    });
  }

  function startPicking(mode: "declare" | "edit") {
    setPicking(mode);
    setPicked(mode === "edit" ? challenge.winners.map((w) => w.id) : []);
  }

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : current.length >= CHALLENGE_WINNERS_MAX ? current : [...current, id],
    );

  const statusClass =
    challenge.status === "OPEN"
      ? "bg-accent-soft"
      : challenge.status === "DECIDED"
        ? "bg-success/15 text-success"
        : "bg-line text-foreground-soft";

  return (
    <li id={`challenge-${challenge.id}`} className="rounded-xl border border-line p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p dir="auto" className="break-words font-semibold">
            {challenge.title}
          </p>
          {challenge.description && (
            <p dir="auto" className="mt-0.5 break-words text-xs text-foreground-soft">
              {challenge.description}
            </p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass}`}>
          {challenge.reversed ? t.reversed : t.status[challenge.status]}
        </span>
      </div>

      <p className="mt-1 text-xs text-foreground-soft">
        {plural(locale, t.joinedCount, challenge.participantCount)}
        {challenge.isHost && <span> · {t.yours}</span>}
        {challenge.joined && !challenge.isHost && <span> · {t.joined}</span>}
      </p>

      {challenge.youWon && (
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold">
          <Trophy size={12} aria-hidden="true" />
          {t.youWon}
        </p>
      )}

      {challenge.winners.length > 0 && challenge.status === "DECIDED" && picking === null && (
        <div className="mt-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">{t.winnersHeading}</h4>
          <ul className="mt-1 flex flex-wrap gap-1">
            {challenge.winners.map((winner) => (
              <li key={winner.id} dir="auto" className="rounded-full border border-line px-2 py-0.5 text-xs">
                {winner.name ?? t.someone}
              </li>
            ))}
          </ul>
        </div>
      )}

      {picking !== null && (
        <fieldset className="mt-3 space-y-2">
          <legend className="text-xs font-semibold">{picking === "declare" ? t.declare : t.editWinners}</legend>
          <p className="text-xs text-foreground-soft">{picking === "declare" ? t.declareHint : t.editHint}</p>
          {challenge.participants.length === 0 ? (
            <p className="text-xs text-foreground-soft">{t.noParticipants}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {challenge.participants.map((person) => {
                const on = picked.includes(person.id);
                return (
                  <li key={person.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(person.id)}
                      className={`rounded-full px-2.5 py-1 text-xs ${on ? "bg-accent font-semibold text-accent-ink" : "border border-line hover:border-accent"}`}
                    >
                      <bdi>{person.name ?? t.someone}</bdi>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || picked.length === 0}
              onClick={() =>
                run(
                  () => (picking === "declare" ? declareChallengeWinners(challenge.id, picked) : editChallengeWinners(challenge.id, picked)),
                  () => setPicking(null),
                )
              }
              className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-50"
            >
              {pending ? t.saving : picking === "declare" ? t.declareConfirm : t.saveWinners}
            </button>
            <button type="button" onClick={() => setPicking(null)} className="rounded-full border border-line px-3 py-1 text-xs">
              {t.keep}
            </button>
          </div>
        </fieldset>
      )}

      {confirmCancel && (
        <div role="alertdialog" aria-label={t.cancel} className="mt-3 space-y-2 rounded-lg border border-danger/40 p-2">
          <p className="text-xs">{t.cancelConfirm}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => cancelChallenge(challenge.id), () => setConfirmCancel(false))}
              className="rounded-full bg-danger px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {t.cancelYes}
            </button>
            <button type="button" onClick={() => setConfirmCancel(false)} className="rounded-full border border-line px-3 py-1 text-xs">
              {t.keep}
            </button>
          </div>
        </div>
      )}

      {picking === null && !confirmCancel && (
        <div className="mt-3 flex flex-wrap gap-2">
          {challenge.status === "OPEN" && !challenge.isHost && (
            <button
              type="button"
              disabled={pending}
              aria-pressed={challenge.joined}
              onClick={() => run(() => (challenge.joined ? leaveChallenge(challenge.id) : joinChallenge(challenge.id)))}
              className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                challenge.joined ? "border border-line" : "bg-accent text-accent-ink"
              }`}
            >
              {challenge.joined ? t.leave : t.join}
              <span className="sr-only">: {challenge.title}</span>
            </button>
          )}
          {challenge.canRun && (
            <button
              type="button"
              onClick={() => startPicking("declare")}
              className="rounded-full border border-line px-3 py-1 text-xs hover:border-accent"
            >
              {t.declare}
              <span className="sr-only">: {challenge.title}</span>
            </button>
          )}
          {challenge.canEdit && (
            <button
              type="button"
              onClick={() => startPicking("edit")}
              className="rounded-full border border-line px-3 py-1 text-xs hover:border-accent"
            >
              {t.editWinners}
              <span className="sr-only">: {challenge.title}</span>
            </button>
          )}
          {(challenge.canRun || challenge.canEdit) && (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="rounded-full border border-line px-3 py-1 text-xs hover:border-danger hover:text-danger"
            >
              {t.cancel}
              <span className="sr-only">: {challenge.title}</span>
            </button>
          )}
          {challenge.joined && !challenge.isHost && (
            <button
              type="button"
              onClick={onReport}
              className="rounded-full border border-line px-3 py-1 text-xs hover:border-danger hover:text-danger"
            >
              {t.report}
              <span className="sr-only">: {challenge.title}</span>
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
