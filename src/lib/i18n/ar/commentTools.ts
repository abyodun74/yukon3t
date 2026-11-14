import type { commentToolsEn } from "@/lib/i18n/en/commentTools";

export const commentTools: typeof commentToolsEn = {
  confirmDelete: {
    commentTitle: "حذف هذا التعليق؟",
    replyTitle: "حذف هذا الرد؟",
    body: "سيُحذف لدى الجميع. لا يمكن التراجع عن ذلك.",
    bodyWithReplies:
      "zero: لا يمكن التراجع عن ذلك. | one: سيُحذف ردّه أيضًا. لا يمكن التراجع عن ذلك. | two: سيُحذف ردّاه أيضًا. لا يمكن التراجع عن ذلك. | few: ستُحذف ردوده الـ# أيضًا. لا يمكن التراجع عن ذلك. | many: ستُحذف ردوده الـ# أيضًا. لا يمكن التراجع عن ذلك. | other: ستُحذف ردوده الـ# أيضًا. لا يمكن التراجع عن ذلك.",
    delete: "حذف",
    deleting: "جارٍ الحذف…",
    cancel: "إلغاء",
    failed: "تعذّر الحذف. حاول مرة أخرى.",
  },
  picker: {
    label: "الرموز التعبيرية وصور GIF",
    showKeyboard: "إظهار لوحة المفاتيح",
    emojiTab: "رموز تعبيرية",
    recent: "المستخدمة مؤخرًا",
    searchEmoji: "البحث عن رمز تعبيري",
    categories: {
      smileys_people: "الوجوه والأشخاص",
      animals_nature: "الحيوانات والطبيعة",
      food_drink: "الطعام والشراب",
      travel_places: "السفر والأماكن",
      activities: "الأنشطة",
      objects: "الأشياء",
      symbols: "الرموز",
      flags: "الأعلام",
    },
  },
};
