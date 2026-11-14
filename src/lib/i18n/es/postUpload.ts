import type { postUploadEn } from "@/lib/i18n/en/postUpload";

export const postUpload: typeof postUploadEn = {
  retry: "Reintentar",
  retrying: "Reintentando...",
  restored: "Tu publicación no se envió. Está de vuelta en el editor.",
  repick: "Esa foto o video ya no se puede leer en este dispositivo. Vuelve a elegirlo y toca Publicar.",
  timeout: "La publicación tardó demasiado y se detuvo. Tu publicación sigue aquí. Toca Reintentar.",
  network: "No se pudo conectar con el servidor, así que tu publicación no se envió. Sigue aquí. Revisa tu conexión y toca Reintentar.",
  uploadFailed: "La foto o el video no terminó de subirse. Tu publicación sigue aquí. Toca Reintentar.",
  serverError: "Algo salió mal de nuestro lado. Tu publicación sigue aquí. Toca Reintentar. Si ya se publicó, no se publicará dos veces.",
  somethingWrong: "Algo salió mal al publicar. Tu publicación sigue aquí. Toca Reintentar.",
  rateLimitedRetry: "Demasiados intentos en poco tiempo. Espera un minuto y toca Reintentar.",
  unauthorized: "Cerraste sesión. Vuelve a iniciar sesión y publica.",
};
