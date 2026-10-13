import type { inviteEn } from "@/lib/i18n/en/invite";
import { phoneInvalid } from "@/lib/i18n/ar/common";
import { shared } from "@/lib/i18n/ar/shared";

// The contacts here are the phone's own ("جهات اتصال هاتفك"); the app's connections are also "جهات الاتصال", so the
// first mention on a screen says whose they are. The invitation itself opens with "أدعوك", which reads the same
// whoever receives it.
export const invite: typeof inviteEn = {
  controls: { phoneField: shared.phoneField, phoneInvalid },
  title: "دعوة الأصدقاء",
  intro: "ادعُ من تعرفهم إلى YuKon3t.",
  message: "أدعوك للانضمام إليّ على YuKon3t للتواصل مع أشخاص من مختلف الثقافات والاهتمامات والبلدان:",
  linkHeading: "رابط الدعوة الخاص بك",
  copy: "نسخ",
  copied: "تم النسخ!",
  copyFailed: "تعذّر النسخ",
  share: "مشاركة",
  textHeading: "الدعوة برسالة نصية",
  textIntro:
    "اختر من جهات اتصال هاتفك (حيثما كان ذلك متاحًا) أو أدخل رقمًا، ثم أرسل إلى كل شخص رسالة نصية تتضمن رابط دعوتك.",
  openingContacts: "جارٍ فتح جهات اتصال الهاتف…",
  chooseContacts: "اختيار من جهات اتصال الهاتف",
  phoneLabel: "رقم الهاتف",
  add: "إضافة",
  invite: "دعوة",
  remove: "إزالة",
  pickerTitle: "اختيار جهات اتصال",
  searchContacts: "ابحث في جهات اتصال الهاتف",
  noMatches: "لا توجد جهات اتصال مطابقة.",
  addSelected:
    "zero: حدّد جهات اتصال لإضافتها | one: إضافة جهة الاتصال المحددة | two: إضافة جهتَي الاتصال المحددتين | few: إضافة # جهات اتصال محددة | many: إضافة # جهة اتصال محددة | other: إضافة # جهة اتصال محددة",
  selectToAdd: "حدّد جهات اتصال لإضافتها",
  errors: {
    permission:
      "رُفض إذن الوصول إلى جهات الاتصال. فعّله لتطبيق YuKon3t من إعدادات هاتفك لتتمكن من الدعوة من جهات اتصالك.",
    noNumbers: "لا يوجد رقم هاتف محفوظ لأي من جهات اتصالك.",
    openFailed: "تعذّر فتح جهات اتصالك. يُرجى المحاولة مرة أخرى.",
    pickedNoNumbers: "لا يوجد رقم هاتف محفوظ لجهات الاتصال هذه.",
  },
};
