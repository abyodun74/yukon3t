// Standard French, formal "vous". Product names (YuKon3t, Circles, Collab Boards) stay as they are. The space before
// "?" and ":" is a non-breaking one (U+00A0), so the punctuation never wraps onto a line of its own.
// Under /messages: a chat is "discussion", and the people someone is connected with are "relations" (a request is a
// "demande de mise en relation"), because "connexion" already means both signing in and the network connection.
// A story stays "story", a post is "publication", a live stream "direct". Nothing agrees in gender with the reader
// or with a named person: "Abonnement actif", "{name} vous invite…", not a past participle.

export const captchaFailed =
  "Nous n'avons pas pu terminer la vérification de sécurité. Patientez un instant, puis réessayez. Si le problème persiste, désactivez tout bloqueur de contenu ou essayez un autre réseau.";
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
