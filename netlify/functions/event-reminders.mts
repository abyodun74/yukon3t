// Netlify Scheduled Function — has no route/UI of its own, it just pings the
// real Next.js route handler (src/app/api/cron/event-reminders/route.ts) on
// a timer. Deliberately has zero business logic and no `@/`-aliased imports:
// this file is bundled by Netlify's own (separate from Next.js) function
// bundler, which isn't guaranteed to resolve tsconfig path aliases the way
// the main Next.js build does — keeping this a thin authenticated fetch
// avoids depending on that at all.
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("event-reminders: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/event-reminders`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`event-reminders: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Every 15 minutes — matched by REMINDER_WINDOW_MINUTES (20) in the route
  // handler itself, so a run right at the edge of the window still catches
  // events the previous run's window didn't quite reach.
  schedule: "*/15 * * * *",
};
