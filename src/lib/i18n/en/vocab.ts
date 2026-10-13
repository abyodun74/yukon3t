import { GENERAL_INTERESTS } from "@/lib/interests";

/**
 * Display names for the fixed lists a profile is filled in from. The stored value is always the English one
 * (src/lib/interests.ts, src/lib/languages.ts): only what is shown changes. The general interests are translated
 * here; the job titles that follow them in the interests list (src/lib/job-titles.ts) are shown as stored, and so is
 * any value that is not in this list. Language names come from the runtime (src/lib/i18n/language-names.ts), except
 * the entries below: three the runtime names differently from this list ("Chinese", "Filipino", "Persian
 * (Afghanistan)") and two that are not a language. Server-side only: pages turn these into options for their pickers.
 */
export const vocabEn = {
  interests: Object.fromEntries(GENERAL_INTERESTS.map((interest) => [interest, interest])) as Record<
    (typeof GENERAL_INTERESTS)[number],
    string
  >,
  languages: {
    "Mandarin Chinese": "Mandarin Chinese",
    Tagalog: "Tagalog",
    Dari: "Dari",
    "Sign language (any)": "Sign language (any)",
    "Other / Not listed": "Other / Not listed",
  },
};
