// Netlify Scheduled Function — has no route/UI of its own, it just pings the
// real Next.js route handler (src/app/api/cron/sweep-view-once/route.ts) on a
// timer. Same thin-fetch pattern as timeout-missed-calls.mts, for the same
// reason (this file is bundled separately from the Next.js build, so it
// avoids `@/`-aliased imports entirely).
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("sweep-view-once: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/sweep-view-once`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`sweep-view-once: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Every minute. This is the backstop, not the normal path: a viewed
  // file is deleted by the recipient's own app the moment it has shown it.
  // What this bounds is the case where that never arrives — the file then
  // goes between 4 minutes (the 2-minute retry window + a 60-second download
  // link issued at its last moment + a 1-minute margin) and about 5 minutes
  // after it was opened.
  schedule: "* * * * *",
};
