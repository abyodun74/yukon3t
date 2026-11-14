import type { storyUploadEn } from "@/lib/i18n/en/storyUpload";

export const storyUpload: typeof storyUploadEn = {
  frameFailed:
    "No se pudo preparar este video en este dispositivo, así que aún no se puede publicar. Toca para reintentar, o guárdalo en Fotos o Archivos y elígelo desde ahí.",
  imageUnreadable: "No se pudo abrir esta foto en este dispositivo. Prueba con una captura de pantalla o una copia en JPEG o PNG.",
  unsupportedFile: "Ese archivo no es una foto ni un video que podamos publicar. Usa una foto JPEG, PNG, WebP o HEIC, o un video MP4 o MOV.",
  fileReadFailed: "No se pudo leer ese archivo. Vuelve a elegirlo.",
  failedItem: "No se pudo subir este: {message}",
};
