import type { inviteEn } from "@/lib/i18n/en/invite";
import { phoneInvalid } from "@/lib/i18n/de/common";
import { shared } from "@/lib/i18n/de/shared";

// The contacts here are the phone's address book ("Adressbuch", "Kontakte auf dem Handy"), not the people someone is
// connected with on YuKon3t.
export const invite: typeof inviteEn = {
  controls: { phoneField: shared.phoneField, phoneInvalid },
  title: "Freunde einladen",
  intro: "Hol die Leute, die du kennst, zu YuKon3t.",
  message: "Komm zu YuKon3t und lerne Menschen aus anderen Kulturen, mit anderen Interessen und aus anderen Ländern kennen:",
  linkHeading: "Deine Einladungslinks",
  copy: "Kopieren",
  copied: "Kopiert!",
  copyFailed: "Kopieren nicht möglich",
  share: "Teilen",
  shareFailed: "Teilen nicht möglich. Versuche es noch einmal.",
  whatsApp: "WhatsApp",
  whatsAppLabel: "Per WhatsApp einladen",
  textHeading: "Per SMS oder WhatsApp einladen",
  textIntro:
    "Wähle Personen aus deinem Adressbuch (wo möglich) oder gib eine Nummer ein und sende jeder eine SMS oder WhatsApp-Nachricht mit den Links zum App Store und zu Google Play.",
  openingContacts: "Adressbuch wird geöffnet…",
  chooseContacts: "Aus dem Adressbuch wählen",
  phoneLabel: "Telefonnummer",
  add: "Hinzufügen",
  invite: "Einladen",
  // Visible label of the contact row's sms: action (the WhatsApp one reuses `whatsApp`), then a one-line hint for Android's "open with" chooser.
  textButton: "SMS",
  textHint: "Wenn dein Handy fragt, womit es geöffnet werden soll, wähle Nachrichten.",
  remove: "Entfernen",
  pickerTitle: "Aus dem Adressbuch wählen",
  searchContacts: "Im Adressbuch suchen",
  noMatches: "Niemand passt zur Suche.",
  addSelected: "one: # Ausgewählten hinzufügen | other: # Ausgewählte hinzufügen",
  selectToAdd: "Wähle aus, wen du hinzufügen möchtest",
  phoneKinds: { mobile: "Mobil", home: "Privat", work: "Arbeit", other: "Sonstige" },
  errors: {
    permission:
      "Der Zugriff auf das Adressbuch wurde verweigert. Erlaube ihn für YuKon3t in den Einstellungen deines Handys, um aus deinem Adressbuch einzuladen.",
    noNumbers: "Niemand in deinem Adressbuch hat eine gespeicherte Telefonnummer.",
    openFailed: "Wir konnten dein Adressbuch nicht öffnen. Versuche es noch einmal.",
    pickedNoNumbers: "Diese Personen haben keine gespeicherte Telefonnummer.",
  },
};
