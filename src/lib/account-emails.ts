import { dictionaryFor } from "@/lib/i18n/dictionaries";
import { format, type Locale } from "@/lib/i18n/locales";
import type { SecurityChallengePurpose } from "@/generated/prisma/enums";

// Subject and body of every email the account flows send. The language is always the caller's decision: a send made
// by the person themselves passes their request's language (getLocale / localeFromRequest), a send triggered by an
// admin or from a signed-in part of the app that is still English passes DEFAULT_LOCALE. Server-only.

type Email = { subject: string; html: string };

const CODE_STYLE = "font-size:28px;font-weight:700;letter-spacing:4px;";

export function verificationCodeEmail(locale: Locale, code: string): Email {
  const t = dictionaryFor(locale).emails.verificationCode;
  return {
    subject: t.subject,
    html: `<p>${t.intro}</p>
      <p style="${CODE_STYLE}">${code}</p>
      <p>${t.outro}</p>`,
  };
}

/** "required" is the forced reset (User.passwordResetRequiredAt), "requested" the ordinary "Forgot password". */
export function passwordResetEmail(locale: Locale, reason: "requested" | "required", url: string): Email {
  const { subject, [reason]: t } = dictionaryFor(locale).emails.passwordReset;
  return {
    subject,
    html: `<p>${t.intro}</p>
        <p><a href="${url}">${t.link}</a></p>
        <p>${t.outro}</p>`,
  };
}

export function deviceChallengeEmail(
  locale: Locale,
  purpose: SecurityChallengePurpose,
  code: string,
  deviceLabel: string,
): Email {
  const t = dictionaryFor(locale).emails.deviceChallenge;
  const subject = t.subjects[purpose];
  // Says nothing about what the code is for: this email can show up as a lock-screen preview.
  if (purpose === "HIDDEN_PIN_RESET") {
    return {
      subject,
      html: `<p>${t.hiddenPinReset.intro}</p>
    <p style="${CODE_STYLE}">${code}</p>
    <p>${t.hiddenPinReset.outro}</p>`,
    };
  }
  return {
    subject,
    html: `<p>${format(t.intros[purpose], { device: deviceLabel })}</p>
    <p>${t.ifYou}</p>
    <p style="${CODE_STYLE}">${code}</p>
    <p>${t.outro}</p>`,
  };
}

/**
 * The magic-link email. Auth.js's stock one (@auth/core/lib/utils/email) is English only and can't be handed a
 * language, so this is that same template with its three sentences taken from the dictionary.
 */
export function magicLinkEmail(
  locale: Locale,
  { url, host, theme }: { url: string; host: string; theme: { brandColor?: string; buttonText?: string } },
): Email & { text: string } {
  const t = dictionaryFor(locale).emails.magicLink;
  // An invisible space in the domain stops mail clients turning it into a link of its own.
  const escapedHost = host.replace(/\./g, "&#8203;.");
  const brandColor = theme.brandColor || "#346df1";
  const color = {
    background: "#f9f9f9",
    text: "#444",
    mainBackground: "#fff",
    buttonBackground: brandColor,
    buttonBorder: brandColor,
    buttonText: theme.buttonText || "#fff",
  };
  return {
    subject: format(t.subject, { host }),
    html: `
<body style="background: ${color.background};">
  <table width="100%" border="0" cellspacing="20" cellpadding="0"
    style="background: ${color.mainBackground}; max-width: 600px; margin: auto; border-radius: 10px;">
    <tr>
      <td align="center"
        style="padding: 10px 0px; font-size: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
        ${format(t.heading, { host: `<strong>${escapedHost}</strong>` })}
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" style="border-radius: 5px;" bgcolor="${color.buttonBackground}"><a href="${url}"
                target="_blank"
                style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; color: ${color.buttonText}; text-decoration: none; border-radius: 5px; padding: 10px 20px; border: 1px solid ${color.buttonBorder}; display: inline-block; font-weight: bold;">${t.button}</a></td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center"
        style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
        ${t.ignore}
      </td>
    </tr>
  </table>
</body>
`,
    text: `${format(t.subject, { host })}\n${url}\n\n`,
  };
}
