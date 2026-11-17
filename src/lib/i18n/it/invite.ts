import type { inviteEn } from "@/lib/i18n/en/invite";
import { phoneInvalid } from "@/lib/i18n/it/common";
import { shared } from "@/lib/i18n/it/shared";

// The contacts here are the phone's address book ("la rubrica", "contatti del telefono"), not the people someone is
// connected with on YuKon3t.
export const invite: typeof inviteEn = {
  controls: { phoneField: shared.phoneField, phoneInvalid },
  title: "Invita amici",
  intro: "Porta su YuKon3t le persone che conosci.",
  message: "Unisciti a me su YuKon3t e entra in contatto con persone di altre culture, interessi e paesi:",
  linkHeading: "I tuoi link di invito",
  copy: "Copia",
  copied: "Copiato!",
  copyFailed: "Impossibile copiare",
  share: "Condividi",
  shareFailed: "Impossibile condividere. Riprova.",
  whatsApp: "WhatsApp",
  whatsAppLabel: "Invita su WhatsApp",
  textHeading: "Invita con un SMS o su WhatsApp",
  textIntro:
    "Scegli le persone dalla rubrica (dove possibile) o inserisci un numero, e invia a ciascuna un SMS o un messaggio WhatsApp con i link dell'App Store e di Google Play.",
  openingContacts: "Apertura della rubrica…",
  chooseContacts: "Scegli dalla rubrica",
  phoneLabel: "Numero di telefono",
  add: "Aggiungi",
  invite: "Invita",
  // Visible label of the contact row's sms: action (the WhatsApp one reuses `whatsApp`), then a one-line hint for Android's "open with" chooser.
  textButton: "SMS",
  textHint: "Se il telefono ti chiede con cosa aprirlo, scegli Messaggi.",
  remove: "Rimuovi",
  pickerTitle: "Scegli dalla rubrica",
  searchContacts: "Cerca nella rubrica",
  noMatches: "Nessuno corrisponde alla ricerca.",
  addSelected: "one: Aggiungi # selezionato | other: Aggiungi # selezionati",
  selectToAdd: "Seleziona chi aggiungere",
  phoneKinds: { mobile: "Cellulare", home: "Casa", work: "Lavoro", other: "Altro" },
  errors: {
    permission:
      "Il permesso di accedere alla rubrica è stato negato. Attivalo per YuKon3t nelle impostazioni del telefono per invitare dalla rubrica.",
    noNumbers: "Nessuno nella tua rubrica ha un numero di telefono salvato.",
    openFailed: "Impossibile aprire la rubrica. Riprova.",
    pickedNoNumbers: "Queste persone non hanno un numero di telefono salvato.",
  },
};
