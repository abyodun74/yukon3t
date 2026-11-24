// Netlify Scheduled Function — has no route/UI of its own, it just pings the
// real Next.js route handler (src/app/api/cron/sweep-stuck-gift-purchases/route.ts)
// on a timer. Same thin-fetch pattern as sweep-view-once.mts, for the same
// reason (this file is bundled separately from the Next.js build, so it
// avoids `@/`-aliased imports entirely).
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("sweep-stuck-gift-purchases: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/sweep-stuck-gift-purchases`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`sweep-stuck-gift-purchases: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Every 10 minutes. The backstop for coin-paid
  // gifts left PENDING after a failed delivery: retried for 2 hours, then the
  // coins are refunded. Normally finds nothing.
  schedule: "*/10 * * * *",
};
