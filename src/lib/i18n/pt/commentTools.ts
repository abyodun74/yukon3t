import type { commentToolsEn } from "@/lib/i18n/en/commentTools";

export const commentTools: typeof commentToolsEn = {
  confirmDelete: {
    commentTitle: "Excluir este comentário?",
    replyTitle: "Excluir esta resposta?",
    body: "Ele será removido para todos. Não é possível desfazer.",
    bodyWithReplies:
      "one: A resposta dele também será excluída. Não é possível desfazer. | other: As # respostas dele também serão excluídas. Não é possível desfazer.",
    delete: "Excluir",
    deleting: "Excluindo…",
    cancel: "Cancelar",
    failed: "Não foi possível excluir. Tente novamente.",
  },
  picker: {
    label: "Emojis e GIFs",
    showKeyboard: "Mostrar teclado",
    emojiTab: "Emojis",
    recent: "Usados recentemente",
    searchEmoji: "Pesquisar emoji",
    categories: {
      smileys_people: "Carinhas e pessoas",
      animals_nature: "Animais e natureza",
      food_drink: "Comidas e bebidas",
      travel_places: "Viagens e lugares",
      activities: "Atividades",
      objects: "Objetos",
      symbols: "Símbolos",
      flags: "Bandeiras",
    },
  },
};
