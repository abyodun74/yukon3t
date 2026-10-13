import { vocabEn } from "@/lib/i18n/en/vocab";
import { intlLocale, type Locale } from "@/lib/i18n/locales";

// Spoken languages are stored by their English name (src/lib/languages.ts). To show one in another language, the
// name is mapped to its language code here and looked up in the runtime's own names for the reader's language; a
// name with no code, or one the runtime has no name for, is shown as stored. The dictionary (vocab.languages) words a
// few itself and wins over the runtime: the two entries that are not a language, and three the runtime would name
// differently from the list (Mandarin, Tagalog, Dari). Server-side: pages turn the result into options for their
// pickers, so the server's and the browser's Intl data never have to agree.

const CODE_BY_ENGLISH_NAME: Record<string, string> = {
  English: "en",
  "Mandarin Chinese": "zh",
  Hindi: "hi",
  Spanish: "es",
  French: "fr",
  "Standard Arabic": "ar",
  Bengali: "bn",
  Portuguese: "pt",
  Russian: "ru",
  Urdu: "ur",
  Indonesian: "id",
  German: "de",
  Japanese: "ja",
  "Nigerian Pidgin": "pcm",
  Marathi: "mr",
  Telugu: "te",
  Turkish: "tr",
  Tamil: "ta",
  "Yue Chinese (Cantonese)": "yue",
  Vietnamese: "vi",
  Korean: "ko",
  "Wu Chinese (Shanghainese)": "wuu",
  Tagalog: "tl",
  Gujarati: "gu",
  "Persian (Farsi)": "fa",
  Javanese: "jv",
  Italian: "it",
  Hausa: "ha",
  Bhojpuri: "bho",
  Amharic: "am",
  Punjabi: "pa",
  Kannada: "kn",
  Sindhi: "sd",
  Yoruba: "yo",
  Ukrainian: "uk",
  Malayalam: "ml",
  Igbo: "ig",
  Xhosa: "xh",
  Zulu: "zu",
  Afrikaans: "af",
  Swahili: "sw",
  Polish: "pl",
  Uzbek: "uz",
  Malay: "ms",
  Sundanese: "su",
  Burmese: "my",
  Thai: "th",
  Odia: "or",
  Maithili: "mai",
  Awadhi: "awa",
  Dutch: "nl",
  Romanian: "ro",
  Azerbaijani: "az",
  Nepali: "ne",
  Sinhala: "si",
  Khmer: "km",
  Greek: "el",
  Kazakh: "kk",
  Hungarian: "hu",
  Chhattisgarhi: "hne",
  Zhuang: "za",
  Somali: "so",
  Assamese: "as",
  Czech: "cs",
  Swedish: "sv",
  Hmong: "hmn",
  Belarusian: "be",
  Kinyarwanda: "rw",
  "Haitian Creole": "ht",
  Dari: "fa-AF",
  Serbian: "sr",
  Hebrew: "he",
  "Akan (Twi)": "ak",
  Bulgarian: "bg",
  Slovak: "sk",
  Finnish: "fi",
  Danish: "da",
  Norwegian: "no",
  Croatian: "hr",
  Georgian: "ka",
  Armenian: "hy",
  Lithuanian: "lt",
  Slovenian: "sl",
  Latvian: "lv",
  Estonian: "et",
  Mongolian: "mn",
  Tibetan: "bo",
  Lao: "lo",
  Tigrinya: "ti",
  Pashto: "ps",
  Kurdish: "ku",
  Malagasy: "mg",
  Wolof: "wo",
  "Fula (Fulani)": "ff",
  Shona: "sn",
  Bambara: "bm",
  Icelandic: "is",
  Maltese: "mt",
  Welsh: "cy",
  "Irish (Gaelic)": "ga",
  Basque: "eu",
  Catalan: "ca",
  Māori: "mi",
  Samoan: "sm",
  Fijian: "fj",
};

/** A stored (English) language name in `locale`. `extras` is the dictionary's vocab.languages. */
export function languageName(
  englishName: string,
  locale: Locale,
  extras: typeof vocabEn.languages = vocabEn.languages,
): string {
  if (locale === "en") return englishName;
  if (Object.hasOwn(extras, englishName)) return extras[englishName as keyof typeof extras];
  const code = CODE_BY_ENGLISH_NAME[englishName];
  if (!code) return englishName;
  const tag = intlLocale(locale) ?? locale;
  try {
    const name = new Intl.DisplayNames([tag], { type: "language", languageDisplay: "standard" }).of(code);
    // A code the runtime has no name for comes back as the code itself.
    if (!name || name.toLowerCase() === code.toLowerCase()) return englishName;
    // Spanish, French and Portuguese write language names in lower case; at the start of a list entry they take a capital.
    return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    return englishName;
  }
}

/** A stored interest in the reader's language: `interests` is the dictionary's vocab.interests. A job title, or any value not listed there, is shown as stored. */
export function interestName(stored: string, interests: Record<string, string>): string {
  return Object.hasOwn(interests, stored) ? interests[stored] : stored;
}

/**
 * A stored Circle category or collaboration type in the reader's language: `names` is the dictionary's
 * vocab.circleCategories or vocab.collabTypes. A job title, or any value not listed there, is shown as stored.
 */
export function vocabName(stored: string, names: Record<string, string>): string {
  return Object.hasOwn(names, stored) ? names[stored] : stored;
}
