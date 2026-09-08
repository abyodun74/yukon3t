// Netlify Scheduled Function — pings the real Next.js route handler
// (src/app/api/cron/moderate-long-videos/route.ts) on a timer, same
// thin-fetch pattern as moderate-videos.mts. Separate cron from
// moderate-videos: that one runs Hive against videos 60s and under in a
// single synchronous call per post; this one runs the Cloudflare
// Stream + OpenAI pipeline (video-review.ts) for videos over that cap.
// createPost (actions/circles.ts) already starts a video's Cloudflare copy
// the moment it's uploaded, and the route itself now actively polls each
// claimed post's progress for up to ~4.5 minutes per tick (route.ts's
// reviewOnePost) rather than advancing one step and returning — this
// schedule is the backstop that resumes whatever's still in progress (or
// picks up a post whose eager kick-off failed) rather than the primary
// driver of review latency.
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
  // Every minute rather than every 5 — this is now just the backstop for
  // reviews still in progress after their own tick's poll budget ran out
  // (route.ts's POLL_BUDGET_MS) or whose eager kick-off at upload time
  // never landed, so a tighter interval directly shortens worst-case
  // latency without materially adding cost: a tick with nothing to claim
  // is one cheap Prisma query.
  schedule: "* * * * *",
};
