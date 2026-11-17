import { ar } from "@/lib/i18n/ar";
import { de } from "@/lib/i18n/de";
import { en, type Dictionary } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { fr } from "@/lib/i18n/fr";
import { hi } from "@/lib/i18n/hi";
import { it } from "@/lib/i18n/it";
import { pt } from "@/lib/i18n/pt";
import { sw } from "@/lib/i18n/sw";
import type { Locale } from "@/lib/i18n/locales";

// Every language at once: for the server, which hands client components only the area they render (see
// src/components/ui-text.tsx). A client component importing this would ship every language. Each language is a
// folder with one module per area; en/ is the shape the others are typed against.
export const DICTIONARIES: Record<Locale, Dictionary> = { en, es, fr, pt, ar, de, it, hi, sw };

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
