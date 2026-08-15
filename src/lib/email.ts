// Raw Resend API call, matching the fetch-based pattern already used for
// other external APIs in this app (see moderation.ts) rather than adding
// the full Resend SDK just for one call site.
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false as const };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html,
      }),
    });

    return { ok: res.ok };
  } catch {
    // Network-level failure (DNS, timeout, Resend outage) — every caller
    // already handles ok:false as a normal, expected outcome (e.g. the
    // sign-up flow still redirects to "check your email" either way), so
    // this must degrade the same way rather than throwing and turning a
    // Resend blip into a 500 on signup/password-reset.
    return { ok: false as const };
  }
}
