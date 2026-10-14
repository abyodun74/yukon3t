import type { Locale } from "@/lib/i18n/locales";
import type { FaqContent } from "../ids";
import { ar } from "./ar";
import { es } from "./es";
import { fr } from "./fr";
import { pt } from "./pt";

// The FAQ in every language but English, which is the JSX in ../page.tsx. Server-side only: the page renders the one
// language the reader gets, so none of this reaches a browser bundle. Kept out of src/lib/i18n because nothing but
// the FAQ page reads it and it is as long as the rest of the dictionaries together.
export const FAQ_CONTENT: Record<Exclude<Locale, "en">, FaqContent> = { es, fr, pt, ar };

/** The translated FAQ for `locale`, or null for English. */
export function faqContentFor(locale: Locale): FaqContent | null {
  return locale === "en" ? null : FAQ_CONTENT[locale];
}
