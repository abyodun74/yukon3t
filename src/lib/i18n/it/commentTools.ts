import type { commentToolsEn } from "@/lib/i18n/en/commentTools";

export const commentTools: typeof commentToolsEn = {
  confirmDelete: {
    commentTitle: "Eliminare questo commento?",
    replyTitle: "Eliminare questa risposta?",
    body: "Verrà eliminato per tutti. L'operazione non si può annullare.",
    bodyWithReplies:
      "one: Verrà eliminata anche la sua risposta. L'operazione non si può annullare. | other: Verranno eliminate anche le sue # risposte. L'operazione non si può annullare.",
    delete: "Elimina",
    deleting: "Eliminazione…",
    cancel: "Annulla",
    failed: "Impossibile eliminare. Riprova.",
  },
  picker: {
    label: "Emoji e GIF",
    showKeyboard: "Mostra tastiera",
    emojiTab: "Emoji",
    recent: "Usate di recente",
    searchEmoji: "Cerca emoji",
    categories: {
      smileys_people: "Faccine e persone",
      animals_nature: "Animali e natura",
      food_drink: "Cibo e bevande",
      travel_places: "Viaggi e luoghi",
      activities: "Attività",
      objects: "Oggetti",
      symbols: "Simboli",
      flags: "Bandiere",
    },
  },
};
