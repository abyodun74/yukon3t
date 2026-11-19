import type { accountEn } from "@/lib/i18n/en/account";
import { captchaFailed, captchaUnavailable, phoneInvalid, emailPlaceholder } from "@/lib/i18n/it/common";

export const account: typeof accountEn = {
  languagePicker: { label: "Lingua" },
  landing: {
    eyebrow: "Connessione globale, con onestà",
    title: "Entra in contatto con persone di tutto il mondo: per interessi, per cultura, per scopo.",
    intro:
      "YuKon3t nasce da un'idea: tutte le grandi app per conoscere altre persone hanno un problema di fiducia. Abbiamo risolto i problemi che tornano di continuo nelle recensioni di utenti reali: profili falsi, moderazione opaca e sicurezza solo per chi paga.",
    createAccount: "Prima volta? Crea il tuo account gratis",
    guidelines: "Leggi le nostre regole",
    pillars: [
      {
        title: "Account verificati prima di qualsiasi messaggio",
        body: "Ogni account conferma la propria e-mail o il proprio numero di telefono prima che vengano attivati i messaggi diretti, e ogni provvedimento preso contro un account include il motivo e una via per fare ricorso: niente espulsioni silenziose.",
      },
      {
        title: "Dì cosa cerchi qui",
        body: "Indica la tua intenzione (amicizia, scambio culturale, contatti professionali, community o consigli di viaggio) così le conversazioni non scivolano mai verso qualcosa che non eri venuto a cercare.",
      },
      {
        title: "Circle gratuiti, senza far pagare chi organizza",
        body: "Crea community attorno a interessi e identità, o unisciti a quelle esistenti, gratis. Nessuna quota annuale per gli organizzatori.",
      },
      {
        title: "I tuoi dati sono sempre tuoi",
        body: "Esporta il tuo account o eliminalo definitivamente con un solo clic, sempre gratis. Non dovrai mai pagare per farlo.",
      },
    ],
    waysTitle: "Due modi per entrare in contatto",
    circles: {
      title: "Circles",
      body: "Community attorno a interessi e identità: hobby, cause, culture. Crearle e unirsi è gratis.",
    },
    collabBoards: {
      title: "Collab Boards",
      body: "Scambi di competenze tra paesi, volontariato, gruppi di studio e progetti: il tipo di contatto che la maggior parte delle app globali trascura.",
    },
    // Use-case blocks under the pillars: what the app actually does, in words people search for. Each claim is
    // checked against the FAQ (verification, Stories, Muse, Circles, live stage, shopping lists, reminders, languages).
    features: {
      heading: "Cosa puoi fare su YuKon3t",
      intro:
        "Resta vicino ad amici e familiari oltre i confini e conosci persone che condividono i tuoi interessi, la tua lingua o la tua cultura.",
      items: [
        {
          title: "Amici di altre culture e della diaspora",
          body: "Trova persone per paese o interesse e di' cosa cerchi: amicizia, scambio culturale, comunità, contatti professionali o consigli di viaggio.",
        },
        {
          title: "Storie che i tuoi amici possono apprezzare con un cuore",
          body: "Condividi foto e video che spariscono dopo 24 ore. Gli amici possono rispondere o toccare il cuore, e solo tu vedi a chi è piaciuta la tua storia.",
        },
        {
          title: "Video brevi su Muse",
          body: "Un feed a schermo intero di video brevi, divertenti e creativi che chiunque su YuKon3t può guardare, apprezzare e commentare.",
        },
        {
          title: "Circles privati e Collab Boards",
          body: "Crea gratis un Circle per un hobby, una causa o una cultura, e rendilo solo su invito se vuoi. I Collab Boards riuniscono persone di paesi diversi per scambiarsi competenze, studiare in gruppo e portare avanti progetti.",
        },
        {
          title: "Dirette con fino a 10 ospiti",
          body: "Trasmetti in diretta, invita fino a 10 persone sul palco con te e scegli chi può guardare, anche solo le persone che selezioni tu.",
        },
        {
          title: "Liste della spesa condivise in chat",
          body: "Invia una lista della spesa in una chat: tutti possono spuntare gli articoli, aggiungerne altri e vedere le modifiche all'istante. Ci sono anche le chiamate vocali e video.",
        },
        {
          title: "Promemoria di compleanni e festività",
          body: "Ricevi un promemoria per i compleanni che i tuoi amici scelgono di condividere e un avviso nei giorni festivi del tuo paese, che puoi disattivare nelle Impostazioni.",
        },
        {
          title: "Nove lingue, una comunità",
          body: "Usa YuKon3t in inglese, spagnolo, francese, portoghese, arabo, tedesco, italiano, hindi o swahili, e cambia lingua quando vuoi.",
        },
      ],
    },
  },
  // Search results and link previews (src/lib/seo.ts): title at most 60 characters, description 140 to 160.
  seo: {
    landing: {
      title: "YuKon3t: amici di altre culture, Circles e dirette",
      description:
        "Amici di altre culture e della diaspora: storie, video Muse, Circles privati e dirette con fino a 10 ospiti. Account verificati via email o telefono.",
    },
    faq: {
      title: "Domande frequenti su YuKon3t: verifica, Circles e dirette",
      description:
        "Come funziona YuKon3t: verifica via email o telefono, Circles privati, Collab Boards, storie, video Muse, dirette, chiamate, compleanni e privacy.",
    },
  },
  common: {
    signIn: "Accedi",
    captchaFailed,
    captchaUnavailable,
    somethingWentWrong: "Qualcosa è andato storto. Riprova.",
    invalidEmail: "Inserisci un indirizzo e-mail valido.",
    emailLabel: "E-mail",
    emailPlaceholder,
    codeLabel: "Codice di verifica",
    phoneLabel: "Numero di telefono",
    newCodeSent: "Ti abbiamo inviato un nuovo codice.",
    resendCode: "Invia di nuovo il codice",
    resending: "Invio...",
    confirming: "Conferma in corso...",
    switching: "Cambio in corso...",
    sending: "Invio...",
    nothingToVerify: "Qui non c'è nulla da verificare",
    alreadyVerified: "Già verificato",
  },
  apple: { signIn: "Accedi con Apple", redirecting: "Reindirizzamento..." },
  signIn: {
    title: "Accedi a YuKon3t",
    passwordHeading: "Nome utente e password",
    resetDone: "Password reimpostata. Accedi con la tua nuova password.",
    resetRequired:
      "Per la tua sicurezza, devi creare una nuova password. Abbiamo inviato un link per reimpostarla all'e-mail del tuo account.",
    errors: {
      invalid_credentials: "Nome utente/e-mail o password errati.",
      rate_limited: "Troppi tentativi. Aspetta qualche minuto e riprova.",
    },
    identifier: "Nome utente o e-mail",
    password: "Password",
    submit: "Accedi",
    submitting: "Accesso in corso...",
    forgotPassword: "Hai dimenticato la password?",
    noPasswordHint:
      "Ti sei registrato con un link via e-mail, con Google o con Apple, oppure non ricordi la password? Scegli «Hai dimenticato la password?» per crearne una nuova, oppure accedi con il link via e-mail qui sotto.",
    or: "oppure",
    magicHeading: "Link via e-mail",
    magicIntro:
      "Niente password che finiscono in giro o si ripetono: ti inviamo via e-mail un link sicuro per accedere.",
    magicSubmit: "Invia link di accesso",
  },
  checkEmail: {
    title: "Controlla la tua e-mail",
    verifyBody:
      "Se esiste un account con quell'e-mail in attesa di verifica, gli abbiamo inviato un codice di 6 cifre. Scade fra 10 minuti.",
    linkBody: "Ti abbiamo inviato un link sicuro per accedere. Scade presto, quindi usalo il prima possibile.",
    enterCode: "Inserisci il codice",
    closeTab: "Puoi chiudere questa scheda.",
  },
  verifyDevice: {
    expiredBody: "Questo link è scaduto o è stato aperto su un altro dispositivo. Accedi di nuovo per continuare.",
    title: "Non riconosciamo questo dispositivo",
    body: "Per la tua sicurezza, inserisci il codice di 6 cifre che ti abbiamo appena inviato per e-mail per completare l'accesso. Se non sei stato tu, ignoralo: il tuo account è al sicuro.",
    errors: {
      invalid_code: "Questo codice non corrisponde. Controllalo e riprova.",
      expired: "Questo codice è scaduto. Richiedine uno nuovo qui sotto.",
      too_many_attempts: "Troppi tentativi errati. Richiedi un nuovo codice qui sotto.",
      not_found: "Questo link di verifica non è più valido. Richiedi un nuovo codice qui sotto.",
      rate_limited: "Troppi tentativi. Aspetta un po' e riprova.",
    },
    submit: "Conferma e accedi",
    cancel: "Annulla e torna indietro",
  },
  signUp: {
    title: "Crea un account",
    intro:
      "Scegli un nome utente, inserisci la tua e-mail e la password che preferisci, e conferma il tuo account con un codice che ti inviamo via e-mail o SMS prima di accedere.",
    appleDivider: "oppure crea un account con password",
    haveAccount: "Hai già un account?",
    form: {
      oneFix: "Manca solo una correzione",
      fewFixes: "Ci sono alcune cose da correggere",
      othersSaved: "Gli altri tuoi dati sono stati salvati.",
      username: "Nome utente",
      usernameTitle: "Solo lettere, numeri e trattini bassi",
      usernamePlaceholder: "3–20 lettere, numeri, _",
      email: "E-mail",
      emailPlaceholder,
      signInInstead: "Meglio accedere",
      password: "Password",
      passwordPlaceholder: "Minimo 8 caratteri",
      birthDate: "Data di nascita",
      ageHint: "Devi avere almeno {age} anni per usare YuKon3t.",
      verifyWith: "Verifica con",
      emailCode: "Codice via e-mail",
      emailCodeHint: "Invieremo un codice di 6 cifre all'e-mail qui sopra.",
      phoneNumber: "Numero di telefono",
      phoneHint: "Invieremo un codice via SMS a questo numero.",
      editAll: "Modifica tutti i dati",
      submit: "Crea account",
      submitting: "Creazione dell'account...",
      reasons: {
        username_required: "Scegli un nome utente.",
        username_length: "I nomi utente hanno da {usernameMin} a {usernameMax} caratteri.",
        username_characters:
          "I nomi utente possono contenere solo lettere, numeri e trattini bassi ({usernameMin}–{usernameMax} caratteri).",
        username_reserved: "Questo nome utente è riservato. Scegline un altro.",
        username_taken: "Questo nome utente è già in uso. Provane un altro.",
        email_required: "Inserisci la tua e-mail.",
        email_invalid: "Questo indirizzo e-mail non sembra valido. Controlla di averlo scritto bene.",
        email_taken: "Esiste già un account con questa e-mail.",
        password_required: "Scegli una password.",
        password_too_short: "La password deve avere almeno {passwordMin} caratteri.",
        password_too_long: "La password può avere al massimo {passwordMax} caratteri.",
        birth_date_required: "Seleziona il mese, il giorno e l'anno in cui sei nato.",
        birth_date_underage: "Devi avere almeno {age} anni per usare YuKon3t.",
        phone_required: "Inserisci il tuo numero di telefono.",
        phone_invalid: phoneInvalid,
        phone_taken: "Questo numero di telefono è già verificato su un altro account.",
      },
      formErrors: {
        rate_limited: "Troppi tentativi. Aspetta un po' e riprova.",
        captcha: captchaFailed,
        captcha_unavailable: captchaUnavailable,
        invalid: "Qualcosa è andato storto. Riprova.",
      },
    },
  },
  verifyPhone: {
    expiredBody: "Questo link è scaduto o è stato aperto su un altro dispositivo.",
    title: "Verifica il tuo telefono",
    intro: "Inserisci il tuo numero di telefono e ti invieremo un codice via SMS per confermare il tuo account.",
    noText: "Non ti arriva l'SMS?",
    emailInstead: "Possiamo inviarti il codice via e-mail.",
    useEmail: "Usa il codice via e-mail",
    form: {
      errors: {
        invalid: phoneInvalid,
        invalid_code: "Questo codice non corrisponde. Controllalo e riprova.",
        rate_limited: "Troppi tentativi. Riprova fra un po'.",
        not_configured: "La verifica tramite telefono non è ancora disponibile.",
        phone_taken: "Questo numero è già verificato su un altro account.",
        send_failed: "Non siamo riusciti a inviare il codice. Riprova fra un momento.",
        no_session: "Questo link è scaduto. Registrati di nuovo.",
        captcha: "Non siamo riusciti a completare la verifica di sicurezza. Riprova.",
        captcha_unavailable: captchaUnavailable,
      },
      somethingWentWrong: "Qualcosa è andato storto. Riprova.",
      confirmedTitle: "Telefono confermato",
      confirmedBody: "Il tuo account è verificato. Ora puoi accedere.",
      signIn: "Accedi",
      codeLabel: "Inserisci il codice che ti abbiamo inviato",
      verify: "Verifica",
      resendCode: "Invia di nuovo il codice",
      phoneLabel: "Numero di telefono",
      sendCode: "Invia codice",
    },
  },
  verifyEmail: {
    confirmedTitle: "E-mail confermata",
    confirmedBody: "La tua e-mail è verificata. Ora puoi accedere con nome utente e password.",
    expiredBody:
      "Questo link è scaduto o è stato aperto su un altro dispositivo. Accedi e ti aiuteremo a completare la verifica del tuo account.",
    title: "Conferma la tua e-mail",
    body: "Inserisci il codice di 6 cifre che abbiamo inviato a {email}.",
    errors: {
      invalid_code: "Questo codice non corrisponde. Controllalo e riprova.",
      expired: "Questo codice è scaduto. Te ne abbiamo inviato uno nuovo.",
      too_many_attempts: "Troppi tentativi errati. Ti abbiamo inviato un nuovo codice.",
      rate_limited: "Troppi tentativi. Aspetta un po' e riprova.",
      invalid_phone: phoneInvalid,
      phone_taken: "Questo numero di telefono è già verificato su un altro account.",
      send_failed: "Non siamo riusciti a inviare il codice in questo momento. Se non arriva entro un minuto, tocca «Invia di nuovo il codice» o verifica con il telefono.",
    },
    submit: "Conferma e-mail",
    slowTitle: "L'e-mail tarda troppo?",
    slowBody: "Verifica con il tuo numero di telefono: ti invieremo un codice via SMS.",
    usePhone: "Usa il telefono",
  },
  forgotPassword: {
    title: "Reimposta la tua password",
    intro: "Inserisci l'e-mail del tuo account e ti invieremo un link per reimpostare la password.",
    sent: "Se quell'e-mail è registrata, il link per reimpostare la password è in arrivo. Controlla la posta in arrivo.",
    expired: "Quel link è scaduto o è già stato usato. Richiedine uno nuovo qui sotto.",
    submit: "Invia link",
    back: "Torna all'accesso",
  },
  resetPassword: {
    invalidTitle: "Link non valido",
    invalidBody: "A questo link per reimpostare la password manca il token.",
    requestNew: "Richiedi un nuovo link",
    title: "Scegli una nuova password",
    errors: {
      invalid: "La password deve avere almeno 8 caratteri.",
      mismatch: "Le password non coincidono.",
      same_password: "Questa è la tua password precedente. Per la tua sicurezza, scegline una diversa.",
    },
    newLabel: "Nuova password",
    newPlaceholder: "Nuova password (min. 8 caratteri)",
    confirm: "Ripeti la nuova password",
    submit: "Reimposta password",
    submitting: "Reimpostazione...",
  },
  onboarding: {
    title: "Configura il tuo profilo",
    intro:
      "Questo è ciò che vedono gli altri membri. Sii sincero su ciò che cerchi: così la community funziona per tutti.",
    required:
      "Tutti i campi sono obbligatori tranne Bio, che è facoltativa. Il tuo account non verrà creato finché non completi il resto.",
    errors: {
      invalid: "Compila tutti i campi obbligatori.",
      moderation: "Il tuo nome o la tua bio non rispettano le nostre regole sui contenuti. Modificali.",
      underage: "Devi avere almeno {age} anni per usare YuKon3t.",
    },
    name: "Nome visualizzato",
    bio: "Bio",
    optional: "(facoltativo)",
    birthDate: "Data di nascita",
    ageHint: "Devi avere almeno {age} anni per usare YuKon3t.",
    country: "Paese",
    countryPlaceholder: "Seleziona il tuo paese...",
    languages: "Lingue",
    languagesHint: "Scegli almeno una lingua che parli.",
    languagesPlaceholder: "Cerca lingue...",
    interests: "Interessi",
    interestsHint: "Scegline almeno uno: così ti suggeriamo Circle e contatti.",
    interestsPlaceholder: "Cerca interessi...",
    intentsLabel: "Cosa cerchi qui?",
    intentsHint: "Scegli almeno un'opzione.",
    intents: {
      FRIENDSHIP: "Amicizia",
      CULTURAL_EXCHANGE: "Scambio culturale",
      PROFESSIONAL: "Professionale",
      COMMUNITY: "Community",
      TRAVEL_TIPS: "Consigli di viaggio",
    },
    submit: "Continua",
    submitting: "Salvataggio...",
  },
  emails: {
    verificationCode: {
      subject: "Il tuo codice di verifica di YuKon3t",
      intro: "Il tuo codice di verifica di YuKon3t è:",
      outro: "Questo codice scade fra 10 minuti. Se non l'hai richiesto, ignora questa e-mail.",
    },
    passwordReset: {
      subject: "Reimposta la tua password di YuKon3t",
      requested: {
        intro: "Qualcuno ha richiesto di reimpostare la password di questo account YuKon3t.",
        link: "Reimposta la tua password",
        outro: "Questo link scade fra 1 ora. Se non l'hai richiesto, ignora questa e-mail: la tua password non cambierà.",
      },
      required: {
        intro:
          "Per la tua sicurezza, devi creare una nuova password per questo account YuKon3t. Stiamo chiedendo a tutti di scegliere una nuova password come misura di sicurezza.",
        link: "Scegli una nuova password",
        outro: "Questo link scade fra 1 ora. La tua vecchia password non funziona più per accedere.",
      },
    },
    magicLink: {
      subject: "Accedi a {host}",
      heading: "Accedi a {host}",
      button: "Accedi",
      ignore: "Se non hai richiesto questa e-mail, puoi tranquillamente ignorarla.",
    },
    deviceChallenge: {
      subjects: {
        LOGIN: "Conferma che sei tu: nuovo accesso al tuo account YuKon3t",
        PASSWORD_CHANGE: "Conferma che sei tu: cambio password su YuKon3t",
        POST: "Conferma che sei tu: pubblicazione su YuKon3t da un nuovo dispositivo",
        HIDDEN_PIN_RESET: "Il tuo codice di sicurezza di YuKon3t",
        ACCOUNT_DELETE: "Conferma che sei tu: eliminazione del tuo account YuKon3t",
        DATA_EXPORT: "Conferma che sei tu: download dei tuoi dati di YuKon3t",
      },
      intros: {
        LOGIN:
          "Qualcuno ha appena provato ad accedere al tuo account YuKon3t da un dispositivo che non riconosciamo ({device}).",
        PASSWORD_CHANGE:
          "Qualcuno ha appena provato a cambiare la password del tuo account YuKon3t da un dispositivo che non riconosciamo ({device}).",
        POST: "Qualcuno ha appena provato a pubblicare dal tuo account YuKon3t con un dispositivo che non riconosciamo ({device}).",
        ACCOUNT_DELETE: "Qualcuno che ha effettuato l'accesso al tuo account YuKon3t ha appena chiesto di eliminarlo definitivamente ({device}).",
        DATA_EXPORT: "Qualcuno che ha effettuato l'accesso al tuo account YuKon3t ha appena chiesto di scaricare una copia di tutti i suoi dati ({device}).",
      },
      ifYou: "Se sei stato tu, inserisci questo codice per continuare:",
      outro:
        "Questo codice scade fra 10 minuti. Se non sei stato tu, non condividere questo codice con nessuno e cambia la password dalle Impostazioni il prima possibile.",
      hiddenPinReset: {
        intro: "Inserisci questo codice in YuKon3t per continuare:",
        outro: "Questo codice scade fra 10 minuti. Se non l'hai richiesto, non condividerlo con nessuno.",
      },
    },
  },
};
