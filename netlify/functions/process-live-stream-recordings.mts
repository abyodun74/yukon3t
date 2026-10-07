// Netlify Scheduled Function — pings the real Next.js route handler
// (src/app/api/cron/process-live-stream-recordings/route.ts) on a timer,
// same thin-fetch pattern as moderate-long-videos.mts. Drives the "Record &
// Post" pipeline: a Daily cloud recording the host asked to be auto-posted
// (LiveStreamRecordingPost) through Daily finishing it, a copy into R2, a
// Cloudflare Stream copy, the same long-video moderation review every other
// video post gets, and finally the Post itself — see
// src/lib/live-stream-recording-post.ts.
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("process-live-stream-recordings: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/process-live-stream-recordings`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`process-live-stream-recordings: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Every minute, same as moderate-long-videos: the route itself polls each
  // claimed recording for up to ~4.5 minutes per tick (POLL_BUDGET_MS), so
  // this schedule is the backstop that resumes whatever's still in progress
  // after that budget ran out rather than the primary driver of latency. A
  // tick with nothing to claim is one cheap Prisma query.
  schedule: "* * * * *",
};
