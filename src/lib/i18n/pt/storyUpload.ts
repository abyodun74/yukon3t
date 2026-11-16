import type { storyUploadEn } from "@/lib/i18n/en/storyUpload";

export const storyUpload: typeof storyUploadEn = {
  frameFailed:
    "Não foi possível preparar este vídeo neste dispositivo, por isso ainda não pode ser publicado. Toque para tentar de novo, ou salve-o em Fotos ou Arquivos e escolha-o de lá.",
  imageUnreadable: "Não foi possível abrir esta foto neste dispositivo. Tente uma captura de tela dela ou uma cópia em JPEG ou PNG.",
  unsupportedFile: "Esse arquivo não é uma foto nem um vídeo que possamos publicar. Use uma foto JPEG, PNG, WebP ou HEIC, ou um vídeo MP4 ou MOV.",
  fileReadFailed: "Não foi possível ler esse arquivo. Escolha-o novamente.",
  failedItem: "Não foi possível enviar este: {message}",
  addAnother: "Adicionar outro",
  slidesLabel: "Stories de texto para compartilhar",
  editSlide: "Editar story {index}",
  removeSlide: "Remover story {index}",
  slidesHint: "Cada um é compartilhado como um story separado, nesta ordem.",
  slidesFull: "Você pode adicionar até {max} stories de texto de uma vez.",
  shareTexts: "one: Compartilhar # story | other: Compartilhar # stories",
  postingOf: "Publicando {current} de {total}…",
  textPartial: "{posted} de {total} compartilhados. Os outros continuam aqui: {reason}",
};
