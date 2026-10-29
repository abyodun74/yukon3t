// Standard French, formal "vous". Product names (YuKon3t, Circles, Collab Boards) stay as they are. The space before
// "?" and ":" is a non-breaking one (U+00A0), so the punctuation never wraps onto a line of its own.
// Under /messages: a chat is "discussion", and the people someone is connected with are "relations" (a request is a
// "demande de mise en relation"), because "connexion" already means both signing in and the network connection.
// A story stays "story", a post is "publication", a live stream "direct". Nothing agrees in gender with the reader
// or with a named person: "Abonnement actif", "{name} vous invite…", not a past participle.

export const captchaFailed =
  "La vérification de sécurité ne s'est pas terminée. Touchez de nouveau « Confirmez que vous êtes humain » et attendez qu'elle se termine avant de continuer. Avec une connexion lente, cela peut prendre jusqu'à une minute.";
export const captchaUnavailable =
  "Notre service de vérification de sécurité ne répond pas pour le moment, nous ne pouvons donc pas continuer. Le problème ne vient pas de votre téléphone ni de votre connexion : réessayez dans quelques minutes.";
export const phoneInvalid = "Ce numéro n'est pas valide pour le pays sélectionné. Vérifiez le pays et les chiffres.";
export const emailPlaceholder = "vous@exemple.com";

export const serverUnreachable = "Impossible de joindre le serveur. Vérifiez votre connexion, puis réessayez.";
// Also under messages.controls: the screens under /messages render these two controls as well.
export const passwordInput = { show: "Afficher le mot de passe", hide: "Masquer le mot de passe" };
export const multiSelect = {
  placeholder: "Rechercher et sélectionner...",
  noMatches: "Aucun résultat",
  remove: "Retirer {label}",
  selected: "{count}/{max} sélectionnés",
};
