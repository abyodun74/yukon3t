import type { storyUploadEn } from "@/lib/i18n/en/storyUpload";

export const storyUpload: typeof storyUploadEn = {
  frameFailed:
    "تعذّر تجهيز هذا الفيديو على هذا الجهاز، لذا لا يمكن نشره بعد. اضغط للمحاولة مرة أخرى، أو احفظه في الصور أو الملفات واختره من هناك.",
  imageUnreadable: "تعذّر فتح هذه الصورة على هذا الجهاز. جرّب لقطة شاشة لها أو نسخة بصيغة JPEG أو PNG.",
  unsupportedFile: "هذا الملف ليس صورة أو فيديو يمكننا نشره. استخدم صورة JPEG أو PNG أو WebP أو HEIC، أو فيديو MP4 أو MOV.",
  fileReadFailed: "تعذّرت قراءة هذا الملف. اختره مرة أخرى.",
  failedItem: "تعذّر رفع هذا العنصر: {message}",
  addAnother: "إضافة قصة أخرى",
  slidesLabel: "قصص نصية للمشاركة",
  editSlide: "تعديل القصة {index}",
  removeSlide: "إزالة القصة {index}",
  slidesHint: "تُشارك كل واحدة كقصة مستقلة، بهذا الترتيب.",
  slidesFull: "يمكنك إضافة ما يصل إلى {max} قصص نصية في المرة الواحدة.",
  shareTexts: "zero: مشاركة # قصة | one: مشاركة قصة واحدة | two: مشاركة قصتين | few: مشاركة # قصص | many: مشاركة # قصة | other: مشاركة # قصة",
  postingOf: "جارٍ النشر: {current} من {total}…",
  textPartial: "نُشرت {posted} من {total}. البقية ما زالت هنا: {reason}",
};
