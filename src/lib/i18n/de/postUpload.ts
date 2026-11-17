import type { postUploadEn } from "@/lib/i18n/en/postUpload";

export const postUpload: typeof postUploadEn = {
  retry: "Erneut versuchen",
  retrying: "Neuer Versuch...",
  restored: "Dein Beitrag wurde nicht gesendet. Er ist wieder im Editor.",
  repick: "Dieses Foto oder Video kann auf diesem Gerät nicht mehr gelesen werden. Wähle es erneut aus und tippe auf „Posten“.",
  timeout: "Das Posten hat zu lange gedauert und wurde abgebrochen. Dein Beitrag ist noch da. Tippe auf „Erneut versuchen“.",
  network: "Der Server war nicht erreichbar, deshalb wurde dein Beitrag nicht gesendet. Er ist noch da. Prüfe deine Verbindung und tippe auf „Erneut versuchen“.",
  uploadFailed: "Das Foto oder Video wurde nicht fertig hochgeladen. Dein Beitrag ist noch da. Tippe auf „Erneut versuchen“.",
  serverError: "Bei uns ist etwas schiefgelaufen. Dein Beitrag ist noch da. Tippe auf „Erneut versuchen“. Falls er schon gepostet wurde, wird er nicht doppelt gepostet.",
  somethingWrong: "Beim Posten ist etwas schiefgelaufen. Dein Beitrag ist noch da. Tippe auf „Erneut versuchen“.",
  rateLimitedRetry: "Zu viele Versuche in kurzer Zeit. Warte eine Minute und tippe auf „Erneut versuchen“.",
  unauthorized: "Du wurdest abgemeldet. Melde dich wieder an und poste noch einmal.",
};
