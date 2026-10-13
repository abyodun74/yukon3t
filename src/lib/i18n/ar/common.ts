// Modern Standard Arabic, addressed to the reader in the masculine singular (the generic form Arabic interfaces use);
// buttons are verbal nouns ("تسجيل الدخول", "إنشاء حساب"). Product names (YuKon3t, Circles, Collab Boards, Apple) stay in
// Latin script. Digits are Western (0-9), the way codes and dates are typed. Ranges are written "من 3 إلى 20", never
// with a dash, which reorders in right-to-left text. A username can only hold A-Z, 0-9 and "_", so where English says
// "letters" this says "أحرف إنجليزية". Counted nouns agree with the numbers the app actually fills in (8 أحرف, 72
// حرفًا, 16 عامًا): recheck them if MIN_AGE or the length limits in validations.ts change. The screens that show this
// set dir="rtl" (localeDirection in locales.ts); every sentence here is written to read correctly under it.
// Under /messages: a chat is "محادثة", the people someone is connected with are "جهات الاتصال" and the request is "طلب
// تواصل", a PIN is "رمز PIN", view once is "العرض لمرة واحدة" and end-to-end encryption is "التشفير التام بين الطرفين".
// A sentence built around {name} never puts a verb on the name (its gender isn't known): "طلب من {name}", not "يريد
// {name}". Plural entries carry all six Arabic forms; the passphrase minimum ({min}, 12) is written "12 حرفًا".
// Notifications follow the same rule ("إعجاب من {name} بمنشورك"). A story is "قصة", a post "منشور", a live stream
// "بث مباشر", a Muse "مقطع Muse"; a Latin product name never takes an attached particle ("وكذلك Circles").

export const captchaFailed =
  "تعذّر إكمال التحقق الأمني. انتظر لحظة ثم حاول مرة أخرى، وإذا استمرت المشكلة فأوقف أي أداة لحظر المحتوى أو جرّب شبكة أخرى.";
export const phoneInvalid = "هذا الرقم غير صالح للدولة المحددة. تحقق من الدولة ومن الأرقام.";
export const emailPlaceholder = "name@example.com";
export const underage = "يجب ألا يقل عمرك عن {age} عامًا لاستخدام YuKon3t.";

export const serverUnreachable = "تعذّر الاتصال بالخادم. تحقق من اتصالك ثم حاول مرة أخرى.";
// Also under messages.controls: the screens under /messages render these two controls as well.
export const passwordInput = { show: "إظهار كلمة المرور", hide: "إخفاء كلمة المرور" };
export const multiSelect = {
  placeholder: "ابحث واختر...",
  noMatches: "لا توجد نتائج",
  remove: "إزالة {label}",
  selected: "تم اختيار {count} من {max}",
};
