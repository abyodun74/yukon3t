import type { advertiseEn } from "@/lib/i18n/en/advertise";
import { captchaUnavailable, serverUnreachable } from "@/lib/i18n/sw/common";
import { shared } from "@/lib/i18n/sw/shared";

export const advertise: typeof advertiseEn = {
  page: {
    eyebrow: "Tangaza kwenye YuKon3t",
    title: "Fikisha biashara yako kwa hadhira ya kimataifa iliyothibitishwa.",
    intro:
      "Bei moja ya kudumu, bila kuhitaji akaunti na bila kuweka mipangilio ya kuchagua hadhira: tangazo lako huonyeshwa kwenye programu nzima kwa siku utakazochagua. Kila tangazo hukaguliwa kabla ya kuchapishwa, na bei ni {price} kwa siku.",
    canceled: "Malipo yalighairiwa na hakuna kiasi kilichokatwa. Unaweza kuliwasilisha tena wakati wowote.",
    notConfigured: "Kuweka nafasi za matangazo bado hakupatikani. Rudi hivi karibuni au tuandikie moja kwa moja.",
  },
  success: {
    eyebrow: "Malipo yamepokelewa",
    title: "Asante: tangazo lako limewekewa nafasi.",
    body: "Tutakagua tangazo lako hivi karibuni (kwa kawaida ndani ya siku moja ya kazi) kabla ya kulichapisha. Tukiwa na swali lolote, tutakuandikia kwenye barua pepe ya mawasiliano uliyotoa.",
    back: "Rudi kwenye YuKon3t",
  },
  form: {
    company: "Jina la kampuni",
    contactName: "Jina la mwasiliani",
    contactEmail: "Barua pepe ya mawasiliano",
    emailPlaceholder: "wewe@kampuni.com",
    emailHint: "Hapa ndipo utakapopokea risiti yako na hali ya ukaguzi.",
    headline: "Kichwa cha habari",
    headlinePlaceholder: "Unatangaza nini?",
    copy: "Maandishi ya tangazo",
    copyPlaceholder: "Sentensi moja au mbili zinazoeleza unachotoa.",
    link: "Anwani ya kiungo (URL)",
    linkPlaceholder: "https://kampuniyako.com",
    creative: "Picha au video ya tangazo",
    removeMedia: "Ondoa faili",
    addPhoto: "Ongeza picha",
    addVideo: "Ongeza video",
    uploadFromDevice: "Pakia kutoka kwenye kifaa",
    takePhoto: "Piga picha",
    duration: "Muda",
    days: "one: Siku # | other: Siku #",
    total: "Jumla",
    preparing: "Inaandaa malipo...",
    continue: "Endelea kwenye malipo: {price}",
    stripeNote:
      "Utalipa kwa usalama kupitia Stripe. Matangazo huchapishwa baada ya ukaguzi mfupi, kwa kawaida ndani ya siku moja ya kazi.",
    oneTime:
      "one: Malipo ya mara moja kwa siku #. Hayajirudii wala kujifanya upya kiotomatiki. Ili kuendesha kampeni nyingine baadaye, unahitaji nafasi mpya na malipo tofauti. | other: Malipo ya mara moja kwa siku #. Hayajirudii wala kujifanya upya kiotomatiki. Ili kuendesha kampeni nyingine baadaye, unahitaji nafasi mpya na malipo tofauti.",
    // The bot check's own button and status lines (TurnstileWidget), the same sentences as the account screens.
    turnstile: shared.turnstile,
    errors: {
      too_large: "Faili hiyo ni kubwa mno.",
      moderation: "Tangazo hilo halifuati kanuni zetu za maudhui.",
      rate_limited: "Majaribio mengi mno. Jaribu tena baada ya muda mfupi.",
      not_configured: "Kuweka nafasi za matangazo bado hakupatikani. Rudi hivi karibuni.",
      payment_setup_failed: "Hatukuweza kuanzisha malipo. Jaribu tena.",
      invalid: "Angalia taarifa ulizoweka.",
      network: serverUnreachable,
      captcha: "Hatukuweza kukamilisha ukaguzi wa usalama. Subiri kidogo kisha ujaribu tena.",
      captcha_unavailable: captchaUnavailable,
      other: "Hatukuweza kuwasilisha uwekaji nafasi. Jaribu tena.",
      imageType: "Tumia picha ya JPEG, PNG au WebP.",
      imageTooLarge: "Picha lazima ziwe MB 25 au chini.",
      videoType: "Tumia video ya MP4, MOV au WebM.",
      videoTooLarge: "Video lazima iwe MB 250 au chini.",
      videoTooLong: "one: Video lazima ziwe na muda wa sekunde # au chini. | other: Video lazima ziwe na muda wa sekunde # au chini.",
      details: "Jaza taarifa za kampuni yako na za mawasiliano.",
      adFields: "Jaza kichwa cha habari, maandishi na kiungo cha tangazo lako.",
      media: "Ongeza picha au video kwenye tangazo lako.",
    },
  },
};
