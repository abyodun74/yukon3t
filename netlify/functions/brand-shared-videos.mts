// Netlify Scheduled Function — pings the real Next.js route handler
// (src/app/api/cron/brand-shared-videos/route.ts) on a timer, same
// thin-fetch pattern as convert-mov-videos.mts. That route is purely a
// backstop: it only ever has work when a native-share attempt already
// created a BrandedVideoRendition row on-demand and the client's own short
// poll loop didn't stick around long enough to see it finish. A tick with
// nothing pending is a single cheap Prisma query.
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("brand-shared-videos: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/brand-shared-videos`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`brand-shared-videos: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  schedule: "* * * * *",
};
