import type { advertiseEn } from "@/lib/i18n/en/advertise";
import { captchaUnavailable, serverUnreachable } from "@/lib/i18n/it/common";
import { shared } from "@/lib/i18n/it/shared";

export const advertise: typeof advertiseEn = {
  page: {
    eyebrow: "Fai pubblicità su YuKon3t",
    title: "Porta la tua attività a un pubblico globale e verificato.",
    intro:
      "Una tariffa fissa, nessun account necessario e nessuna segmentazione del pubblico da configurare: il tuo annuncio viene mostrato in tutta l'app per i giorni che scegli. Ogni annuncio viene controllato prima della pubblicazione e il prezzo è di {price} al giorno.",
    canceled: "Il pagamento è stato annullato e non è stato addebitato nulla. Puoi inviare di nuovo la richiesta quando vuoi.",
    notConfigured: "Le prenotazioni degli annunci non sono ancora disponibili. Torna presto o scrivici direttamente.",
  },
  success: {
    eyebrow: "Pagamento ricevuto",
    title: "Grazie: il tuo annuncio è prenotato.",
    body: "Controlleremo il tuo annuncio a breve (di solito entro un giorno lavorativo) prima di pubblicarlo. Se avremo domande, ti scriveremo all'e-mail di contatto che hai indicato.",
    back: "Torna a YuKon3t",
  },
  form: {
    company: "Nome dell'azienda",
    contactName: "Nome del referente",
    contactEmail: "E-mail di contatto",
    emailPlaceholder: "tu@azienda.com",
    emailHint: "Qui riceverai la ricevuta e lo stato della revisione.",
    headline: "Titolo",
    headlinePlaceholder: "Cosa stai promuovendo?",
    copy: "Testo dell'annuncio",
    copyPlaceholder: "Una o due frasi che descrivono ciò che offri.",
    link: "URL del link",
    linkPlaceholder: "https://tuaazienda.com",
    creative: "Immagine o video dell'annuncio",
    removeMedia: "Rimuovi file",
    addPhoto: "Aggiungi una foto",
    addVideo: "Aggiungi un video",
    uploadFromDevice: "Carica dal dispositivo",
    takePhoto: "Scatta una foto",
    duration: "Durata",
    days: "one: # giorno | other: # giorni",
    total: "Totale",
    preparing: "Preparazione del pagamento...",
    continue: "Vai al pagamento: {price}",
    stripeNote:
      "Pagherai in modo sicuro con Stripe. Gli annunci vengono pubblicati dopo una rapida revisione, di solito entro un giorno lavorativo.",
    oneTime:
      "one: Addebito unico per # giorno. Non si rinnova né si ripete automaticamente. Per pubblicare un'altra campagna in futuro serve una nuova prenotazione e un addebito separato. | other: Addebito unico per # giorni. Non si rinnova né si ripete automaticamente. Per pubblicare un'altra campagna in futuro serve una nuova prenotazione e un addebito separato.",
    // The bot check's own button and status lines (TurnstileWidget), the same sentences as the account screens.
    turnstile: shared.turnstile,
    errors: {
      too_large: "Questo file è troppo grande.",
      moderation: "Questo annuncio non rispetta le nostre regole sui contenuti.",
      rate_limited: "Troppi tentativi. Riprova tra poco.",
      not_configured: "Le prenotazioni degli annunci non sono ancora disponibili. Torna presto.",
      payment_setup_failed: "Impossibile avviare il pagamento. Riprova.",
      invalid: "Controlla i dati che hai inserito.",
      network: serverUnreachable,
      captcha: "Non siamo riusciti a completare la verifica di sicurezza. Aspetta un attimo e riprova.",
      captcha_unavailable: captchaUnavailable,
      other: "Impossibile inviare la prenotazione. Riprova.",
      imageType: "Usa un'immagine JPEG, PNG o WebP.",
      imageTooLarge: "Le immagini devono pesare al massimo 25 MB.",
      videoType: "Usa un video MP4, MOV o WebM.",
      videoTooLarge: "Il video deve pesare al massimo 250 MB.",
      videoTooLong: "one: I video devono durare al massimo # secondo. | other: I video devono durare al massimo # secondi.",
      details: "Compila i dati dell'azienda e del referente.",
      adFields: "Compila titolo, testo e link del tuo annuncio.",
      media: "Aggiungi una foto o un video al tuo annuncio.",
    },
  },
};
