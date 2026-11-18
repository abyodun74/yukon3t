import type { accountEn } from "@/lib/i18n/en/account";
import { captchaFailed, captchaUnavailable, phoneInvalid, emailPlaceholder } from "@/lib/i18n/de/common";

export const account: typeof accountEn = {
  languagePicker: { label: "Sprache" },
  landing: {
    eyebrow: "Globale Verbindung, ehrlich gemeint",
    title: "Vernetze dich mit Menschen auf der ganzen Welt: über Interessen, Kultur und Sinn.",
    intro:
      "YuKon3t geht von einer Idee aus: Alle großen Apps zum Vernetzen haben ein Vertrauensproblem. Wir haben die Probleme gelöst, die in den Bewertungen echter Nutzer immer wieder auftauchen: gefälschte Profile, undurchsichtige Moderation und Sicherheit nur für zahlende Kunden.",
    createAccount: "Zum ersten Mal hier? Erstelle kostenlos dein Konto",
    guidelines: "Lies unsere Richtlinien",
    pillars: [
      {
        title: "Verifizierte Konten vor der ersten Nachricht",
        body: "Jedes Konto bestätigt seine E-Mail-Adresse oder Telefonnummer, bevor Direktnachrichten freigeschaltet werden, und jede Maßnahme gegen ein Konto nennt den Grund und einen Weg zum Widerspruch: keine stillen Sperren.",
      },
      {
        title: "Sag, wonach du hier suchst",
        body: "Gib deine Absicht an (Freundschaft, Kulturaustausch, berufliche Kontakte, Community oder Reisetipps), damit Gespräche nie in eine Richtung abdriften, die du nicht gesucht hast.",
      },
      {
        title: "Kostenlose Circles, ohne Kosten für Organisierende",
        body: "Gründe Communitys rund um Interessen und Identitäten oder tritt ihnen bei, kostenlos. Keine Jahresgebühren für Organisierende.",
      },
      {
        title: "Deine Daten gehören immer dir",
        body: "Exportiere dein Konto oder lösche es mit einem Klick endgültig, immer kostenlos. Dafür musst du nie bezahlen.",
      },
    ],
    waysTitle: "Zwei Wege, sich zu vernetzen",
    circles: {
      title: "Circles",
      body: "Communitys rund um Interessen und Identitäten: Hobbys, Anliegen, Kulturen. Gründen und Beitreten ist kostenlos.",
    },
    collabBoards: {
      title: "Collab Boards",
      body: "Fähigkeitenaustausch über Länder hinweg, Ehrenamt, Lerngruppen und Projekte: die Art von Verbindung, die die meisten globalen Apps übersehen.",
    },
    // Use-case blocks under the pillars: what the app actually does, in words people search for. Each claim is
    // checked against the FAQ (verification, Stories, Muse, Circles, live stage, shopping lists, reminders, languages).
    features: {
      heading: "Was du auf YuKon3t machen kannst",
      intro:
        "Bleib Freunden und Familie über Grenzen hinweg nah und lerne Menschen kennen, die deine Interessen, deine Sprache oder deine Kultur teilen.",
      items: [
        {
          title: "Freunde aus anderen Kulturen und der Diaspora",
          body: "Finde Menschen nach Land, Sprache oder Interesse und sag, wofür du hier bist: Freundschaft, kultureller Austausch, Community, berufliche Kontakte oder Reisetipps.",
        },
        {
          title: "Storys, die Freunde mit einem Herz liken",
          body: "Teile Fotos und Videos, die nach 24 Stunden verschwinden. Freunde können antworten oder auf das Herz tippen, und nur du siehst, wem deine Story gefällt.",
        },
        {
          title: "Kurze Videos auf Muse",
          body: "Ein Vollbild-Feed mit kurzen, lustigen und kreativen Videos, die alle auf YuKon3t ansehen, liken und kommentieren können.",
        },
        {
          title: "Private Circles und Collab Boards",
          body: "Gründe kostenlos einen Circle für ein Hobby, ein Anliegen oder eine Kultur und mach ihn auf Wunsch nur auf Einladung zugänglich. Collab Boards bringen Menschen aus verschiedenen Ländern für Wissensaustausch, Lerngruppen und Projekte zusammen.",
        },
        {
          title: "Live mit bis zu 10 Gästen",
          body: "Geh live, lade bis zu 10 Personen zu dir auf die Bühne ein und bestimme, wer zusehen darf, bis hin zu nur den Leuten, die du auswählst.",
        },
        {
          title: "Geteilte Einkaufslisten im Chat",
          body: "Schick eine Einkaufsliste in einen Chat: Alle darin können Einträge abhaken, neue hinzufügen und Änderungen sofort sehen. Sprach- und Videoanrufe sind auch gleich da.",
        },
        {
          title: "Erinnerungen an Geburtstage und Feiertage",
          body: "Lass dich an die Geburtstage erinnern, die deine Freunde teilen, und an gesetzliche Feiertage in deinem Land, was du in den Einstellungen ausschalten kannst.",
        },
        {
          title: "Neun Sprachen, eine Community",
          body: "Nutze YuKon3t auf Englisch, Spanisch, Französisch, Portugiesisch, Arabisch, Deutsch, Italienisch, Hindi oder Swahili und wechsle die Sprache, wann du willst.",
        },
      ],
    },
  },
  // Search results and link previews (src/lib/seo.ts): title at most 60 characters, description 140 to 160.
  seo: {
    landing: {
      title: "YuKon3t: Freunde aus aller Welt, Circles und Livestreams",
      description:
        "Freunde aus anderen Kulturen und der Diaspora: Storys, Muse-Videos, private Circles und Livestreams mit bis zu 10 Gästen. Konten per E-Mail/Telefon bestätigt.",
    },
    faq: {
      title: "YuKon3t FAQ: Bestätigung, Circles, Storys und Live",
      description:
        "YuKon3t erklärt: Bestätigung per E-Mail oder Telefon, private Circles, Collab Boards, Storys, Muse-Videos, Livestreams, Anrufe, Geburtstage und Datenschutz.",
    },
  },
  common: {
    signIn: "Anmelden",
    captchaFailed,
    captchaUnavailable,
    somethingWentWrong: "Etwas ist schiefgelaufen. Versuche es noch einmal.",
    invalidEmail: "Gib eine gültige E-Mail-Adresse ein.",
    emailLabel: "E-Mail-Adresse",
    emailPlaceholder,
    codeLabel: "Bestätigungscode",
    phoneLabel: "Telefonnummer",
    newCodeSent: "Wir haben dir einen neuen Code geschickt.",
    resendCode: "Code erneut senden",
    resending: "Wird erneut gesendet...",
    confirming: "Wird bestätigt...",
    switching: "Wird gewechselt...",
    sending: "Wird gesendet...",
    nothingToVerify: "Hier gibt es nichts zu verifizieren",
    alreadyVerified: "Bereits verifiziert",
  },
  apple: { signIn: "Mit Apple anmelden", redirecting: "Weiterleitung..." },
  signIn: {
    title: "Bei YuKon3t anmelden",
    passwordHeading: "Benutzername und Passwort",
    resetDone: "Passwort zurückgesetzt. Melde dich mit deinem neuen Passwort an.",
    resetRequired:
      "Zu deiner Sicherheit musst du ein neues Passwort festlegen. Wir haben einen Link zum Zurücksetzen an die E-Mail-Adresse deines Kontos geschickt.",
    errors: {
      invalid_credentials: "Benutzername/E-Mail oder Passwort falsch.",
      rate_limited: "Zu viele Versuche. Warte ein paar Minuten und versuche es noch einmal.",
    },
    identifier: "Benutzername oder E-Mail-Adresse",
    password: "Passwort",
    submit: "Anmelden",
    submitting: "Anmeldung läuft...",
    forgotPassword: "Passwort vergessen?",
    noPasswordHint:
      "Hast du dich mit einem E-Mail-Link, Google oder Apple registriert oder erinnerst du dich nicht an dein Passwort? Wähle „Passwort vergessen?“, um ein neues zu erstellen, oder melde dich unten mit dem Link per E-Mail an.",
    or: "oder",
    magicHeading: "Link per E-Mail",
    magicIntro:
      "Keine Passwörter, die geleakt oder wiederverwendet werden: Wir schicken dir einen sicheren Link zur Anmeldung per E-Mail.",
    magicSubmit: "Anmeldelink senden",
  },
  checkEmail: {
    title: "Prüfe dein Postfach",
    verifyBody:
      "Wenn es ein Konto mit dieser E-Mail-Adresse gibt, das noch verifiziert werden muss, haben wir ihm einen 6-stelligen Code geschickt. Er läuft in 10 Minuten ab.",
    linkBody: "Wir haben dir einen sicheren Link zur Anmeldung geschickt. Er läuft bald ab, also nutze ihn möglichst schnell.",
    enterCode: "Code eingeben",
    closeTab: "Du kannst diesen Tab schließen.",
  },
  verifyDevice: {
    expiredBody: "Dieser Link ist abgelaufen oder wurde auf einem anderen Gerät geöffnet. Melde dich erneut an, um fortzufahren.",
    title: "Wir erkennen dieses Gerät nicht",
    body: "Gib zu deiner Sicherheit den 6-stelligen Code ein, den wir dir gerade per E-Mail geschickt haben, um die Anmeldung abzuschließen. Wenn du es nicht warst, ignoriere es: Dein Konto ist sicher.",
    errors: {
      invalid_code: "Dieser Code stimmt nicht. Prüfe ihn und versuche es noch einmal.",
      expired: "Dieser Code ist abgelaufen. Fordere unten einen neuen an.",
      too_many_attempts: "Zu viele falsche Versuche. Fordere unten einen neuen Code an.",
      not_found: "Dieser Bestätigungslink ist nicht mehr gültig. Fordere unten einen neuen Code an.",
      rate_limited: "Zu viele Versuche. Warte kurz und versuche es noch einmal.",
    },
    submit: "Bestätigen und anmelden",
    cancel: "Abbrechen und zurück",
  },
  signUp: {
    title: "Konto erstellen",
    intro:
      "Wähle einen Benutzernamen, gib deine E-Mail-Adresse und ein beliebiges Passwort ein und bestätige dein Konto mit einem Code, den wir dir per E-Mail oder SMS schicken, bevor du dich anmeldest.",
    appleDivider: "oder erstelle ein Konto mit Passwort",
    haveAccount: "Du hast schon ein Konto?",
    form: {
      oneFix: "Nur eine Sache muss noch korrigiert werden",
      fewFixes: "Einiges muss noch korrigiert werden",
      othersSaved: "Deine übrigen Angaben sind gespeichert.",
      username: "Benutzername",
      usernameTitle: "Nur Buchstaben, Ziffern und Unterstriche",
      usernamePlaceholder: "3–20 Buchstaben, Ziffern, _",
      email: "E-Mail-Adresse",
      emailPlaceholder,
      signInInstead: "Stattdessen anmelden",
      password: "Passwort",
      passwordPlaceholder: "Mindestens 8 Zeichen",
      birthDate: "Geburtsdatum",
      ageHint: "Du musst mindestens {age} Jahre alt sein, um YuKon3t zu nutzen.",
      verifyWith: "Verifizieren per",
      emailCode: "Code per E-Mail",
      emailCodeHint: "Wir senden einen 6-stelligen Code an die E-Mail-Adresse oben.",
      phoneNumber: "Telefonnummer",
      phoneHint: "Wir senden einen Code per SMS an diese Nummer.",
      editAll: "Alle Angaben bearbeiten",
      submit: "Konto erstellen",
      submitting: "Konto wird erstellt...",
      reasons: {
        username_required: "Wähle einen Benutzernamen.",
        username_length: "Benutzernamen sind zwischen {usernameMin} und {usernameMax} Zeichen lang.",
        username_characters:
          "Benutzernamen dürfen nur Buchstaben, Ziffern und Unterstriche enthalten ({usernameMin}–{usernameMax} Zeichen).",
        username_reserved: "Dieser Benutzername ist reserviert. Wähle einen anderen.",
        username_taken: "Dieser Benutzername ist schon vergeben. Probiere einen anderen.",
        email_required: "Gib deine E-Mail-Adresse ein.",
        email_invalid: "Diese E-Mail-Adresse sieht nicht gültig aus. Prüfe, ob sie richtig geschrieben ist.",
        email_taken: "Zu dieser E-Mail-Adresse gibt es schon ein Konto.",
        password_required: "Wähle ein Passwort.",
        password_too_short: "Das Passwort muss mindestens {passwordMin} Zeichen lang sein.",
        password_too_long: "Das Passwort darf höchstens {passwordMax} Zeichen lang sein.",
        birth_date_required: "Wähle Monat, Tag und Jahr deiner Geburt aus.",
        birth_date_underage: "Du musst mindestens {age} Jahre alt sein, um YuKon3t zu nutzen.",
        phone_required: "Gib deine Telefonnummer ein.",
        phone_invalid: phoneInvalid,
        phone_taken: "Diese Telefonnummer ist bereits für ein anderes Konto verifiziert.",
      },
      formErrors: {
        rate_limited: "Zu viele Versuche. Warte kurz und versuche es noch einmal.",
        captcha: captchaFailed,
        captcha_unavailable: captchaUnavailable,
        invalid: "Etwas ist schiefgelaufen. Versuche es noch einmal.",
      },
    },
  },
  verifyPhone: {
    expiredBody: "Dieser Link ist abgelaufen oder wurde auf einem anderen Gerät geöffnet.",
    title: "Verifiziere dein Telefon",
    intro: "Gib deine Telefonnummer ein und wir senden dir einen Code per SMS, um dein Konto zu bestätigen.",
    noText: "Kommt die SMS nicht an?",
    emailInstead: "Wir können dir den Code per E-Mail schicken.",
    useEmail: "Code per E-Mail nutzen",
    form: {
      errors: {
        invalid: phoneInvalid,
        invalid_code: "Dieser Code stimmt nicht. Prüfe ihn und versuche es noch einmal.",
        rate_limited: "Zu viele Versuche. Versuche es in einer Weile noch einmal.",
        not_configured: "Die Verifizierung per Telefon ist noch nicht verfügbar.",
        phone_taken: "Diese Nummer ist bereits für ein anderes Konto verifiziert.",
        send_failed: "Wir konnten den Code nicht senden. Versuche es gleich noch einmal.",
        no_session: "Dieser Link ist abgelaufen. Registriere dich erneut.",
        captcha: "Wir konnten die Sicherheitsprüfung nicht abschließen. Versuche es noch einmal.",
        captcha_unavailable: captchaUnavailable,
      },
      somethingWentWrong: "Etwas ist schiefgelaufen. Versuche es noch einmal.",
      confirmedTitle: "Telefon bestätigt",
      confirmedBody: "Dein Konto ist verifiziert. Du kannst dich jetzt anmelden.",
      signIn: "Anmelden",
      codeLabel: "Gib den Code ein, den wir dir geschickt haben",
      verify: "Verifizieren",
      resendCode: "Code erneut senden",
      phoneLabel: "Telefonnummer",
      sendCode: "Code senden",
    },
  },
  verifyEmail: {
    confirmedTitle: "E-Mail-Adresse bestätigt",
    confirmedBody: "Deine E-Mail-Adresse ist verifiziert. Du kannst dich jetzt mit Benutzername und Passwort anmelden.",
    expiredBody:
      "Dieser Link ist abgelaufen oder wurde auf einem anderen Gerät geöffnet. Melde dich an und wir helfen dir, die Verifizierung deines Kontos abzuschließen.",
    title: "Bestätige deine E-Mail-Adresse",
    body: "Gib den 6-stelligen Code ein, den wir an {email} geschickt haben.",
    errors: {
      invalid_code: "Dieser Code stimmt nicht. Prüfe ihn und versuche es noch einmal.",
      expired: "Dieser Code ist abgelaufen. Wir haben dir einen neuen geschickt.",
      too_many_attempts: "Zu viele falsche Versuche. Wir haben dir einen neuen Code geschickt.",
      rate_limited: "Zu viele Versuche. Warte kurz und versuche es noch einmal.",
      invalid_phone: phoneInvalid,
      phone_taken: "Diese Telefonnummer ist bereits für ein anderes Konto verifiziert.",
      send_failed: "Wir konnten den Code gerade nicht senden. Wenn er nicht innerhalb einer Minute ankommt, tippe auf „Code erneut senden“ oder verifiziere mit deinem Telefon.",
    },
    submit: "E-Mail-Adresse bestätigen",
    slowTitle: "Dauert die E-Mail zu lange?",
    slowBody: "Verifiziere mit deiner Telefonnummer: Wir senden dir einen Code per SMS.",
    usePhone: "Telefon verwenden",
  },
  forgotPassword: {
    title: "Passwort zurücksetzen",
    intro: "Gib die E-Mail-Adresse deines Kontos ein und wir senden dir einen Link zum Zurücksetzen deines Passworts.",
    sent: "Wenn diese E-Mail-Adresse registriert ist, ist der Link zum Zurücksetzen schon unterwegs. Schau in dein Postfach.",
    expired: "Dieser Link ist abgelaufen oder wurde schon verwendet. Fordere unten einen neuen an.",
    submit: "Link senden",
    back: "Zurück zur Anmeldung",
  },
  resetPassword: {
    invalidTitle: "Ungültiger Link",
    invalidBody: "Diesem Link zum Zurücksetzen des Passworts fehlt das Token.",
    requestNew: "Neuen Link anfordern",
    title: "Neues Passwort wählen",
    errors: {
      invalid: "Das Passwort muss mindestens 8 Zeichen lang sein.",
      mismatch: "Die Passwörter stimmen nicht überein.",
      same_password: "Das ist dein bisheriges Passwort. Wähle zu deiner Sicherheit ein anderes.",
    },
    newLabel: "Neues Passwort",
    newPlaceholder: "Neues Passwort (mind. 8 Zeichen)",
    confirm: "Neues Passwort wiederholen",
    submit: "Passwort zurücksetzen",
    submitting: "Wird zurückgesetzt...",
  },
  onboarding: {
    title: "Richte dein Profil ein",
    intro:
      "Das sehen die anderen Mitglieder. Sei ehrlich darüber, wonach du suchst: So funktioniert die Community für alle.",
    required:
      "Alle Felder sind Pflicht, außer der Bio, die optional ist. Dein Konto wird erst erstellt, wenn du den Rest ausgefüllt hast.",
    errors: {
      invalid: "Fülle alle Pflichtfelder aus.",
      moderation: "Dein Name oder deine Bio entspricht nicht unseren Inhaltsrichtlinien. Bitte ändere sie.",
      underage: "Du musst mindestens {age} Jahre alt sein, um YuKon3t zu nutzen.",
    },
    name: "Anzeigename",
    bio: "Bio",
    optional: "(optional)",
    birthDate: "Geburtsdatum",
    ageHint: "Du musst mindestens {age} Jahre alt sein, um YuKon3t zu nutzen.",
    country: "Land",
    countryPlaceholder: "Wähle dein Land...",
    languages: "Sprachen",
    languagesHint: "Wähle mindestens eine Sprache, die du sprichst.",
    languagesPlaceholder: "Sprachen suchen...",
    interests: "Interessen",
    interestsHint: "Wähle mindestens eines: So schlagen wir dir Circles und Kontakte vor.",
    interestsPlaceholder: "Interessen suchen...",
    intentsLabel: "Wonach suchst du hier?",
    intentsHint: "Wähle mindestens eine Option.",
    intents: {
      FRIENDSHIP: "Freundschaft",
      CULTURAL_EXCHANGE: "Kulturaustausch",
      PROFESSIONAL: "Beruflich",
      COMMUNITY: "Community",
      TRAVEL_TIPS: "Reisetipps",
    },
    submit: "Weiter",
    submitting: "Wird gespeichert...",
  },
  emails: {
    verificationCode: {
      subject: "Dein YuKon3t-Bestätigungscode",
      intro: "Dein YuKon3t-Bestätigungscode lautet:",
      outro: "Dieser Code läuft in 10 Minuten ab. Wenn du ihn nicht angefordert hast, ignoriere diese E-Mail.",
    },
    passwordReset: {
      subject: "Setze dein YuKon3t-Passwort zurück",
      requested: {
        intro: "Jemand hat angefordert, das Passwort dieses YuKon3t-Kontos zurückzusetzen.",
        link: "Passwort zurücksetzen",
        outro: "Dieser Link läuft in 1 Stunde ab. Wenn du ihn nicht angefordert hast, ignoriere diese E-Mail: Dein Passwort ändert sich nicht.",
      },
      required: {
        intro:
          "Zu deiner Sicherheit musst du für dieses YuKon3t-Konto ein neues Passwort festlegen. Wir bitten alle, als Sicherheitsmaßnahme ein neues Passwort zu wählen.",
        link: "Neues Passwort wählen",
        outro: "Dieser Link läuft in 1 Stunde ab. Dein bisheriges Passwort funktioniert zur Anmeldung nicht mehr.",
      },
    },
    magicLink: {
      subject: "Bei {host} anmelden",
      heading: "Bei {host} anmelden",
      button: "Anmelden",
      ignore: "Wenn du diese E-Mail nicht angefordert hast, kannst du sie einfach ignorieren.",
    },
    deviceChallenge: {
      subjects: {
        LOGIN: "Bestätige, dass du es bist: neue Anmeldung bei deinem YuKon3t-Konto",
        PASSWORD_CHANGE: "Bestätige, dass du es bist: Passwortänderung bei YuKon3t",
        POST: "Bestätige, dass du es bist: Beitrag auf YuKon3t von einem neuen Gerät",
        HIDDEN_PIN_RESET: "Dein YuKon3t-Sicherheitscode",
        ACCOUNT_DELETE: "Bestätige, dass du es bist: dein YuKon3t-Konto löschen",
        DATA_EXPORT: "Bestätige, dass du es bist: deine YuKon3t-Daten herunterladen",
      },
      intros: {
        LOGIN:
          "Jemand hat gerade versucht, sich von einem Gerät, das wir nicht erkennen ({device}), bei deinem YuKon3t-Konto anzumelden.",
        PASSWORD_CHANGE:
          "Jemand hat gerade versucht, das Passwort deines YuKon3t-Kontos von einem Gerät, das wir nicht erkennen ({device}), zu ändern.",
        POST: "Jemand hat gerade versucht, von deinem YuKon3t-Konto aus mit einem Gerät, das wir nicht erkennen ({device}), zu posten.",
        ACCOUNT_DELETE: "Jemand, der bei deinem YuKon3t-Konto angemeldet ist, hat gerade beantragt, es dauerhaft zu löschen ({device}).",
        DATA_EXPORT: "Jemand, der bei deinem YuKon3t-Konto angemeldet ist, hat gerade beantragt, eine Kopie aller Daten herunterzuladen ({device}).",
      },
      ifYou: "Wenn du es warst, gib diesen Code ein, um fortzufahren:",
      outro:
        "Dieser Code läuft in 10 Minuten ab. Wenn du es nicht warst, teile diesen Code mit niemandem und ändere so schnell wie möglich dein Passwort in den Einstellungen.",
      hiddenPinReset: {
        intro: "Gib diesen Code in YuKon3t ein, um fortzufahren:",
        outro: "Dieser Code läuft in 10 Minuten ab. Wenn du ihn nicht angefordert hast, teile ihn mit niemandem.",
      },
    },
  },
};
