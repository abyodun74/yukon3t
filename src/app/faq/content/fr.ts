import type { FaqContent } from "../ids";
import { fr1 } from "./fr-1";
import { fr2 } from "./fr-2";
import { fr3 } from "./fr-3";
import { fr4 } from "./fr-4";

// The FAQ in French. Same conventions as src/lib/i18n/fr. Every answer says what its English says in ../page.tsx,
// no more and no less: these are factual, privacy and safety claims, so a change there is a change here.
export const fr: FaqContent = {
  heading: "Questions fréquentes",
  intro:
    "Tout ce qu'il vous faut pour vous repérer dans YuKon3t. Vous ne trouvez pas de réponse ici ? Répondez à n'importe quel e-mail de modération, ou contactez-nous via l'option de signalement de la page concernée.",
  sections: {
    "getting-around": "Se repérer",
    "android-app": "L'application Android",
    "posts-media": "Publications et contenus multimédias",
    "going-live": "Les directs",
    stories: "Stories",
    muse: "Muse",
    ambient: "Ambient",
    "connecting-messaging-calls": "Relations, messages et appels",
    "hidden-chats": "Discussions masquées",
    "circles-collab-boards": "Circles et Collab Boards",
    advertising: "Publicité",
    "inviting-friends": "Inviter des amis",
    "your-account-data": "Votre compte et vos données",
    "privacy-safety-trust": "Confidentialité, sécurité et confiance",
  },
  items: { ...fr1, ...fr2, ...fr3, ...fr4 },
};
