import type { accountEn } from "@/lib/i18n/en/account";
import { captchaFailed, captchaUnavailable, phoneInvalid, emailPlaceholder } from "@/lib/i18n/sw/common";

export const account: typeof accountEn = {
  languagePicker: { label: "Lugha" },
  landing: {
    eyebrow: "Mawasiliano ya kimataifa, kwa uaminifu",
    title: "Wasiliana na watu kutoka kote duniani: kwa mapendeleo, kwa utamaduni, kwa kusudi.",
    intro:
      "YuKon3t inatokana na wazo moja: programu zote kubwa za kuwasiliana na watu zina tatizo la uaminifu. Tumetatua matatizo yanayojitokeza tena na tena kwenye maoni ya watumiaji halisi: wasifu bandia, usimamizi usio wazi, na usalama kwa wanaolipa tu.",
    createAccount: "Mara ya kwanza? Fungua akaunti yako bure",
    guidelines: "Soma kanuni zetu",
    pillars: [
      {
        title: "Akaunti zinathibitishwa kabla ya ujumbe wowote",
        body: "Kila akaunti huthibitisha barua pepe au nambari ya simu kabla ujumbe wa moja kwa moja haujaruhusiwa, na kila hatua inayochukuliwa dhidi ya akaunti hutoa sababu na njia ya kukata rufaa: hakuna kufukuzwa kimyakimya.",
      },
      {
        title: "Sema unachotafuta hapa",
        body: "Weka nia yako (urafiki, kubadilishana tamaduni, mawasiliano ya kikazi, jumuiya au vidokezo vya safari) ili mazungumzo yasipotee kuelekea kitu ambacho hukuja kukitafuta.",
      },
      {
        title: "Circles bure, bila kumtoza mwandalizi",
        body: "Unda jumuiya zinazojengwa kuzunguka mapendeleo na utambulisho, au ujiunge nazo, bure. Hakuna ada za kila mwaka kwa waandalizi.",
      },
      {
        title: "Data yako ni yako daima",
        body: "Hamisha akaunti yako au uifute kabisa kwa kubofya mara moja, daima bure. Hutalazimika kulipia hilo kamwe.",
      },
    ],
    waysTitle: "Njia mbili za kuwasiliana",
    circles: {
      title: "Circles",
      body: "Jumuiya zinazojengwa kuzunguka mapendeleo na utambulisho: vipendwa, harakati, tamaduni. Kuunda na kujiunga ni bure.",
    },
    collabBoards: {
      title: "Collab Boards",
      body: "Kubadilishana ujuzi kati ya nchi, kujitolea, vikundi vya kujisomea na miradi: aina ya mawasiliano ambayo programu nyingi za kimataifa huipuuza.",
    },
    // Use-case blocks under the pillars: what the app actually does, in words people search for. Each claim is
    // checked against the FAQ (verification, Stories, Muse, Circles, live stage, shopping lists, reminders, languages).
    features: {
      heading: "Unachoweza kufanya kwenye YuKon3t",
      intro:
        "Kaa karibu na marafiki na familia walio ng'ambo ya mipaka, na ukutane na watu wanaoshiriki mapendeleo yako, lugha yako au utamaduni wako.",
      items: [
        {
          title: "Marafiki wa tamaduni nyingine na wa diaspora",
          body: "Tafuta watu kwa nchi, lugha au mapendeleo, na useme uko hapa kwa ajili ya nini: urafiki, kubadilishana tamaduni, jumuiya, mawasiliano ya kikazi au vidokezo vya safari.",
        },
        {
          title: "Story ambazo marafiki wanaweza kupenda kwa moyo",
          body: "Shiriki picha na video zinazopotea baada ya saa 24. Marafiki wanaweza kujibu au kugusa moyo, na ni wewe tu unayeona waliopenda Story yako.",
        },
        {
          title: "Video fupi za Muse",
          body: "Mlisho wa skrini nzima wa video fupi, za kuchekesha na za ubunifu ambazo kila mtu kwenye YuKon3t anaweza kutazama, kupenda na kutolea maoni.",
        },
        {
          title: "Circles za faragha na Collab Boards",
          body: "Anzisha Circle bila malipo kwa ajili ya burudani, harakati au utamaduni, na uifanye ya mwaliko tu ukipenda. Collab Boards huwaleta pamoja watu wa nchi mbalimbali kwa kubadilishana ujuzi, vikundi vya kusoma na miradi.",
        },
        {
          title: "Mubashara na hadi wageni 10",
          body: "Tangaza mubashara, alika hadi watu 10 jukwaani pamoja nawe, na uchague nani anaweza kutazama, hata watu uliowachagua tu.",
        },
        {
          title: "Orodha za ununuzi za pamoja kwenye gumzo",
          body: "Tuma orodha ya ununuzi kwenye gumzo: kila mtu ndani yake anaweza kuweka alama kwenye bidhaa, kuongeza zaidi na kuona mabadiliko papo hapo. Simu za sauti na video zipo hapo pia.",
        },
        {
          title: "Vikumbusho vya siku za kuzaliwa na sikukuu",
          body: "Pata kikumbusho kwenye siku za kuzaliwa ambazo marafiki zako wanachagua kushiriki, na taarifa kwenye sikukuu za umma za nchi yako, ambayo unaweza kuzima kwenye Mipangilio.",
        },
        {
          title: "Lugha tisa, jumuiya moja",
          body: "Tumia YuKon3t kwa Kiingereza, Kihispania, Kifaransa, Kireno, Kiarabu, Kijerumani, Kiitaliano, Kihindi au Kiswahili, na ubadilishe lugha wakati wowote.",
        },
      ],
    },
  },
  // Search results and link previews (src/lib/seo.ts): title at most 60 characters, description 140 to 160.
  seo: {
    landing: {
      title: "YuKon3t: marafiki wa tamaduni zote, Circles na mubashara",
      description:
        "Marafiki wa tamaduni nyingine na diaspora: Story, video za Muse, Circles za faragha, mubashara na hadi wageni 10. Akaunti huthibitishwa kwa barua pepe au simu.",
    },
    faq: {
      title: "Maswali ya YuKon3t: uthibitishaji, Circles na mubashara",
      description:
        "YuKon3t kwa ufupi: uthibitishaji kwa barua pepe au simu, Circles za faragha, Collab Boards, Story, video za Muse, mubashara, simu, siku za kuzaliwa na faragha.",
    },
  },
  common: {
    signIn: "Ingia",
    captchaFailed,
    captchaUnavailable,
    somethingWentWrong: "Kuna hitilafu. Jaribu tena.",
    invalidEmail: "Weka barua pepe sahihi.",
    emailLabel: "Barua pepe",
    emailPlaceholder,
    codeLabel: "Msimbo wa uthibitisho",
    phoneLabel: "Nambari ya simu",
    newCodeSent: "Tumekutumia msimbo mpya.",
    resendCode: "Tuma msimbo tena",
    resending: "Inatuma tena...",
    confirming: "Inathibitisha...",
    switching: "Inabadilisha...",
    sending: "Inatuma...",
    nothingToVerify: "Hakuna cha kuthibitisha hapa",
    alreadyVerified: "Tayari imethibitishwa",
  },
  apple: { signIn: "Ingia kwa Apple", redirecting: "Inakuelekeza..." },
  signIn: {
    title: "Ingia kwenye YuKon3t",
    passwordHeading: "Jina la mtumiaji na nenosiri",
    resetDone: "Nenosiri limewekwa upya. Ingia kwa nenosiri lako jipya.",
    resetRequired:
      "Kwa usalama wako, lazima uunde nenosiri jipya. Tumetuma kiungo cha kuliweka upya kwenye barua pepe ya akaunti yako.",
    errors: {
      invalid_credentials: "Jina la mtumiaji/barua pepe au nenosiri si sahihi.",
      rate_limited: "Majaribio mengi mno. Subiri dakika chache kisha ujaribu tena.",
    },
    identifier: "Jina la mtumiaji au barua pepe",
    password: "Nenosiri",
    submit: "Ingia",
    submitting: "Inaingia...",
    forgotPassword: "Umesahau nenosiri?",
    noPasswordHint:
      "Ulijisajili kwa kiungo cha barua pepe, Google au Apple, au huwezi kukumbuka nenosiri lako? Chagua «Umesahau nenosiri?» ili uunde jipya, au ingia kwa kiungo cha barua pepe kilicho chini.",
    or: "au",
    magicHeading: "Kiungo cha barua pepe",
    magicIntro:
      "Bila manenosiri yanayovuja au kurudiwa: tunakutumia kiungo salama cha kuingia kwa barua pepe.",
    magicSubmit: "Tuma kiungo cha kuingia",
  },
  checkEmail: {
    title: "Angalia barua pepe yako",
    verifyBody:
      "Ikiwa kuna akaunti yenye barua pepe hiyo inayosubiri uthibitisho, tumeitumia msimbo wa tarakimu 6. Unaisha muda baada ya dakika 10.",
    linkBody: "Tumekutumia kiungo salama cha kuingia. Kinaisha muda hivi karibuni, kwa hiyo kitumie haraka.",
    enterCode: "Weka msimbo",
    closeTab: "Unaweza kufunga kichupo hiki.",
  },
  verifyDevice: {
    expiredBody: "Kiungo hiki kimeisha muda au kilifunguliwa kwenye kifaa kingine. Ingia tena ili uendelee.",
    title: "Hatukitambui kifaa hiki",
    body: "Kwa usalama wako, weka msimbo wa tarakimu 6 tuliokutumia sasa hivi kwa barua pepe ili ukamilishe kuingia. Kama si wewe, usijali: akaunti yako iko salama.",
    errors: {
      invalid_code: "Msimbo huo hauendani. Uangalie kisha ujaribu tena.",
      expired: "Msimbo huo umeisha muda. Omba mpya hapa chini.",
      too_many_attempts: "Majaribio mengi mno yasiyo sahihi. Omba msimbo mpya hapa chini.",
      not_found: "Kiungo hicho cha uthibitisho si halali tena. Omba msimbo mpya hapa chini.",
      rate_limited: "Majaribio mengi mno. Subiri kidogo kisha ujaribu tena.",
    },
    submit: "Thibitisha na uingie",
    cancel: "Ghairi na urudi",
  },
  signUp: {
    title: "Fungua akaunti",
    intro:
      "Chagua jina la mtumiaji, weka barua pepe yako na nenosiri unalotaka, kisha uthibitishe akaunti yako kwa msimbo tutakaokutumia kwa barua pepe au SMS kabla ya kuingia.",
    appleDivider: "au fungua akaunti kwa nenosiri",
    haveAccount: "Tayari una akaunti?",
    form: {
      oneFix: "Kimebaki kitu kimoja tu cha kusahihisha",
      fewFixes: "Kuna vitu vichache vya kusahihisha",
      othersSaved: "Taarifa zako nyingine zimehifadhiwa.",
      username: "Jina la mtumiaji",
      usernameTitle: "Herufi, tarakimu na mstari wa chini tu",
      usernamePlaceholder: "Herufi, tarakimu, _ (3–20)",
      email: "Barua pepe",
      emailPlaceholder,
      signInInstead: "Ingia badala yake",
      password: "Nenosiri",
      passwordPlaceholder: "Angalau herufi 8",
      birthDate: "Tarehe ya kuzaliwa",
      ageHint: "Lazima uwe na angalau miaka {age} ili utumie YuKon3t.",
      verifyWith: "Thibitisha kwa",
      emailCode: "Msimbo wa barua pepe",
      emailCodeHint: "Tutatuma msimbo wa tarakimu 6 kwenye barua pepe iliyo juu.",
      phoneNumber: "Nambari ya simu",
      phoneHint: "Tutatuma msimbo kwa SMS kwenda nambari hii.",
      editAll: "Hariri taarifa zote",
      submit: "Fungua akaunti",
      submitting: "Inafungua akaunti...",
      reasons: {
        username_required: "Chagua jina la mtumiaji.",
        username_length: "Majina ya watumiaji yana herufi {usernameMin} hadi {usernameMax}.",
        username_characters:
          "Majina ya watumiaji yanaweza kuwa na herufi, tarakimu na mistari ya chini tu (herufi {usernameMin}–{usernameMax}).",
        username_reserved: "Jina hilo la mtumiaji limehifadhiwa. Chagua lingine.",
        username_taken: "Jina hilo la mtumiaji tayari linatumika. Jaribu lingine.",
        email_required: "Weka barua pepe yako.",
        email_invalid: "Barua pepe hiyo haionekani sahihi. Hakikisha imeandikwa vizuri.",
        email_taken: "Tayari kuna akaunti yenye barua pepe hiyo.",
        password_required: "Chagua nenosiri.",
        password_too_short: "Nenosiri lazima liwe na angalau herufi {passwordMin}.",
        password_too_long: "Nenosiri linaweza kuwa na herufi {passwordMax} kwa upeo.",
        birth_date_required: "Chagua mwezi, siku na mwaka uliozaliwa.",
        birth_date_underage: "Lazima uwe na angalau miaka {age} ili utumie YuKon3t.",
        phone_required: "Weka nambari yako ya simu.",
        phone_invalid: phoneInvalid,
        phone_taken: "Nambari hiyo ya simu tayari imethibitishwa kwenye akaunti nyingine.",
      },
      formErrors: {
        rate_limited: "Majaribio mengi mno. Subiri kidogo kisha ujaribu tena.",
        captcha: captchaFailed,
        captcha_unavailable: captchaUnavailable,
        invalid: "Kuna hitilafu. Jaribu tena.",
      },
    },
  },
  verifyPhone: {
    expiredBody: "Kiungo hiki kimeisha muda au kilifunguliwa kwenye kifaa kingine.",
    title: "Thibitisha simu yako",
    intro: "Weka nambari yako ya simu nasi tutakutumia msimbo kwa SMS ili kuthibitisha akaunti yako.",
    noText: "SMS haikufikii?",
    emailInstead: "Tunaweza kukutumia msimbo kwa barua pepe.",
    useEmail: "Tumia msimbo wa barua pepe",
    form: {
      errors: {
        invalid: phoneInvalid,
        invalid_code: "Msimbo huo hauendani. Uangalie kisha ujaribu tena.",
        rate_limited: "Majaribio mengi mno. Jaribu tena baada ya muda.",
        not_configured: "Uthibitisho wa simu bado haupatikani.",
        phone_taken: "Nambari hiyo tayari imethibitishwa kwenye akaunti nyingine.",
        send_failed: "Hatukuweza kutuma msimbo. Jaribu tena baada ya muda mfupi.",
        no_session: "Kiungo hiki kimeisha muda. Jisajili tena.",
        captcha: "Hatukuweza kukamilisha ukaguzi wa usalama. Jaribu tena.",
        captcha_unavailable: captchaUnavailable,
      },
      somethingWentWrong: "Kuna hitilafu. Jaribu tena.",
      confirmedTitle: "Simu imethibitishwa",
      confirmedBody: "Akaunti yako imethibitishwa. Sasa unaweza kuingia.",
      signIn: "Ingia",
      codeLabel: "Weka msimbo tuliokutumia",
      verify: "Thibitisha",
      resendCode: "Tuma msimbo tena",
      phoneLabel: "Nambari ya simu",
      sendCode: "Tuma msimbo",
    },
  },
  verifyEmail: {
    confirmedTitle: "Barua pepe imethibitishwa",
    confirmedBody: "Barua pepe yako imethibitishwa. Sasa unaweza kuingia kwa jina lako la mtumiaji na nenosiri.",
    expiredBody:
      "Kiungo hiki kimeisha muda au kilifunguliwa kwenye kifaa kingine. Ingia nasi tutakusaidia kukamilisha kuthibitisha akaunti yako.",
    title: "Thibitisha barua pepe yako",
    body: "Weka msimbo wa tarakimu 6 tuliotuma kwa {email}.",
    errors: {
      invalid_code: "Msimbo huo hauendani. Uangalie kisha ujaribu tena.",
      expired: "Msimbo huo umeisha muda. Tumekutumia mpya.",
      too_many_attempts: "Majaribio mengi mno yasiyo sahihi. Tumekutumia msimbo mpya.",
      rate_limited: "Majaribio mengi mno. Subiri kidogo kisha ujaribu tena.",
      invalid_phone: phoneInvalid,
      phone_taken: "Nambari hiyo ya simu tayari imethibitishwa kwenye akaunti nyingine.",
      send_failed: "Hatukuweza kutuma msimbo kwa sasa. Usipofika ndani ya dakika moja, gusa «Tuma msimbo tena» au uthibitishe kwa simu yako.",
    },
    submit: "Thibitisha barua pepe",
    slowTitle: "Barua pepe inachelewa?",
    slowBody: "Thibitisha kwa nambari yako ya simu: tutakutumia msimbo kwa SMS.",
    usePhone: "Tumia simu",
  },
  forgotPassword: {
    title: "Weka upya nenosiri lako",
    intro: "Weka barua pepe ya akaunti yako nasi tutakutumia kiungo cha kuweka upya nenosiri lako.",
    sent: "Ikiwa barua pepe hiyo imesajiliwa, kiungo cha kuliweka upya kiko njiani. Angalia kikasha chako.",
    expired: "Kiungo hicho kimeisha muda au kimeshatumika. Omba kipya hapa chini.",
    submit: "Tuma kiungo",
    back: "Rudi kwenye kuingia",
  },
  resetPassword: {
    invalidTitle: "Kiungo si halali",
    invalidBody: "Kiungo hiki cha kuweka upya nenosiri hakina tokeni.",
    requestNew: "Omba kiungo kipya",
    title: "Chagua nenosiri jipya",
    errors: {
      invalid: "Nenosiri lazima liwe na angalau herufi 8.",
      mismatch: "Manenosiri hayalingani.",
      same_password: "Hilo ni nenosiri lako la awali. Kwa usalama wako, chagua tofauti.",
    },
    newLabel: "Nenosiri jipya",
    newPlaceholder: "Nenosiri jipya (angalau herufi 8)",
    confirm: "Rudia nenosiri jipya",
    submit: "Weka upya nenosiri",
    submitting: "Inaliweka upya...",
  },
  onboarding: {
    title: "Weka wasifu wako",
    intro:
      "Haya ndiyo wanachama wengine wanayoyaona. Kuwa mkweli kuhusu unachotafuta: hivyo jumuiya inafanya kazi kwa kila mtu.",
    required:
      "Sehemu zote ni za lazima isipokuwa Wasifu mfupi, ambao si wa lazima. Akaunti yako haitaundwa hadi ukamilishe zilizobaki.",
    errors: {
      invalid: "Jaza sehemu zote za lazima.",
      moderation: "Jina lako au wasifu wako mfupi havifuati kanuni zetu za maudhui. Vibadilishe.",
      underage: "Lazima uwe na angalau miaka {age} ili utumie YuKon3t.",
    },
    name: "Jina linaloonekana",
    bio: "Wasifu mfupi",
    optional: "(si lazima)",
    birthDate: "Tarehe ya kuzaliwa",
    ageHint: "Lazima uwe na angalau miaka {age} ili utumie YuKon3t.",
    country: "Nchi",
    countryPlaceholder: "Chagua nchi yako...",
    languages: "Lugha",
    languagesHint: "Chagua angalau lugha moja unayozungumza.",
    languagesPlaceholder: "Tafuta lugha...",
    interests: "Mapendeleo",
    interestsHint: "Chagua angalau moja: hivyo tunakupendekezea Circles na watu wa kuwasiliana nao.",
    interestsPlaceholder: "Tafuta mapendeleo...",
    intentsLabel: "Unatafuta nini hapa?",
    intentsHint: "Chagua angalau chaguo moja.",
    intents: {
      FRIENDSHIP: "Urafiki",
      CULTURAL_EXCHANGE: "Kubadilishana tamaduni",
      PROFESSIONAL: "Kikazi",
      COMMUNITY: "Jumuiya",
      TRAVEL_TIPS: "Vidokezo vya safari",
    },
    submit: "Endelea",
    submitting: "Inahifadhi...",
  },
  emails: {
    verificationCode: {
      subject: "Msimbo wako wa uthibitisho wa YuKon3t",
      intro: "Msimbo wako wa uthibitisho wa YuKon3t ni:",
      outro: "Msimbo huu unaisha muda baada ya dakika 10. Ikiwa hukuuomba, puuza barua pepe hii.",
    },
    passwordReset: {
      subject: "Weka upya nenosiri lako la YuKon3t",
      requested: {
        intro: "Mtu fulani aliomba kuweka upya nenosiri la akaunti hii ya YuKon3t.",
        link: "Weka upya nenosiri lako",
        outro: "Kiungo hiki kinaisha muda baada ya saa 1. Ikiwa hukukiomba, puuza barua pepe hii: nenosiri lako halitabadilika.",
      },
      required: {
        intro:
          "Kwa usalama wako, lazima uunde nenosiri jipya la akaunti hii ya YuKon3t. Tunamwomba kila mtu achague nenosiri jipya kama hatua ya usalama.",
        link: "Chagua nenosiri jipya",
        outro: "Kiungo hiki kinaisha muda baada ya saa 1. Nenosiri lako la awali halifanyi kazi tena kuingia.",
      },
    },
    magicLink: {
      subject: "Ingia kwenye {host}",
      heading: "Ingia kwenye {host}",
      button: "Ingia",
      ignore: "Ikiwa hukuomba barua pepe hii, unaweza kuipuuza bila wasiwasi.",
    },
    deviceChallenge: {
      subjects: {
        LOGIN: "Thibitisha kuwa ni wewe: kuingia mpya kwenye akaunti yako ya YuKon3t",
        PASSWORD_CHANGE: "Thibitisha kuwa ni wewe: kubadilisha nenosiri kwenye YuKon3t",
        POST: "Thibitisha kuwa ni wewe: kuchapisha kwenye YuKon3t kutoka kifaa kipya",
        HIDDEN_PIN_RESET: "Msimbo wako wa usalama wa YuKon3t",
        ACCOUNT_DELETE: "Thibitisha kuwa ni wewe: kufuta akaunti yako ya YuKon3t",
        DATA_EXPORT: "Thibitisha kuwa ni wewe: kupakua data yako ya YuKon3t",
      },
      intros: {
        LOGIN:
          "Mtu fulani amejaribu sasa hivi kuingia kwenye akaunti yako ya YuKon3t kutoka kifaa tusichokitambua ({device}).",
        PASSWORD_CHANGE:
          "Mtu fulani amejaribu sasa hivi kubadilisha nenosiri la akaunti yako ya YuKon3t kutoka kifaa tusichokitambua ({device}).",
        POST: "Mtu fulani amejaribu sasa hivi kuchapisha kutoka kwenye akaunti yako ya YuKon3t kwa kifaa tusichokitambua ({device}).",
        ACCOUNT_DELETE: "Mtu aliyeingia kwenye akaunti yako ya YuKon3t ameomba sasa hivi kuifuta kabisa ({device}).",
        DATA_EXPORT: "Mtu aliyeingia kwenye akaunti yako ya YuKon3t ameomba sasa hivi kupakua nakala ya data yake yote ({device}).",
      },
      ifYou: "Ikiwa ni wewe, weka msimbo huu ili uendelee:",
      outro:
        "Msimbo huu unaisha muda baada ya dakika 10. Ikiwa si wewe, usimshirikishe mtu yeyote msimbo huu na ubadilishe nenosiri lako kutoka Mipangilio mapema iwezekanavyo.",
      hiddenPinReset: {
        intro: "Weka msimbo huu kwenye YuKon3t ili uendelee:",
        outro: "Msimbo huu unaisha muda baada ya dakika 10. Ikiwa hukuuomba, usimshirikishe mtu yeyote.",
      },
    },
  },
};
