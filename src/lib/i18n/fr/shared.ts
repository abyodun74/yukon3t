import type { sharedEn } from "@/lib/i18n/en/shared";
import { phoneInvalid, passwordInput, multiSelect } from "@/lib/i18n/fr/common";

export const shared: typeof sharedEn = {
  passwordInput,
  submitButton: { offline: "Vous êtes hors ligne. Vérifiez votre connexion, puis réessayez." },
  turnstile: { verify: "Confirmez que vous êtes humain", wait: "Touchez « Confirmez que vous êtes humain » pour terminer la vérification de sécurité, puis réessayez." },
  phoneField: { countryCode: "Indicatif du pays", placeholder: "Numéro de téléphone" },
  phoneInvalid,
  birthDate: {
    monthLabel: "Mois de naissance",
    dayLabel: "Jour de naissance",
    yearLabel: "Année de naissance",
    month: "Mois",
    day: "Jour",
    year: "Année",
    months: [
      "janvier",
      "février",
      "mars",
      "avril",
      "mai",
      "juin",
      "juillet",
      "août",
      "septembre",
      "octobre",
      "novembre",
      "décembre",
    ],
  },
  multiSelect,
};
