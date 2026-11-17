import type { advertiseEn } from "@/lib/i18n/en/advertise";
import { captchaUnavailable, serverUnreachable } from "@/lib/i18n/de/common";
import { shared } from "@/lib/i18n/de/shared";

export const advertise: typeof advertiseEn = {
  page: {
    eyebrow: "Werbung auf YuKon3t",
    title: "Bring dein Unternehmen zu einem globalen, verifizierten Publikum.",
    intro:
      "Ein Festpreis, kein Konto nötig und keine Zielgruppen, die du einrichten musst: Deine Anzeige wird an den von dir gewählten Tagen in der ganzen App gezeigt. Jede Anzeige wird vor der Veröffentlichung geprüft, und der Preis beträgt {price} pro Tag.",
    canceled: "Die Zahlung wurde abgebrochen und es wurde nichts berechnet. Du kannst sie jederzeit erneut senden.",
    notConfigured: "Anzeigenbuchungen sind noch nicht verfügbar. Schau bald wieder vorbei oder schreib uns direkt.",
  },
  success: {
    eyebrow: "Zahlung eingegangen",
    title: "Danke: Deine Anzeige ist gebucht.",
    body: "Wir prüfen deine Anzeige in Kürze (normalerweise innerhalb eines Werktags), bevor wir sie veröffentlichen. Bei Fragen melden wir uns unter der von dir angegebenen Kontakt-E-Mail.",
    back: "Zurück zu YuKon3t",
  },
  form: {
    company: "Firmenname",
    contactName: "Name der Kontaktperson",
    contactEmail: "Kontakt-E-Mail",
    emailPlaceholder: "du@firma.de",
    emailHint: "Hier erhältst du deine Quittung und den Stand der Prüfung.",
    headline: "Titel",
    headlinePlaceholder: "Wofür wirbst du?",
    copy: "Anzeigentext",
    copyPlaceholder: "Ein oder zwei Sätze, die beschreiben, was du anbietest.",
    link: "Link-URL",
    linkPlaceholder: "https://deinefirma.de",
    creative: "Bild oder Video der Anzeige",
    removeMedia: "Datei entfernen",
    addPhoto: "Foto hinzufügen",
    addVideo: "Video hinzufügen",
    uploadFromDevice: "Vom Gerät hochladen",
    takePhoto: "Foto aufnehmen",
    duration: "Dauer",
    days: "one: # Tag | other: # Tage",
    total: "Gesamt",
    preparing: "Zahlung wird vorbereitet...",
    continue: "Weiter zur Zahlung: {price}",
    stripeNote:
      "Du zahlst sicher über Stripe. Anzeigen werden nach einer kurzen Prüfung veröffentlicht, normalerweise innerhalb eines Werktags.",
    oneTime:
      "one: Einmalige Zahlung für # Tag. Sie verlängert sich nicht und wird nicht automatisch wiederholt. Für eine weitere Kampagne brauchst du eine neue Buchung und eine separate Zahlung. | other: Einmalige Zahlung für # Tage. Sie verlängert sich nicht und wird nicht automatisch wiederholt. Für eine weitere Kampagne brauchst du eine neue Buchung und eine separate Zahlung.",
    // The bot check's own button and status lines (TurnstileWidget), the same sentences as the account screens.
    turnstile: shared.turnstile,
    errors: {
      too_large: "Diese Datei ist zu groß.",
      moderation: "Diese Anzeige entspricht nicht unseren Inhaltsrichtlinien.",
      rate_limited: "Zu viele Versuche. Versuche es gleich noch einmal.",
      not_configured: "Anzeigenbuchungen sind noch nicht verfügbar. Schau bald wieder vorbei.",
      payment_setup_failed: "Wir konnten die Zahlung nicht starten. Versuche es noch einmal.",
      invalid: "Prüfe die Angaben, die du eingegeben hast.",
      network: serverUnreachable,
      captcha: "Wir konnten die Sicherheitsprüfung nicht abschließen. Warte einen Moment und versuche es noch einmal.",
      captcha_unavailable: captchaUnavailable,
      other: "Wir konnten die Buchung nicht senden. Versuche es noch einmal.",
      imageType: "Nutze ein Bild als JPEG, PNG oder WebP.",
      imageTooLarge: "Bilder dürfen höchstens 25 MB groß sein.",
      videoType: "Nutze ein Video als MP4, MOV oder WebM.",
      videoTooLarge: "Das Video darf höchstens 250 MB groß sein.",
      videoTooLong: "one: Videos dürfen höchstens # Sekunde lang sein. | other: Videos dürfen höchstens # Sekunden lang sein.",
      details: "Fülle die Angaben zu deinem Unternehmen und zur Kontaktperson aus.",
      adFields: "Fülle Titel, Text und Link deiner Anzeige aus.",
      media: "Füge deiner Anzeige ein Foto oder Video hinzu.",
    },
  },
};
