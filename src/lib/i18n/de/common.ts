// Standard German, informal "du". Product names (YuKon3t, Circles, Collab Boards, Muse, Story) stay as they are.
// Under /messages the people someone is connected with are "Kontakte" (a request is a "Kontaktanfrage"), because
// "Verbindung" already means the network connection. A post is "Beitrag", a live stream "Livestream", a chat "Chat".
// A screen is referred to by the label the nav gives it ("Entdecken", "Einstellungen"), even while the screen itself
// is still English. A state of the reader ("Abo aktiv") is worded without a gendered form. Muse is neuter
// ("ein Muse", "die Muses"), Circle masculine ("der Circle"), Story feminine ("die Story", "die Stories").
// Quotation marks are „…“.

export const captchaFailed =
  "Die Sicherheitsprüfung wurde nicht abgeschlossen. Tippe noch einmal auf „Bestätige, dass du ein Mensch bist“ und warte, bis sie fertig ist, bevor du weitermachst. Bei einer langsamen Verbindung kann das bis zu einer Minute dauern.";
export const captchaUnavailable =
  "Unser Dienst für die Sicherheitsprüfung antwortet gerade nicht, deshalb können wir nicht fortfahren. Das liegt nicht an deinem Handy oder deiner Verbindung: Versuche es in ein paar Minuten noch einmal.";
export const phoneInvalid = "Diese Nummer ist für das ausgewählte Land nicht gültig. Prüfe das Land und die Ziffern.";
export const emailPlaceholder = "du@beispiel.de";

export const serverUnreachable = "Wir konnten den Server nicht erreichen. Prüfe deine Verbindung und versuche es noch einmal.";
export const newVersionAvailable = "Es gibt eine neue Version der App. Lade die Seite neu, um fortzufahren.";
// Also under messages.controls: the screens under /messages render these two controls as well.
export const passwordInput = { show: "Passwort anzeigen", hide: "Passwort verbergen" };
export const multiSelect = {
  placeholder: "Suchen und auswählen...",
  noMatches: "Keine Treffer",
  remove: "{label} entfernen",
  selected: "{count}/{max} ausgewählt",
};
