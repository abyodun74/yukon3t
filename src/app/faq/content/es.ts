import type { FaqContent } from "../ids";
import { es1 } from "./es-1";
import { es2 } from "./es-2";
import { es3 } from "./es-3";
import { es4 } from "./es-4";

// The FAQ in Spanish. Same conventions as src/lib/i18n/es. Every answer says what its English says in ../page.tsx,
// no more and no less: these are factual, privacy and safety claims, so a change there is a change here.
export const es: FaqContent = {
  heading: "Preguntas frecuentes",
  intro:
    "Todo lo que necesitas para orientarte en YuKon3t. ¿No encuentras aquí una respuesta? Responde a cualquier correo de moderación o escríbenos mediante la opción de reportar de la página correspondiente.",
  sections: {
    "getting-around": "Cómo orientarte",
    "android-app": "La aplicación para Android",
    "posts-media": "Publicaciones y contenido multimedia",
    "going-live": "Transmisiones en vivo",
    stories: "Historias",
    muse: "Muse",
    ambient: "Ambient",
    "connecting-messaging-calls": "Contactos, mensajes y llamadas",
    "hidden-chats": "Chats ocultos",
    "circles-collab-boards": "Circles y Collab Boards",
    advertising: "Publicidad",
    "inviting-friends": "Invitar amigos",
    "your-account-data": "Tu cuenta y tus datos",
    "privacy-safety-trust": "Privacidad, seguridad y confianza",
  },
  items: { ...es1, ...es2, ...es3, ...es4 },
};
