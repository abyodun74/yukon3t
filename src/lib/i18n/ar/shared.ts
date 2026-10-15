import type { sharedEn } from "@/lib/i18n/en/shared";
import { phoneInvalid, passwordInput, multiSelect } from "@/lib/i18n/ar/common";

export const shared: typeof sharedEn = {
  passwordInput,
  submitButton: { offline: "أنت غير متصل بالإنترنت. تحقق من اتصالك ثم حاول مرة أخرى." },
  turnstile: { verify: "تحقّق من أنك إنسان", wait: "اضغط على «تحقّق من أنك إنسان» لإكمال التحقق الأمني، ثم حاول مرة أخرى.", checkingDevice: "جارٍ التحقق من جهازك…" },
  phoneField: { countryCode: "رمز الدولة", placeholder: "رقم الهاتف" },
  phoneInvalid,
  birthDate: {
    monthLabel: "شهر الميلاد",
    dayLabel: "يوم الميلاد",
    yearLabel: "سنة الميلاد",
    month: "الشهر",
    day: "اليوم",
    year: "السنة",
    months: [
      "يناير",
      "فبراير",
      "مارس",
      "أبريل",
      "مايو",
      "يونيو",
      "يوليو",
      "أغسطس",
      "سبتمبر",
      "أكتوبر",
      "نوفمبر",
      "ديسمبر",
    ],
  },
  multiSelect,
};
