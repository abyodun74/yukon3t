async function sendEmailOnce({
  apiKey,
  to,
  subject,
  html,
}: {
  apiKey: string;
  to: string;
  subject: string;
  html: string;
}) {
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
  return res;
}

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

  // One retry before giving up — every caller treats ok:false as a normal,
  // silent outcome (e.g. sign-up/password-reset still redirect to "check
  // your email" either way, to avoid account enumeration), so a transient
  // Resend/network blip on the first attempt would otherwise cost a real
  // user their verification/reset email with zero visibility anywhere.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await sendEmailOnce({ apiKey, to, subject, html });
      if (res.ok) return { ok: true as const };
      if (attempt === 2) {
        console.error(`[email] Resend returned ${res.status} sending "${subject}" after retry`);
      }
    } catch (err) {
      if (attempt === 2) {
        console.error(`[email] failed to reach Resend sending "${subject}" after retry`, err);
      }
    }
  }
  return { ok: false as const };
}
