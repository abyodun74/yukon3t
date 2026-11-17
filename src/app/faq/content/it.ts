import type { FaqContent } from "../ids";
import { it1 } from "./it-1";
import { it2 } from "./it-2";
import { it3 } from "./it-3";
import { it4 } from "./it-4";
import { it5 } from "./it-5";

// The FAQ in Italian. Same conventions as src/lib/i18n/it. Every answer says what its English says in ../page.tsx,
// no more and no less: these are factual, privacy and safety claims, so a change there is a change here.
export const it: FaqContent = {
  heading: "Domande frequenti",
  intro:
    "Tutto ciò che ti serve per orientarti su YuKon3t. Non trovi qui una risposta? Rispondi a una qualsiasi e-mail di moderazione o scrivici usando l'opzione di segnalazione della pagina interessata.",
  sections: {
    "getting-around": "Come orientarti",
    "android-app": "L'app per Android",
    "posts-media": "Post e contenuti multimediali",
    "going-live": "Dirette",
    stories: "Storie",
    muse: "Muse",
    ambient: "Ambient",
    "connecting-messaging-calls": "Contatti, messaggi e chiamate",
    "hidden-chats": "Chat nascoste",
    "circles-collab-boards": "Circles e Collab Boards",
    gifts: "Regali e sfide",
    advertising: "Pubblicità",
    "inviting-friends": "Invitare amici",
    "your-account-data": "Il tuo account e i tuoi dati",
    "privacy-safety-trust": "Privacy, sicurezza e fiducia",
  },
  items: { ...it1, ...it2, ...it3, ...it4, ...it5 },
};
