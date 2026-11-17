import type { commentToolsEn } from "@/lib/i18n/en/commentTools";

export const commentTools: typeof commentToolsEn = {
  confirmDelete: {
    commentTitle: "Diesen Kommentar löschen?",
    replyTitle: "Diese Antwort löschen?",
    body: "Er wird für alle gelöscht. Das lässt sich nicht rückgängig machen.",
    bodyWithReplies:
      "one: Die zugehörige Antwort wird ebenfalls gelöscht. Das lässt sich nicht rückgängig machen. | other: Die zugehörigen # Antworten werden ebenfalls gelöscht. Das lässt sich nicht rückgängig machen.",
    delete: "Löschen",
    deleting: "Wird gelöscht…",
    cancel: "Abbrechen",
    failed: "Das Löschen hat nicht geklappt. Versuche es noch einmal.",
  },
  picker: {
    label: "Emojis und GIFs",
    showKeyboard: "Tastatur anzeigen",
    emojiTab: "Emojis",
    recent: "Zuletzt verwendet",
    searchEmoji: "Emoji suchen",
    categories: {
      smileys_people: "Smileys und Personen",
      animals_nature: "Tiere und Natur",
      food_drink: "Essen und Trinken",
      travel_places: "Reisen und Orte",
      activities: "Aktivitäten",
      objects: "Objekte",
      symbols: "Symbole",
      flags: "Flaggen",
    },
  },
};
