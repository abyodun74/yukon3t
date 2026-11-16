import type { storyUploadEn } from "@/lib/i18n/en/storyUpload";

export const storyUpload: typeof storyUploadEn = {
  frameFailed:
    "Cette vidéo n'a pas pu être préparée sur cet appareil, elle ne peut donc pas encore être publiée. Touchez pour réessayer, ou enregistrez-la dans Photos ou Fichiers et choisissez-la depuis là.",
  imageUnreadable: "Cette photo n'a pas pu être ouverte sur cet appareil. Essayez une capture d'écran ou une copie JPEG ou PNG.",
  unsupportedFile: "Ce fichier n'est pas une photo ou une vidéo que nous pouvons publier. Utilisez une photo JPEG, PNG, WebP ou HEIC, ou une vidéo MP4 ou MOV.",
  fileReadFailed: "Impossible de lire ce fichier. Choisissez-le à nouveau.",
  failedItem: "Impossible d'envoyer celui-ci : {message}",
  addAnother: "En ajouter une autre",
  slidesLabel: "Stories texte à partager",
  editSlide: "Modifier la story {index}",
  removeSlide: "Retirer la story {index}",
  slidesHint: "Chacune est partagée comme une story distincte, dans cet ordre.",
  slidesFull: "Vous pouvez ajouter jusqu'à {max} stories texte à la fois.",
  shareTexts: "one: Partager # story | other: Partager # stories",
  postingOf: "Publication {current} sur {total}…",
  textPartial: "{posted} sur {total} partagées. Les autres sont toujours là : {reason}",
};
