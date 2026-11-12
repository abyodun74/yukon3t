// Netlify Scheduled Function — has no route/UI of its own, it just pings the
// real Next.js route handler (src/app/api/cron/end-inactive-streams/route.ts)
// on a timer. Same thin-fetch pattern as expire-stories.mts, for the same
// reason (this file is bundled separately from the Next.js build, so it
// avoids `@/`-aliased imports entirely).
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("end-inactive-streams: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/end-inactive-streams`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`end-inactive-streams: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Every minute: besides ending streams idle for 30 minutes, the route
  // retries "X is live" announcements the start's own after() callback lost
  // (due 30s after a start), and those should go out within a minute or two,
  // not five. A tick with nothing to do is two cheap indexed queries.
  schedule: "* * * * *",
};
