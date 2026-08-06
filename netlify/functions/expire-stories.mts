// Netlify Scheduled Function — has no route/UI of its own, it just pings the
// real Next.js route handler (src/app/api/cron/expire-stories/route.ts) on a
// timer. Same thin-fetch pattern as event-reminders.mts, for the same reason
// (this file is bundled separately from the Next.js build, so it avoids
// `@/`-aliased imports entirely).
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("expire-stories: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/expire-stories`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`expire-stories: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Every 30 minutes — expired stories are already hidden from display by
  // the expiresAt filter regardless, so this doesn't need to be tight.
  schedule: "*/30 * * * *",
};
