import type { commentToolsEn } from "@/lib/i18n/en/commentTools";

export const commentTools: typeof commentToolsEn = {
  confirmDelete: {
    commentTitle: "¿Eliminar este comentario?",
    replyTitle: "¿Eliminar esta respuesta?",
    body: "Se eliminará para todos. No se puede deshacer.",
    bodyWithReplies:
      "one: También se eliminará su respuesta. No se puede deshacer. | other: También se eliminarán sus # respuestas. No se puede deshacer.",
    delete: "Eliminar",
    deleting: "Eliminando…",
    cancel: "Cancelar",
    failed: "No se pudo eliminar. Inténtalo de nuevo.",
  },
  picker: {
    label: "Emojis y GIF",
    showKeyboard: "Mostrar teclado",
    emojiTab: "Emojis",
    recent: "Usados recientemente",
    searchEmoji: "Buscar emoji",
    categories: {
      smileys_people: "Caras y personas",
      animals_nature: "Animales y naturaleza",
      food_drink: "Comida y bebida",
      travel_places: "Viajes y lugares",
      activities: "Actividades",
      objects: "Objetos",
      symbols: "Símbolos",
      flags: "Banderas",
    },
  },
};
