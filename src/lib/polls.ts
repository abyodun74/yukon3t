/**
 * Polls in Circles and on Collab Boards: the pure rules, shared by the Server Actions (actions/polls.ts), the data
 * loader (polls-data.ts) and the poll UI (components/poll-*.tsx). No database or network access, so everything here is
 * unit-tested (polls.test.ts) and safe in a client bundle.
 *
 * Times: a SCHEDULE poll's options are absolute instants, entered and shown in UTC like a collab's recurring schedule
 * (see CollabBoardPost.scheduleDays: one shared reference for a group spread across time zones), with the viewer's own
 * local time shown alongside. closesAt is entered the same way.
 */

export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 10;
export const POLL_QUESTION_MAX = 200;
export const POLL_DESCRIPTION_MAX = 1000;
export const POLL_OPTION_TEXT_MAX = 120;
/** How far ahead a scheduled time or a closing time may be. */
export const POLL_MAX_HORIZON_MS = 366 * 24 * 60 * 60 * 1000;
/** A poll's creation notifies at most this many people (bell only); the rest still see it on the page. */
export const POLL_NOTIFY_MAX_RECIPIENTS = 500;
/** How many polls a Circle or collab page lists, newest first. */
export const POLLS_LIST_LIMIT = 30;

export type PollKindValue = "GENERAL" | "SCHEDULE";
export type PollStatusValue = "OPEN" | "CLOSED";

/** Exactly one parent: a Circle (optionally one of its channels) or a collab. Null when the combination is valid. */
export function pollParentError(parent: {
  circleId?: string | null;
  channelId?: string | null;
  collabId?: string | null;
}): "invalid" | null {
  const hasCircle = !!parent.circleId;
  const hasCollab = !!parent.collabId;
  if (hasCircle === hasCollab) return "invalid";
  if (parent.channelId && !hasCircle) return "invalid";
  return null;
}

/** OPEN and not past closesAt. A poll past its closing time reads as closed without anything rewriting its status. */
export function isPollOpen(poll: { status: PollStatusValue; closesAt: Date | null }, now: Date) {
  return poll.status === "OPEN" && (!poll.closesAt || poll.closesAt.getTime() > now.getTime());
}

/**
 * Creating a poll: the Circle's / collab's creator or a co-admin (OWNER/MODERATOR membership), and only while still a
 * member (`role` null = not a member). Plain members can't: a poll notifies everyone, so it stays an organizer's tool.
 * No site-admin shortcut, same as inviting.
 */
export function canCreatePoll(role: string | null, isParentCreator: boolean) {
  if (role === null) return false;
  return isParentCreator || role === "OWNER" || role === "MODERATOR";
}

/**
 * Editing, closing/reopening and deleting: the poll's creator while still a member, or anyone who administers the
 * Circle/collab (isCircleAdmin / isCollabAdmin, which include the site-admin moderation override).
 */
export function canManagePoll({
  isPollCreator,
  isMember,
  isParentAdmin,
}: {
  isPollCreator: boolean;
  isMember: boolean;
  isParentAdmin: boolean;
}) {
  return isParentAdmin || (isPollCreator && isMember);
}

/**
 * "Schedule from this option": a Circle/collab admin at any time (scheduling closes the poll), or the poll's creator
 * once the poll is closed.
 */
export function canSchedulePoll({
  isPollCreator,
  isMember,
  isParentAdmin,
  open,
}: {
  isPollCreator: boolean;
  isMember: boolean;
  isParentAdmin: boolean;
  open: boolean;
}) {
  return isParentAdmin || (isPollCreator && isMember && !open);
}

export type PollOptionInput = { id?: string; text?: string | null; startsAt?: string | Date | null };
export type NormalizedPollOption = { id?: string; text: string | null; startsAt: Date | null };
export type PollOptionsError = "too_few" | "too_many" | "duplicate" | "invalid";

/** Trimmed, inner whitespace collapsed. */
export function normalizeOptionText(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The options as stored: a GENERAL option is its text (required, at most POLL_OPTION_TEXT_MAX), a SCHEDULE option its
 * instant (required; any text is dropped). Between POLL_OPTIONS_MIN and POLL_OPTIONS_MAX, no two the same (text
 * compared case-insensitively, times to the minute).
 */
export function normalizePollOptions(
  kind: PollKindValue,
  inputs: readonly PollOptionInput[],
): { options: NormalizedPollOption[] } | { error: PollOptionsError } {
  if (inputs.length < POLL_OPTIONS_MIN) return { error: "too_few" };
  if (inputs.length > POLL_OPTIONS_MAX) return { error: "too_many" };
  const seen = new Set<string>();
  const options: NormalizedPollOption[] = [];
  for (const input of inputs) {
    let option: NormalizedPollOption;
    let key: string;
    if (kind === "GENERAL") {
      const text = normalizeOptionText(input.text ?? "");
      if (!text || text.length > POLL_OPTION_TEXT_MAX) return { error: "invalid" };
      option = { id: input.id, text, startsAt: null };
      key = text.toLocaleLowerCase();
    } else {
      const startsAt = toDate(input.startsAt);
      if (!startsAt) return { error: "invalid" };
      // Whole minutes: the input has no seconds, and two options a few seconds apart would read as the same time.
      const minute = new Date(Math.floor(startsAt.getTime() / 60_000) * 60_000);
      option = { id: input.id, text: null, startsAt: minute };
      key = String(minute.getTime());
    }
    if (seen.has(key)) return { error: "duplicate" };
    seen.add(key);
    options.push(option);
  }
  return { options };
}

/** A time someone is choosing now (a new or changed option, or a closing time) must be ahead, and not absurdly far. */
export function futureTimeError(time: Date, now: Date): "past_time" | "too_far" | null {
  if (time.getTime() <= now.getTime()) return "past_time";
  if (time.getTime() - now.getTime() > POLL_MAX_HORIZON_MS) return "too_far";
  return null;
}

export type ExistingPollOption = { id: string; text: string | null; startsAt: Date | null; voteCount: number };

export type PollOptionPlan = {
  creates: { text: string | null; startsAt: Date | null; position: number }[];
  /** clearVotes: the option's content changed and it had votes, which no longer mean what they meant. */
  updates: { id: string; text: string | null; startsAt: Date | null; position: number; clearVotes: boolean }[];
  /** Removed options; their votes go with them (cascade). */
  deletes: string[];
  /** How many votes this edit removes in all — what the UI asks the editor to confirm before saving. */
  votesCleared: number;
};

function sameContent(a: { text: string | null; startsAt: Date | null }, b: { text: string | null; startsAt: Date | null }) {
  return a.text === b.text && (a.startsAt?.getTime() ?? null) === (b.startsAt?.getTime() ?? null);
}

/**
 * What saving an edited option list does. The rule that keeps voters from being misled: a vote is for what the option
 * said when it was cast. So removing an option deletes its votes, and changing an option's text or time deletes that
 * option's votes too (its voters can simply vote again); an untouched option keeps its votes whatever else changes,
 * including its position. A new or changed SCHEDULE time must be in the future (an existing past one may stay).
 */
export function planPollOptionEdits(
  kind: PollKindValue,
  existing: readonly ExistingPollOption[],
  incoming: readonly NormalizedPollOption[],
  now: Date,
): PollOptionPlan | { error: "unknown_option" | "invalid" | "past_time" | "too_far" } {
  const byId = new Map(existing.map((o) => [o.id, o]));
  const kept = new Set<string>();
  const plan: PollOptionPlan = { creates: [], updates: [], deletes: [], votesCleared: 0 };

  for (const [position, option] of incoming.entries()) {
    if (option.id) {
      const current = byId.get(option.id);
      if (!current) return { error: "unknown_option" };
      if (kept.has(option.id)) return { error: "invalid" };
      kept.add(option.id);
      const changed = !sameContent(current, option);
      if (changed && kind === "SCHEDULE" && option.startsAt) {
        const timeError = futureTimeError(option.startsAt, now);
        if (timeError) return { error: timeError };
      }
      const clearVotes = changed && current.voteCount > 0;
      if (clearVotes) plan.votesCleared += current.voteCount;
      plan.updates.push({ id: option.id, text: option.text, startsAt: option.startsAt, position, clearVotes });
    } else {
      if (kind === "SCHEDULE" && option.startsAt) {
        const timeError = futureTimeError(option.startsAt, now);
        if (timeError) return { error: timeError };
      }
      plan.creates.push({ text: option.text, startsAt: option.startsAt, position });
    }
  }
  for (const option of existing) {
    if (kept.has(option.id)) continue;
    plan.deletes.push(option.id);
    plan.votesCleared += option.voteCount;
  }
  return plan;
}

/**
 * A vote: the full set of options the voter now picks (an empty set withdraws). Every id must be one of this poll's,
 * and a single-choice poll takes at most one.
 */
export function voteSelectionError(selected: readonly string[], allowMultiple: boolean, optionIds: ReadonlySet<string>) {
  if (new Set(selected).size !== selected.length) return "invalid" as const;
  if (!allowMultiple && selected.length > 1) return "invalid" as const;
  if (selected.some((id) => !optionIds.has(id))) return "invalid" as const;
  return null;
}

/** The rows a vote change touches: options newly picked, and options no longer picked. */
export function planVote(current: readonly string[], selected: readonly string[]) {
  const before = new Set(current);
  const after = new Set(selected);
  return {
    add: [...after].filter((id) => !before.has(id)),
    remove: [...before].filter((id) => !after.has(id)),
  };
}

/** Share of voters who picked an option, as a whole percent (in a multiple-choice poll these can add up past 100). */
export function votePercent(count: number, voterCount: number) {
  if (voterCount <= 0) return 0;
  return Math.round((count * 100) / voterCount);
}

/** The options with the most votes (several on a tie); none while nobody has voted. */
export function leadingOptionIds(options: readonly { id: string; count: number }[]) {
  const top = Math.max(0, ...options.map((o) => o.count));
  if (top === 0) return [];
  return options.filter((o) => o.count === top).map((o) => o.id);
}

export type ScheduleError = "not_schedule" | "already_scheduled" | "not_leading" | "past_time" | "too_far" | "invalid";

/**
 * Scheduling from a SCHEDULE poll, once: from one of the leading options (on a tie, the admin picks which), whose time
 * is still ahead.
 */
export function scheduleFromPollError(
  poll: { kind: PollKindValue; scheduledAt: Date | null },
  option: { id: string; startsAt: Date | null } | null,
  leadingIds: readonly string[],
  now: Date,
): ScheduleError | null {
  if (poll.kind !== "SCHEDULE") return "not_schedule";
  if (poll.scheduledAt) return "already_scheduled";
  if (!option || !option.startsAt) return "invalid";
  if (!leadingIds.includes(option.id)) return "not_leading";
  return futureTimeError(option.startsAt, now);
}

/**
 * Who hears about a new poll (or a schedule): each candidate once, never the actor, nobody in `excluded` (blocked
 * either way with the actor), at most `cap`.
 */
export function pollRecipients(
  candidateIds: Iterable<string>,
  actorId: string,
  excluded: ReadonlySet<string>,
  cap: number = POLL_NOTIFY_MAX_RECIPIENTS,
) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of candidateIds) {
    if (out.length >= cap) break;
    if (id === actorId || excluded.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Reopening a poll whose closing time has passed clears that time, or it would read as closed again at once. */
export function reopenClosesAt(closesAt: Date | null, now: Date) {
  return closesAt && closesAt.getTime() <= now.getTime() ? null : closesAt;
}

/** "2026-10-20T18:00" (a datetime-local input, read as UTC) → that instant; null if it isn't one. */
export function utcInputToDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The datetime-local value (in UTC) for an instant. */
export function dateToUtcInput(date: Date) {
  return date.toISOString().slice(0, 16);
}

/** A collab's one-off session (CollabBoardPost.oneOffSessionAt) is shown while it's still ahead. */
export function upcomingOneOffSession(oneOffSessionAt: Date | null, now: Date) {
  return oneOffSessionAt && oneOffSessionAt.getTime() > now.getTime() ? oneOffSessionAt : null;
}
