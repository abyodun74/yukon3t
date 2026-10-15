import type { sharedEn } from "@/lib/i18n/en/shared";
import { phoneInvalid, passwordInput, multiSelect } from "@/lib/i18n/pt/common";

export const shared: typeof sharedEn = {
  passwordInput,
  submitButton: { offline: "Você está offline. Verifique sua conexão e tente novamente." },
  turnstile: { verify: "Confirme que você é humano", wait: "Toque em “Confirme que você é humano” para concluir a verificação de segurança e tente novamente.", checkingDevice: "Verificando seu dispositivo…" },
  phoneField: { countryCode: "Código do país", placeholder: "Número de telefone" },
  phoneInvalid,
  birthDate: {
    monthLabel: "Mês de nascimento",
    dayLabel: "Dia de nascimento",
    yearLabel: "Ano de nascimento",
    month: "Mês",
    day: "Dia",
    year: "Ano",
    months: [
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
    ],
  },
  multiSelect,
};
