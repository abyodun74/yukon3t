import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The holiday-reminders cron endpoint: bearer-authenticated, answers the run's totals, never throws.
const sendHolidayReminders = vi.fn();
const captureError = vi.fn();
vi.mock("@/lib/holidays-data", () => ({ sendHolidayReminders: (...a: unknown[]) => sendHolidayReminders(...a) }));
vi.mock("@/lib/error-tracking", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));

import { GET } from "./route";

const request = (auth?: string) =>
  new Request("https://yukon3t.test/api/cron/holiday-reminders", auth ? { headers: { authorization: auth } } : {});

describe("GET /api/cron/holiday-reminders", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    sendHolidayReminders.mockReset();
    captureError.mockReset();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("is not configured without CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(503);
    expect(sendHolidayReminders).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong bearer token", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer nope"))).status).toBe(401);
    expect(sendHolidayReminders).not.toHaveBeenCalled();
  });

  it("runs once and answers the totals", async () => {
    sendHolidayReminders.mockResolvedValue({ groups: 3, dueGroups: 1, reminders: 2, recipients: 2, pushes: 2, failed: 0 });
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: null, groups: 3, dueGroups: 1, reminders: 2, recipients: 2, pushes: 2, failed: 0 });
    expect(sendHolidayReminders).toHaveBeenCalledTimes(1);
  });

  it("reports a failed run as a 500 and to error tracking", async () => {
    sendHolidayReminders.mockRejectedValue(new Error("boom"));
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed" });
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
