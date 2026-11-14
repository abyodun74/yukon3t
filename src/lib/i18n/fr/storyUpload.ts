import type { storyUploadEn } from "@/lib/i18n/en/storyUpload";

export const storyUpload: typeof storyUploadEn = {
  frameFailed:
    "Cette vidéo n'a pas pu être préparée sur cet appareil, elle ne peut donc pas encore être publiée. Touchez pour réessayer, ou enregistrez-la dans Photos ou Fichiers et choisissez-la depuis là.",
  imageUnreadable: "Cette photo n'a pas pu être ouverte sur cet appareil. Essayez une capture d'écran ou une copie JPEG ou PNG.",
  unsupportedFile: "Ce fichier n'est pas une photo ou une vidéo que nous pouvons publier. Utilisez une photo JPEG, PNG, WebP ou HEIC, ou une vidéo MP4 ou MOV.",
  fileReadFailed: "Impossible de lire ce fichier. Choisissez-le à nouveau.",
  failedItem: "Impossible d'envoyer celui-ci : {message}",
};
