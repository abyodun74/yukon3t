// Netlify Scheduled Function — has no route/UI of its own, it just pings the
// real Next.js route handler (src/app/api/cron/prune-gift-occasions/route.ts)
// on a timer. Same thin-fetch pattern as sweep-view-once.mts, for the same
// reason (this file is bundled separately from the Next.js build, so it
// avoids `@/`-aliased imports entirely).
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("prune-gift-occasions: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/prune-gift-occasions`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`prune-gift-occasions: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Once a day at 04:41 UTC — off-peak, away from the 03:00 backup. Self-declared
  // gift occasions older than 30 days are deleted (up to 1000 per run).
  schedule: "41 4 * * *",
};
