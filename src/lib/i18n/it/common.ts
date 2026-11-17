// Italian, informal "tu". Product names (YuKon3t, Circles, Collab Boards) stay as they are.
// Under /messages the people someone is connected with are "contatti" (a request is a "richiesta di contatto"),
// because "connessione" already means the network connection. A story is "storia", a post "post", a live
// stream "diretta". A screen is referred to by the label the nav gives it ("Scopri", "Impostazioni"), even
// while the screen itself is still English. A state of the reader ("Abbonamento attivo") is worded without a
// gendered participle.

export const captchaFailed =
  "La verifica di sicurezza non è stata completata. Tocca «Verifica di essere umano» di nuovo e aspetta che finisca prima di continuare. Con una connessione lenta può volerci fino a un minuto.";
export const captchaUnavailable =
  "Il nostro servizio di verifica di sicurezza non risponde in questo momento, quindi non possiamo continuare. Non dipende dal tuo telefono né dalla tua connessione: riprova tra qualche minuto.";
export const phoneInvalid = "Questo numero non è valido per il paese selezionato. Controlla il paese e le cifre.";
export const emailPlaceholder = "tu@esempio.com";

export const serverUnreachable = "Non siamo riusciti a connetterci al server. Controlla la connessione e riprova.";
export const newVersionAvailable = "È disponibile una nuova versione dell'app. Aggiorna la pagina per continuare.";
// Also under messages.controls: the screens under /messages render these two controls as well.
export const passwordInput = { show: "Mostra password", hide: "Nascondi password" };
export const multiSelect = {
  placeholder: "Cerca e seleziona...",
  noMatches: "Nessun risultato",
  remove: "Rimuovi {label}",
  selected: "{count}/{max} selezionati",
};
