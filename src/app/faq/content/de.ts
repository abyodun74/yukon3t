import type { FaqContent } from "../ids";
import { de1 } from "./de-1";
import { de2 } from "./de-2";
import { de3 } from "./de-3";
import { de4 } from "./de-4";
import { de5 } from "./de-5";

// The FAQ in German. Same conventions as src/lib/i18n/de. Every answer says what its English says in ../page.tsx,
// no more and no less: these are factual, privacy and safety claims, so a change there is a change here.
export const de: FaqContent = {
  heading: "Häufige Fragen",
  intro:
    "Alles, was du brauchst, um dich bei YuKon3t zurechtzufinden. Du findest hier keine Antwort? Antworte auf eine beliebige Moderations-E-Mail oder schreibe uns über die Meldeoption der jeweiligen Seite.",
  sections: {
    "getting-around": "Sich zurechtfinden",
    "android-app": "Die Android-App",
    "posts-media": "Beiträge und Medien",
    "going-live": "Livestreams",
    stories: "Stories",
    muse: "Muse",
    ambient: "Ambient",
    "connecting-messaging-calls": "Kontakte, Nachrichten und Anrufe",
    "hidden-chats": "Verborgene Chats",
    "circles-collab-boards": "Circles und Collab Boards",
    gifts: "Geschenke und Challenges",
    advertising: "Werbung",
    "inviting-friends": "Freunde einladen",
    "your-account-data": "Dein Konto und deine Daten",
    "privacy-safety-trust": "Privatsphäre, Sicherheit und Vertrauen",
  },
  items: { ...de1, ...de2, ...de3, ...de4, ...de5 },
};
