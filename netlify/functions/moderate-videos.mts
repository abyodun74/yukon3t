// Netlify Scheduled Function — pings the real Next.js route handler
// (src/app/api/cron/moderate-videos/route.ts) on a timer, same thin-fetch
// pattern as expire-stories.mts/event-reminders.mts. This is the only place
// video-body moderation runs (Hive's Visual Moderation API is synchronous,
// called from the cron route rather than inline at post creation).
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("moderate-videos: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/moderate-videos`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`moderate-videos: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Every 5 minutes — this is the primary (only) moderation mechanism now,
  // not a fallback, so a tighter cadence directly shortens how long a
  // violating video could stay publicly visible before being flagged. No
  // added cost to checking sooner: each pending video is claimed and
  // processed exactly once regardless of how often this runs.
  schedule: "*/5 * * * *",
};
