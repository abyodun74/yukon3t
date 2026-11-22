import type { museEn } from "@/lib/i18n/en/muse";
import { serverUnreachable, newVersionAvailable } from "@/lib/i18n/ar/common";

// A Muse is "مقطع Muse", as in the notifications, and Home is "الرئيسية", the label the nav gives it. A count is
// written label first ("التعليقات: 3") where it labels a button. A Muse lasts at most 5 minutes today; the plural
// entries carry all six forms anyway.
export const muse: typeof museEn = {
  feed: {
    empty: "لا توجد مقاطع Muse بعد. كن أول من ينشر مقطعًا.",
    goToProfile: "الانتقال إلى ملفك الشخصي",
    sharedToHome: "تمت المشاركة في الرئيسية لديك",
    removedFromHome: "أُزيل من الرئيسية لديك",
    embedTitle: "فيديو مضمَّن من مشاركة {name}",
    embedTitleUnnamed: "فيديو مضمَّن شاركه أحد الأشخاص",
    videoLabel: "مقطع Muse من {name}",
    videoLabelUnnamed: "مقطع Muse من أحد الأشخاص",
    tapForSound: "اضغط لتشغيل الصوت",
    delete: "حذف مقطع Muse",
    deleteConfirmLabel: "حذف؟ تأكيد",
    deleteConfirm: "حذف؟",
    play: "تشغيل",
    pause: "إيقاف مؤقت",
    mute: "كتم الصوت",
    unmute: "إلغاء كتم الصوت",
    views: "zero: لا مشاهدات | one: مشاهدة واحدة | two: مشاهدتان | few: # مشاهدات | many: # مشاهدة | other: # مشاهدة",
    viewOriginal: "عرض المنشور الأصلي",
    commentsCount: "التعليقات: {count}",
    reshareCount: "إعادة النشر في الرئيسية: {count}",
    shareCount: "المشاركة: {count}",
  },
  comments: {
    title: "التعليقات",
    titleCount: "التعليقات ({count})",
    close: "إغلاق التعليقات",
    loading: "جارٍ التحميل…",
    empty: "لا توجد تعليقات بعد.",
    someone: "أحد الأشخاص",
    delete: "حذف التعليق",
    add: "إضافة تعليق",
    placeholder: "أضف تعليقًا...",
    postLabel: "نشر التعليق",
    post: "نشر",
    failed: "تعذّر نشر هذا التعليق.",
  },
  share: {
    title: "مشاركة مقطع Muse",
    onHome: "موجود في الرئيسية لديك",
    sharingToHome: "جارٍ المشاركة…",
    toHome: "المشاركة في الرئيسية لديك",
    copyFailed: "تعذّر نسخ الرابط.",
    linkOnly: "تعذّر إرفاق الفيديو هنا، لذلك تمت مشاركة الرابط فقط.",
    storyErrors: {
      too_long: "هذا المقطع أطول من أن يُضاف إلى قصة.",
      rate_limited: "تمهّل قليلًا ثم حاول مرة أخرى.",
      other: "تعذّرت إضافته إلى قصتك.",
    },
    sendErrors: {
      blocked: "لا يمكنك مراسلة هذا الشخص.",
      other: "تعذّر الإرسال.",
    },
  },
  composer: {
    title: "نشر مقطع Muse",
    intro:
      "zero: قصير وطريف وإبداعي، بمدة لا تتجاوز # دقيقة. ظاهر للجميع على YuKon3t. | one: قصير وطريف وإبداعي، بمدة لا تتجاوز دقيقة واحدة. ظاهر للجميع على YuKon3t. | two: قصير وطريف وإبداعي، بمدة لا تتجاوز دقيقتين. ظاهر للجميع على YuKon3t. | few: قصير وطريف وإبداعي، بمدة لا تتجاوز # دقائق. ظاهر للجميع على YuKon3t. | many: قصير وطريف وإبداعي، بمدة لا تتجاوز # دقيقة. ظاهر للجميع على YuKon3t. | other: قصير وطريف وإبداعي، بمدة لا تتجاوز # دقيقة. ظاهر للجميع على YuKon3t.",
    chooseVideo: "اختيار فيديو",
    removeVideo: "إزالة الفيديو",
    originalSound: "الصوت الأصلي",
    customAudio: "صوت مخصص",
    chooseAudio: "اختر ملفًا صوتيًا يحل محل صوت الفيديو",
    removeAudio: "إزالة الملف الصوتي",
    caption: "أضف شرحًا (اختياري)",
    posted: "تم النشر!",
    posting: "جارٍ النشر…",
    post: "نشر مقطع Muse",
    unreadable: "تعذّرت قراءة مدة هذا الفيديو. جرّب ملفًا آخر.",
    tooLong:
      "zero: يجب ألا تزيد مدة مقطع Muse على # دقيقة. اختر مقطعًا أقصر. | one: يجب ألا تزيد مدة مقطع Muse على دقيقة واحدة. اختر مقطعًا أقصر. | two: يجب ألا تزيد مدة مقطع Muse على دقيقتين. اختر مقطعًا أقصر. | few: يجب ألا تزيد مدة مقطع Muse على # دقائق. اختر مقطعًا أقصر. | many: يجب ألا تزيد مدة مقطع Muse على # دقيقة. اختر مقطعًا أقصر. | other: يجب ألا تزيد مدة مقطع Muse على # دقيقة. اختر مقطعًا أقصر.",
    errors: {
      too_large: "هذا الفيديو كبير جدًا.",
      moderation: "تعذّر النشر، فقد يكون هذا المحتوى مخالفًا لإرشادات المحتوى لدينا.",
      rate_limited: "أنت تنشر بسرعة كبيرة. حاول مرة أخرى بعد قليل.",
      invalid: "تعذّر النشر. جرّب اختيار الملف أو الملفات من جديد.",
      network: serverUnreachable,
      stale_deployment: newVersionAvailable,
      other: "حدث خطأ ما. حاول مرة أخرى.",
    },
  },
};
