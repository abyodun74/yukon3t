import { phoneInvalid } from "@/lib/i18n/en/common";

/**
 * Wording inside components that are also used outside the account screens (Settings, the invite panel, Collab…).
 * Those components take it as optional props and default to this, so they stay English wherever no language is passed
 * (Settings and the invite panel pass theirs; Collab does not yet).
 */
export const sharedEn = {
  passwordInput: { show: "Show password", hide: "Hide password" },
  submitButton: { offline: "You're offline — check your connection and try again." },
  turnstile: { verify: "Verify you're human", wait: "Tap “Verify you're human” to finish the security check, then try again.", checkingDevice: "Checking your device…" },
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
