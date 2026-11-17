import type { commentToolsEn } from "@/lib/i18n/en/commentTools";

export const commentTools: typeof commentToolsEn = {
  confirmDelete: {
    commentTitle: "Futa maoni haya?",
    replyTitle: "Futa jibu hili?",
    body: "Litafutwa kwa kila mtu. Haliwezi kutenduliwa.",
    bodyWithReplies:
      "one: Jibu lake pia litafutwa. Haliwezi kutenduliwa. | other: Majibu yake # pia yatafutwa. Hayawezi kutenduliwa.",
    delete: "Futa",
    deleting: "Inafuta…",
    cancel: "Ghairi",
    failed: "Imeshindwa kufuta. Jaribu tena.",
  },
  picker: {
    label: "Emoji na GIF",
    showKeyboard: "Onyesha kibodi",
    emojiTab: "Emoji",
    recent: "Zilizotumika hivi karibuni",
    searchEmoji: "Tafuta emoji",
    categories: {
      smileys_people: "Nyuso na watu",
      animals_nature: "Wanyama na asili",
      food_drink: "Chakula na vinywaji",
      travel_places: "Safari na maeneo",
      activities: "Shughuli",
      objects: "Vitu",
      symbols: "Alama",
      flags: "Bendera",
    },
  },
};
