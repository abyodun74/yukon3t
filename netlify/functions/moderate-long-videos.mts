// Netlify Scheduled Function — pings the real Next.js route handler
// (src/app/api/cron/moderate-long-videos/route.ts) on a timer, same
// thin-fetch pattern as moderate-videos.mts. Separate cron from
// moderate-videos: that one runs Hive against videos 60s and under in a
// single synchronous call per post; this one runs the Cloudflare
// Stream + OpenAI pipeline (video-review.ts) for videos over that cap, which
// takes multiple ticks per video (see that file for why).
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("moderate-long-videos: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/moderate-long-videos`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`moderate-long-videos: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Same 5-minute cadence as moderate-videos — each tick only advances one
  // video by one step (video-review.ts), so a tighter schedule directly
  // shortens how many wall-clock minutes a long video's full review takes,
  // not just how soon it starts.
  schedule: "*/5 * * * *",
};
