// Netlify Scheduled Function — pings the real Next.js route handler
// (src/app/api/cron/sweep-abandoned-uploads/route.ts) hourly, same thin-fetch pattern as the other crons. That route
// removes uploads nothing ever used (a picked-then-abandoned attachment); it only logs until UPLOAD_SWEEP_DELETE=1.
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("sweep-abandoned-uploads: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/sweep-abandoned-uploads`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`sweep-abandoned-uploads: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  schedule: "17 * * * *",
};
