import type { FaqContent } from "../ids";
import { sw1 } from "./sw-1";
import { sw2 } from "./sw-2";
import { sw3 } from "./sw-3";
import { sw4 } from "./sw-4";
import { sw5 } from "./sw-5";

// The FAQ in Swahili. Same conventions as src/lib/i18n/sw. Every answer says what its English says in ../page.tsx,
// no more and no less: these are factual, privacy and safety claims, so a change there is a change here.
export const sw: FaqContent = {
  heading: "Maswali yanayoulizwa mara kwa mara",
  intro:
    "Kila unachohitaji ili kujipatia njia kwenye YuKon3t. Hupati jibu hapa? Jibu barua pepe yoyote ya usimamizi au tuandikie kupitia chaguo la kuripoti la ukurasa husika.",
  sections: {
    "getting-around": "Jinsi ya kujipatia njia",
    "android-app": "Programu ya Android",
    "posts-media": "Machapisho na maudhui ya picha na video",
    "going-live": "Matangazo ya moja kwa moja",
    stories: "Story",
    muse: "Muse",
    ambient: "Ambient",
    "connecting-messaging-calls": "Wasiliani, ujumbe na simu",
    "hidden-chats": "Mazungumzo yaliyofichwa",
    "circles-collab-boards": "Circles na Collab Boards",
    gifts: "Zawadi na changamoto",
    advertising: "Matangazo ya biashara",
    "inviting-friends": "Kualika marafiki",
    "your-account-data": "Akaunti yako na data yako",
    "privacy-safety-trust": "Faragha, usalama na uaminifu",
  },
  items: { ...sw1, ...sw2, ...sw3, ...sw4, ...sw5 },
};
