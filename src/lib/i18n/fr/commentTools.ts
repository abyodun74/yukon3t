import type { commentToolsEn } from "@/lib/i18n/en/commentTools";

export const commentTools: typeof commentToolsEn = {
  confirmDelete: {
    commentTitle: "Supprimer ce commentaire ?",
    replyTitle: "Supprimer cette réponse ?",
    body: "Il sera supprimé pour tout le monde. Cette action est irréversible.",
    bodyWithReplies:
      "one: Sa réponse sera aussi supprimée. Cette action est irréversible. | other: Ses # réponses seront aussi supprimées. Cette action est irréversible.",
    delete: "Supprimer",
    deleting: "Suppression…",
    cancel: "Annuler",
    failed: "Impossible de supprimer. Réessayez.",
  },
  picker: {
    label: "Émojis et GIF",
    showKeyboard: "Afficher le clavier",
    emojiTab: "Émojis",
    recent: "Utilisés récemment",
    searchEmoji: "Rechercher un émoji",
    categories: {
      smileys_people: "Smileys et personnes",
      animals_nature: "Animaux et nature",
      food_drink: "Nourriture et boissons",
      travel_places: "Voyages et lieux",
      activities: "Activités",
      objects: "Objets",
      symbols: "Symboles",
      flags: "Drapeaux",
    },
  },
};
