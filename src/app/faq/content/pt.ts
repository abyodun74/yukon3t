import type { FaqContent } from "../ids";
import { pt1 } from "./pt-1";
import { pt2 } from "./pt-2";
import { pt3 } from "./pt-3";
import { pt4 } from "./pt-4";

// The FAQ in Portuguese. Same conventions as src/lib/i18n/pt. Every answer says what its English says in
// ../page.tsx, no more and no less: these are factual, privacy and safety claims, so a change there is a change here.
export const pt: FaqContent = {
  heading: "Perguntas frequentes",
  intro:
    "Tudo o que você precisa para se orientar no YuKon3t. Não encontrou uma resposta aqui? Responda a qualquer e-mail de moderação ou fale conosco pela opção de denunciar da página em questão.",
  sections: {
    "getting-around": "Como se orientar",
    "android-app": "O aplicativo para Android",
    "posts-media": "Publicações e mídia",
    "going-live": "Transmissões ao vivo",
    stories: "Stories",
    muse: "Muse",
    ambient: "Ambient",
    "connecting-messaging-calls": "Conexões, mensagens e chamadas",
    "hidden-chats": "Conversas ocultas",
    "circles-collab-boards": "Circles e Collab Boards",
    advertising: "Publicidade",
    "inviting-friends": "Convidar amigos",
    "your-account-data": "Sua conta e seus dados",
    "privacy-safety-trust": "Privacidade, segurança e confiança",
  },
  items: { ...pt1, ...pt2, ...pt3, ...pt4 },
};
