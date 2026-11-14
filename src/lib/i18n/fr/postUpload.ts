import type { postUploadEn } from "@/lib/i18n/en/postUpload";

export const postUpload: typeof postUploadEn = {
  retry: "Réessayer",
  retrying: "Nouvel essai...",
  restored: "Ta publication n'a pas été envoyée. Elle est de retour dans l'éditeur.",
  repick: "Cette photo ou vidéo ne peut plus être lue sur cet appareil. Choisis-la à nouveau, puis touche Publier.",
  timeout: "La publication a pris trop de temps et a été arrêtée. Ta publication est toujours là. Touche Réessayer.",
  network: "Impossible de joindre le serveur, ta publication n'a donc pas été envoyée. Elle est toujours là. Vérifie ta connexion et touche Réessayer.",
  uploadFailed: "La photo ou la vidéo n'a pas fini de s'envoyer. Ta publication est toujours là. Touche Réessayer.",
  serverError: "Un problème est survenu de notre côté. Ta publication est toujours là. Touche Réessayer. Si elle a déjà été publiée, elle ne le sera pas deux fois.",
  somethingWrong: "Un problème est survenu pendant la publication. Ta publication est toujours là. Touche Réessayer.",
  rateLimitedRetry: "Trop d'essais en peu de temps. Attends une minute, puis touche Réessayer.",
  unauthorized: "Tu es déconnecté. Reconnecte-toi, puis publie.",
};
