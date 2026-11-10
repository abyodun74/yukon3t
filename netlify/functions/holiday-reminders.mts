// Netlify Scheduled Function — has no route/UI of its own, it just pings the
// real Next.js route handler (src/app/api/cron/holiday-reminders/route.ts) on
// a timer. Deliberately has zero business logic and no `@/`-aliased imports:
// this file is bundled by Netlify's own (separate from Next.js) function
// bundler, which isn't guaranteed to resolve tsconfig path aliases the way
// the main Next.js build does — keeping this a thin authenticated fetch
// avoids depending on that at all.
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("holiday-reminders: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/holiday-reminders`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`holiday-reminders: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Every 15 minutes. A reminder is due from 08:00 in the recipient's own time zone until the end of their day
  // (src/lib/holidays.ts), so it lands within 15 minutes of 08:00 and a missed run only delays it.
  schedule: "*/15 * * * *",
};
