import type { sharedEn } from "@/lib/i18n/en/shared";
import { phoneInvalid, passwordInput, multiSelect } from "@/lib/i18n/es/common";

export const shared: typeof sharedEn = {
  passwordInput,
  submitButton: { offline: "No tienes conexión. Revisa tu conexión e inténtalo de nuevo." },
  turnstile: { verify: "Verifica que eres humano", wait: "Toca «Verifica que eres humano» para completar la verificación de seguridad y vuelve a intentarlo." },
  phoneField: { countryCode: "Código de país", placeholder: "Número de teléfono" },
  phoneInvalid,
  birthDate: {
    monthLabel: "Mes de nacimiento",
    dayLabel: "Día de nacimiento",
    yearLabel: "Año de nacimiento",
    month: "Mes",
    day: "Día",
    year: "Año",
    months: [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ],
  },
  multiSelect,
};
