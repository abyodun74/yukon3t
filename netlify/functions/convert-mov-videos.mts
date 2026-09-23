// Netlify Scheduled Function — pings the real Next.js route handler
// (src/app/api/cron/convert-mov-videos/route.ts) on a timer, same thin-fetch
// pattern as moderate-long-videos.mts. That route re-encodes through
// Cloudflare Stream to H.264 MP4 for two reasons sharing one pipeline: a
// QuickTime .mov (an iPhone's HEVC capture, which only Safari/hardware-HEVC
// setups can play) needs converting for compatibility, and every Muse video
// needs it so a device/browser-dependent orientation-mirroring bug can't
// survive the re-encode (see src/lib/video-convert.ts's top-of-file
// comment for the full story). A tick with nothing to convert is a couple
// of cheap Prisma queries.
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
