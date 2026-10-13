import { phoneInvalid } from "@/lib/i18n/en/common";

/**
 * Wording inside components that are also used outside the account screens (Settings, the invite panel, Collab…).
 * Those components take it as optional props and default to this, so they stay English wherever no language is passed.
 */
export const sharedEn = {
  passwordInput: { show: "Show password", hide: "Hide password" },
  submitButton: { offline: "You're offline — check your connection and try again." },
  turnstile: { wait: "Finishing the security check — try again in a moment." },
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
