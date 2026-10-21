// Netlify Scheduled Function — has no route/UI of its own, it just pings the
// real Next.js route handler (src/app/api/cron/event-series/route.ts) on a
// timer. Deliberately has zero business logic and no `@/`-aliased imports,
// same as event-reminders.mts: this file is bundled by Netlify's own function
// bundler, which isn't guaranteed to resolve tsconfig path aliases.
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("event-series: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/event-series`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`event-series: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Every 15 minutes: a repeating event's next occurrence appears within about an hour and a quarter of the previous
  // one starting (EVENT_SERIES_ROLLOVER_DELAY_MS in src/lib/event-recurrence.ts, plus up to one interval).
  schedule: "*/15 * * * *",
};
