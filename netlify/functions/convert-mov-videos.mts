// Netlify Scheduled Function — pings the real Next.js route handler
// (src/app/api/cron/convert-mov-videos/route.ts) on a timer, same thin-fetch
// pattern as moderate-long-videos.mts. That route re-encodes QuickTime (.mov)
// uploads to H.264 MP4 through Cloudflare Stream so viewers on browsers that
// can't play an iPhone's HEVC .mov can still watch (see src/lib/video-convert.ts);
// a tick with nothing to convert is a couple of cheap Prisma queries.
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("convert-mov-videos: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/convert-mov-videos`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`convert-mov-videos: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  schedule: "* * * * *",
};
