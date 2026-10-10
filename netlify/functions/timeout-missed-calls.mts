// Netlify Scheduled Function — has no route/UI of its own, it just pings the
// real Next.js route handler (src/app/api/cron/timeout-missed-calls/route.ts)
// on a timer. Same thin-fetch pattern as end-inactive-streams.mts, for the
// same reason (this file is bundled separately from the Next.js build, so it
// avoids `@/`-aliased imports entirely).
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("timeout-missed-calls: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/timeout-missed-calls`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`timeout-missed-calls: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Every minute — the route's own cutoff is 60s after the call was placed,
  // so this is what bounds how long an unanswered call actually rings
  // (between 1 and 2 minutes); a tick with nothing stale is one cheap
  // Prisma query.
  schedule: "* * * * *",
};
