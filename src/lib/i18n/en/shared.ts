import { phoneInvalid } from "@/lib/i18n/en/common";

/**
 * Wording inside components that are also used outside the account screens (Settings, the invite panel, Collab…).
 * Those components take it as optional props and default to this, so they stay English wherever no language is passed
 * (Settings and the invite panel pass theirs; Collab does not yet).
 */
export const sharedEn = {
  passwordInput: { show: "Show password", hide: "Hide password" },
  submitButton: { offline: "You're offline — check your connection and try again." },
  turnstile: {
    verify: "Verify you're human",
    wait: "Tap “Verify you're human” to finish the security check, then try again.",
    checkingDevice: "Checking your device…",
    stillChecking: "The security check is still running. Wait for it to finish, then try again.",
    slow: "Still verifying… this can take up to a minute on a slow connection.",
    retry: "Try again",
    blocked: "The security check couldn't load. A content blocker, an ad-blocking Private DNS, a VPN or the network may be blocking challenges.cloudflare.com. Turn it off or switch between Wi‑Fi and mobile data, then tap Try again.",
    stalled: "The security check didn't finish. Tap Try again. If it keeps happening, switch between Wi‑Fi and mobile data, or turn off any VPN, Private DNS or content blocker.",
    network: "The security check couldn't reach Cloudflare. Check your connection, then tap Try again. A VPN, Private DNS or content blocker can also cause this.",
    config: "The security check isn't working right now because of a problem on our side. Please try again later.",
    unsupported: "This browser can't run the security check. Update Chrome and Android System WebView (or your browser), or try another browser.",
    clock: "Your phone's date and time look wrong, so the security check can't finish. Turn on automatic date and time in your settings, then tap Try again.",
    failed: "The security check didn't pass. Tap Try again.",
  },
  phoneField: { countryCode: "Country calling code", placeholder: "Phone number" },
  phoneInvalid,
  birthDate: {
    monthLabel: "Birth month",
    dayLabel: "Birth day",
    yearLabel: "Birth year",
    month: "Month",
    day: "Day",
    year: "Year",
    months: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
  },
  multiSelect: {
    placeholder: "Search and select...",
    noMatches: "No matches",
    remove: "Remove {label}",
    selected: "{count}/{max} selected",
  },
};
