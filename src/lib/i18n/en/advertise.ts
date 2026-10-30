import { captchaUnavailable, serverUnreachable } from "@/lib/i18n/en/common";
import { sharedEn } from "@/lib/i18n/en/shared";

/**
 * The public Advertise pages (/advertise, /advertise/success) and the booking form, which AdvertiseTextProvider (the
 * /advertise layout) hands the reader's language. Prices are in US dollars and written the US way in every language.
 */
export const advertiseEn = {
  page: {
    eyebrow: "Advertise on YuKon3t",
    title: "Put your business in front of a global, verified audience.",
    intro:
      "One flat rate, no account required, no audience targeting to configure — your ad runs across the app for the number of days you pick. Every submission is reviewed before it goes live, and the price is {price} per day.",
    canceled: "Checkout was canceled — no charge was made. You can submit again whenever you're ready.",
    notConfigured: "Ad bookings aren't set up yet — check back soon, or reach out directly.",
  },
  success: {
    eyebrow: "Payment received",
    title: "Thanks — your ad is booked.",
    body: "We'll review your creative shortly (usually within one business day) before it goes live. You'll be able to reach us at the contact email you provided if we have any questions.",
    back: "Back to YuKon3t",
  },
  form: {
    company: "Company name",
    contactName: "Contact name",
    contactEmail: "Contact email",
    emailPlaceholder: "you@company.com",
    emailHint: "Your receipt and review status go here.",
    headline: "Headline",
    headlinePlaceholder: "What are you advertising?",
    copy: "Ad copy",
    copyPlaceholder: "A sentence or two describing what you're offering.",
    link: "Link URL",
    linkPlaceholder: "https://yourcompany.com",
    creative: "Creative",
    removeMedia: "Remove media",
    addPhoto: "Add a photo",
    addVideo: "Add a video",
    uploadFromDevice: "Upload from device",
    takePhoto: "Take a photo",
    duration: "Duration",
    days: "one: # day | other: # days",
    total: "Total",
    preparing: "Preparing checkout...",
    continue: "Continue to payment — {price}",
    stripeNote: "You'll pay securely via Stripe. Ads go live after a quick review, usually within one business day.",
    oneTime:
      "one: One-time charge for # day only — this does not auto-renew or recur. Running another campaign later requires a separate booking and a separate charge. | other: One-time charge for # days only — this does not auto-renew or recur. Running another campaign later requires a separate booking and a separate charge.",
    // The bot check's own button and status lines (TurnstileWidget), the same sentences as the account screens.
    turnstile: sharedEn.turnstile,
    errors: {
      too_large: "That file is too large.",
      moderation: "That creative didn't pass our content guidelines.",
      rate_limited: "Too many attempts — try again shortly.",
      not_configured: "Ad bookings aren't set up yet — check back soon.",
      payment_setup_failed: "Couldn't start checkout — try again.",
      invalid: "Please check your inputs.",
      network: serverUnreachable,
      captcha: "We couldn't complete the security check — wait a moment and try again.",
      captcha_unavailable: captchaUnavailable,
      other: "Couldn't submit that booking — try again.",
      imageType: "Use a JPEG, PNG, or WebP image.",
      imageTooLarge: "Images must be 25MB or smaller.",
      videoType: "Use an MP4, MOV or WebM video.",
      videoTooLarge: "Video must be 250MB or smaller.",
      videoTooLong: "one: Videos must be # second or shorter. | other: Videos must be # seconds or shorter.",
      details: "Fill in your company and contact details.",
      adFields: "Fill in your ad's headline, copy, and link.",
      media: "Add a photo or video for your ad.",
    },
  },
};
