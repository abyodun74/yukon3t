// Netlify Scheduled Function — has no route/UI of its own, it just pings the
// real Next.js route handler (src/app/api/cron/announce-new-members/route.ts) on
// a timer. Deliberately has zero business logic and no `@/`-aliased imports:
// this file is bundled by Netlify's own (separate from Next.js) function
// bundler, which isn't guaranteed to resolve tsconfig path aliases the way
// the main Next.js build does — keeping this a thin authenticated fetch
// avoids depending on that at all.
async function handler() {
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    console.error("announce-new-members: missing URL or CRON_SECRET, skipping run");
    return new Response("not_configured", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/announce-new-members`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`announce-new-members: ${res.status} ${body}`);

  return new Response(body, { status: 200 });
}

export default handler;

export const config = {
  // Every 15 minutes. A member is announced 10 minutes to 3 days after onboarding (src/lib/new-member-alerts.ts), so a
  // missed run only delays an announcement.
  schedule: "*/15 * * * *",
};
