import type { commentToolsEn } from "@/lib/i18n/en/commentTools";

export const commentTools: typeof commentToolsEn = {
  confirmDelete: {
    commentTitle: "यह कमेंट हटाएँ?",
    replyTitle: "यह जवाब हटाएँ?",
    body: "यह सभी के लिए हट जाएगा। इसे वापस नहीं लाया जा सकता।",
    bodyWithReplies:
      "one: इसका जवाब भी हट जाएगा। इसे वापस नहीं लाया जा सकता। | other: इसके # जवाब भी हट जाएँगे। इसे वापस नहीं लाया जा सकता।",
    delete: "हटाएँ",
    deleting: "हटाया जा रहा है…",
    cancel: "रद्द करें",
    failed: "हटाया नहीं जा सका। फिर कोशिश करें।",
  },
  picker: {
    label: "इमोजी और GIF",
    showKeyboard: "कीबोर्ड दिखाएँ",
    emojiTab: "इमोजी",
    recent: "हाल में इस्तेमाल किए गए",
    searchEmoji: "इमोजी खोजें",
    categories: {
      smileys_people: "चेहरे और लोग",
      animals_nature: "जानवर और प्रकृति",
      food_drink: "खान-पान",
      travel_places: "यात्रा और जगहें",
      activities: "गतिविधियाँ",
      objects: "चीज़ें",
      symbols: "चिह्न",
      flags: "झंडे",
    },
  },
};
