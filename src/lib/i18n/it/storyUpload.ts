import type { storyUploadEn } from "@/lib/i18n/en/storyUpload";

export const storyUpload: typeof storyUploadEn = {
  frameFailed:
    "Impossibile preparare questo video su questo dispositivo, quindi non può ancora essere pubblicato. Tocca per riprovare, oppure salvalo in Foto o File e sceglilo da lì.",
  imageUnreadable: "Impossibile aprire questa foto su questo dispositivo. Prova con uno screenshot o una copia in JPEG o PNG.",
  unsupportedFile: "Questo file non è una foto o un video che possiamo pubblicare. Usa una foto JPEG, PNG, WebP o HEIC, o un video MP4 o MOV.",
  fileReadFailed: "Impossibile leggere questo file. Sceglilo di nuovo.",
  failedItem: "Impossibile caricare questo elemento: {message}",
  addAnother: "Aggiungine un'altra",
  slidesLabel: "Storie di testo da condividere",
  editSlide: "Modifica storia {index}",
  removeSlide: "Rimuovi storia {index}",
  slidesHint: "Ognuna viene condivisa come storia separata, in quest'ordine.",
  slidesFull: "Puoi aggiungere fino a {max} storie di testo alla volta.",
  shareTexts: "one: Condividi # storia | other: Condividi # storie",
  postingOf: "Pubblicazione di {current} su {total}…",
  textPartial: "{posted} su {total} condivise. Le altre sono ancora qui: {reason}",
};
