import { describe, it, expect } from "vitest";
import {
  POLL_MAX_HORIZON_MS,
  POLL_OPTIONS_MAX,
  canCreatePoll,
  canManagePoll,
  canSchedulePoll,
  dateToUtcInput,
  futureTimeError,
  isPollOpen,
  leadingOptionIds,
  normalizePollOptions,
  planPollOptionEdits,
  planVote,
  pollParentError,
  pollRecipients,
  reopenClosesAt,
  scheduleFromPollError,
  upcomingOneOffSession,
  utcInputToDate,
  votePercent,
  voteSelectionError,
} from "@/lib/polls";

const now = new Date("2026-10-19T12:00:00Z");
const hour = 60 * 60 * 1000;
const later = (ms: number) => new Date(now.getTime() + ms);

describe("pollParentError", () => {
  it("accepts exactly one parent", () => {
    expect(pollParentError({ circleId: "c" })).toBeNull();
    expect(pollParentError({ circleId: "c", channelId: "ch" })).toBeNull();
    expect(pollParentError({ collabId: "x" })).toBeNull();
  });
  it("refuses both, neither, or a channel without a Circle", () => {
    expect(pollParentError({ circleId: "c", collabId: "x" })).toBe("invalid");
    expect(pollParentError({})).toBe("invalid");
    expect(pollParentError({ collabId: "x", channelId: "ch" })).toBe("invalid");
  });
});

describe("isPollOpen", () => {
  it("is open while OPEN and before closesAt", () => {
    expect(isPollOpen({ status: "OPEN", closesAt: null }, now)).toBe(true);
    expect(isPollOpen({ status: "OPEN", closesAt: later(hour) }, now)).toBe(true);
  });
  it("is closed when CLOSED or past closesAt", () => {
    expect(isPollOpen({ status: "CLOSED", closesAt: null }, now)).toBe(false);
    expect(isPollOpen({ status: "OPEN", closesAt: now }, now)).toBe(false);
    expect(isPollOpen({ status: "OPEN", closesAt: later(-hour) }, now)).toBe(false);
  });
  it("reopening clears only a closing time that has passed", () => {
    expect(reopenClosesAt(later(-hour), now)).toBeNull();
    expect(reopenClosesAt(later(hour), now)).toEqual(later(hour));
    expect(reopenClosesAt(null, now)).toBeNull();
  });
});

describe("permissions", () => {
  it("lets only the parent's creator and co-admins create, and only as members", () => {
    expect(canCreatePoll("OWNER", false)).toBe(true);
    expect(canCreatePoll("MODERATOR", false)).toBe(true);
    expect(canCreatePoll("MEMBER", true)).toBe(true);
    expect(canCreatePoll("MEMBER", false)).toBe(false);
    expect(canCreatePoll("PARTICIPANT", false)).toBe(false);
    expect(canCreatePoll(null, true)).toBe(false);
  });
  it("lets the poll's creator (still a member) or a parent admin manage it", () => {
    expect(canManagePoll({ isPollCreator: true, isMember: true, isParentAdmin: false })).toBe(true);
    expect(canManagePoll({ isPollCreator: true, isMember: false, isParentAdmin: false })).toBe(false);
    expect(canManagePoll({ isPollCreator: false, isMember: true, isParentAdmin: true })).toBe(true);
    expect(canManagePoll({ isPollCreator: false, isMember: true, isParentAdmin: false })).toBe(false);
  });
  it("lets an admin schedule any time, and the creator only once the poll is closed", () => {
    expect(canSchedulePoll({ isPollCreator: false, isMember: true, isParentAdmin: true, open: true })).toBe(true);
    expect(canSchedulePoll({ isPollCreator: true, isMember: true, isParentAdmin: false, open: true })).toBe(false);
    expect(canSchedulePoll({ isPollCreator: true, isMember: true, isParentAdmin: false, open: false })).toBe(true);
    expect(canSchedulePoll({ isPollCreator: false, isMember: true, isParentAdmin: false, open: false })).toBe(false);
  });
});

describe("normalizePollOptions", () => {
  it("trims and collapses text, and needs 2 to 10 options", () => {
    expect(normalizePollOptions("GENERAL", [{ text: "  Pizza   night " }, { text: "Tacos" }])).toEqual({
      options: [
        { id: undefined, text: "Pizza night", startsAt: null },
        { id: undefined, text: "Tacos", startsAt: null },
      ],
    });
    expect(normalizePollOptions("GENERAL", [{ text: "Only one" }])).toEqual({ error: "too_few" });
    const eleven = Array.from({ length: POLL_OPTIONS_MAX + 1 }, (_, i) => ({ text: `Option ${i}` }));
    expect(normalizePollOptions("GENERAL", eleven)).toEqual({ error: "too_many" });
  });
  it("refuses empty text and case-insensitive duplicates", () => {
    expect(normalizePollOptions("GENERAL", [{ text: "  " }, { text: "B" }])).toEqual({ error: "invalid" });
    expect(normalizePollOptions("GENERAL", [{ text: "Yes" }, { text: "yes " }])).toEqual({ error: "duplicate" });
  });
  it("keeps a SCHEDULE option's time to the minute and drops its text", () => {
    const result = normalizePollOptions("SCHEDULE", [
      { startsAt: "2026-10-20T18:00:30Z", text: "ignored" },
      { startsAt: new Date("2026-10-21T18:00:00Z") },
    ]);
    expect(result).toEqual({
      options: [
        { id: undefined, text: null, startsAt: new Date("2026-10-20T18:00:00Z") },
        { id: undefined, text: null, startsAt: new Date("2026-10-21T18:00:00Z") },
      ],
    });
  });
  it("refuses a missing or duplicate SCHEDULE time", () => {
    expect(normalizePollOptions("SCHEDULE", [{ startsAt: "nope" }, { startsAt: "2026-10-20T18:00:00Z" }])).toEqual({
      error: "invalid",
    });
    expect(
      normalizePollOptions("SCHEDULE", [{ startsAt: "2026-10-20T18:00:00Z" }, { startsAt: "2026-10-20T18:00:45Z" }]),
    ).toEqual({ error: "duplicate" });
  });
});

describe("futureTimeError", () => {
  it("needs a time ahead and within the horizon", () => {
    expect(futureTimeError(later(hour), now)).toBeNull();
    expect(futureTimeError(now, now)).toBe("past_time");
    expect(futureTimeError(later(POLL_MAX_HORIZON_MS + hour), now)).toBe("too_far");
  });
});

describe("planPollOptionEdits", () => {
  const existing = [
    { id: "a", text: "Pizza", startsAt: null, voteCount: 3 },
    { id: "b", text: "Tacos", startsAt: null, voteCount: 0 },
    { id: "c", text: "Sushi", startsAt: null, voteCount: 2 },
  ];

  it("keeps the votes of untouched options, even when reordered", () => {
    const plan = planPollOptionEdits(
      "GENERAL",
      existing,
      [
        { id: "c", text: "Sushi", startsAt: null },
        { id: "a", text: "Pizza", startsAt: null },
        { id: "b", text: "Tacos", startsAt: null },
      ],
      now,
    );
    expect(plan).toEqual({
      creates: [],
      updates: [
        { id: "c", text: "Sushi", startsAt: null, position: 0, clearVotes: false },
        { id: "a", text: "Pizza", startsAt: null, position: 1, clearVotes: false },
        { id: "b", text: "Tacos", startsAt: null, position: 2, clearVotes: false },
      ],
      deletes: [],
      votesCleared: 0,
    });
  });

  it("deletes a removed option's votes and clears a renamed voted option's votes", () => {
    const plan = planPollOptionEdits(
      "GENERAL",
      existing,
      [
        { id: "a", text: "Pizza and salad", startsAt: null },
        { id: "b", text: "Burritos", startsAt: null },
        { text: "Curry", startsAt: null },
      ],
      now,
    );
    expect(plan).toEqual({
      creates: [{ text: "Curry", startsAt: null, position: 2 }],
      updates: [
        { id: "a", text: "Pizza and salad", startsAt: null, position: 0, clearVotes: true },
        // Renamed, but nobody had voted for it: nothing to clear.
        { id: "b", text: "Burritos", startsAt: null, position: 1, clearVotes: false },
      ],
      deletes: ["c"],
      votesCleared: 5,
    });
  });

  it("clears the votes of a SCHEDULE option whose time moves, and refuses a new time in the past", () => {
    const times = [
      { id: "t1", text: null, startsAt: later(24 * hour), voteCount: 4 },
      { id: "t2", text: null, startsAt: later(48 * hour), voteCount: 1 },
    ];
    const plan = planPollOptionEdits(
      "SCHEDULE",
      times,
      [
        { id: "t1", text: null, startsAt: later(25 * hour) },
        { id: "t2", text: null, startsAt: later(48 * hour) },
      ],
      now,
    );
    expect(plan).toMatchObject({ votesCleared: 4, deletes: [] });
    expect("updates" in plan && plan.updates.map((u) => u.clearVotes)).toEqual([true, false]);

    expect(
      planPollOptionEdits("SCHEDULE", times, [times[0], { id: "t2", text: null, startsAt: later(-hour) }], now),
    ).toEqual({ error: "past_time" });
    expect(planPollOptionEdits("SCHEDULE", times, [times[0], { text: null, startsAt: later(-hour) }], now)).toEqual({
      error: "past_time",
    });
  });

  it("lets an unchanged SCHEDULE option stay even once its time has passed", () => {
    const past = [
      { id: "t1", text: null, startsAt: later(-hour), voteCount: 1 },
      { id: "t2", text: null, startsAt: later(hour), voteCount: 0 },
    ];
    expect(planPollOptionEdits("SCHEDULE", past, past, now)).toMatchObject({ votesCleared: 0 });
  });

  it("refuses an option id that isn't this poll's, or one listed twice", () => {
    expect(planPollOptionEdits("GENERAL", existing, [{ id: "zz", text: "X", startsAt: null }], now)).toEqual({
      error: "unknown_option",
    });
    expect(
      planPollOptionEdits(
        "GENERAL",
        existing,
        [
          { id: "a", text: "Pizza", startsAt: null },
          { id: "a", text: "Pizza", startsAt: null },
        ],
        now,
      ),
    ).toEqual({ error: "invalid" });
  });
});

describe("voting", () => {
  const ids = new Set(["a", "b", "c"]);
  it("takes one option in a single-choice poll, several in a multiple-choice one, none to withdraw", () => {
    expect(voteSelectionError(["a"], false, ids)).toBeNull();
    expect(voteSelectionError([], false, ids)).toBeNull();
    expect(voteSelectionError(["a", "b"], false, ids)).toBe("invalid");
    expect(voteSelectionError(["a", "b"], true, ids)).toBeNull();
  });
  it("refuses unknown or repeated options", () => {
    expect(voteSelectionError(["x"], true, ids)).toBe("invalid");
    expect(voteSelectionError(["a", "a"], true, ids)).toBe("invalid");
  });
  it("plans only the rows that change", () => {
    expect(planVote(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], remove: ["a"] });
    expect(planVote(["a"], [])).toEqual({ add: [], remove: ["a"] });
  });
});

describe("results", () => {
  it("gives each option's share of voters as a whole percent", () => {
    expect(votePercent(1, 3)).toBe(33);
    expect(votePercent(2, 3)).toBe(67);
    expect(votePercent(0, 0)).toBe(0);
  });
  it("leads with the most-voted options, ties included, none before any vote", () => {
    expect(leadingOptionIds([{ id: "a", count: 2 }, { id: "b", count: 5 }, { id: "c", count: 5 }])).toEqual(["b", "c"]);
    expect(leadingOptionIds([{ id: "a", count: 0 }])).toEqual([]);
  });
});

describe("scheduleFromPollError", () => {
  const poll = { kind: "SCHEDULE" as const, scheduledAt: null };
  const option = { id: "t1", startsAt: later(24 * hour) };
  it("allows a leading, future option of an unscheduled SCHEDULE poll", () => {
    expect(scheduleFromPollError(poll, option, ["t1"], now)).toBeNull();
  });
  it("refuses everything else", () => {
    expect(scheduleFromPollError({ ...poll, kind: "GENERAL" }, option, ["t1"], now)).toBe("not_schedule");
    expect(scheduleFromPollError({ ...poll, scheduledAt: now }, option, ["t1"], now)).toBe("already_scheduled");
    expect(scheduleFromPollError(poll, option, ["t2"], now)).toBe("not_leading");
    expect(scheduleFromPollError(poll, { ...option, startsAt: later(-hour) }, ["t1"], now)).toBe("past_time");
    expect(scheduleFromPollError(poll, null, ["t1"], now)).toBe("invalid");
  });
});

describe("pollRecipients", () => {
  it("skips the actor, excluded people and repeats, and stops at the cap", () => {
    expect(pollRecipients(["me", "a", "b", "a", "blocked", "c"], "me", new Set(["blocked"]), 2)).toEqual(["a", "b"]);
    expect(pollRecipients(["me", "a"], "me", new Set())).toEqual(["a"]);
  });
});

describe("UTC inputs", () => {
  it("reads a datetime-local value as UTC and writes one back", () => {
    expect(utcInputToDate("2026-10-20T18:05")).toEqual(new Date("2026-10-20T18:05:00Z"));
    expect(utcInputToDate("2026-10-20")).toBeNull();
    expect(dateToUtcInput(new Date("2026-10-20T18:05:59Z"))).toBe("2026-10-20T18:05");
  });
  it("shows a collab's one-off session only while it's ahead", () => {
    expect(upcomingOneOffSession(later(hour), now)).toEqual(later(hour));
    expect(upcomingOneOffSession(later(-hour), now)).toBeNull();
    expect(upcomingOneOffSession(null, now)).toBeNull();
  });
});
