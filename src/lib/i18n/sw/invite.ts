import type { inviteEn } from "@/lib/i18n/en/invite";
import { phoneInvalid } from "@/lib/i18n/sw/common";
import { shared } from "@/lib/i18n/sw/shared";

// The contacts here are the phone's address book ("orodha ya anwani", "anwani za simu"), not the people someone is
// connected with on YuKon3t.
export const invite: typeof inviteEn = {
  controls: { phoneField: shared.phoneField, phoneInvalid },
  title: "Alika marafiki",
  intro: "Walete watu unaowajua kwenye YuKon3t.",
  message: "Jiunge nami kwenye YuKon3t na uungane na watu wa tamaduni, mapendeleo na nchi mbalimbali:",
  linkHeading: "Viungo vyako vya mwaliko",
  copy: "Nakili",
  copied: "Imenakiliwa!",
  copyFailed: "Imeshindwa kunakili",
  share: "Shiriki",
  shareFailed: "Imeshindwa kushiriki. Jaribu tena.",
  whatsApp: "WhatsApp",
  whatsAppLabel: "Alika kupitia WhatsApp",
  textHeading: "Alika kwa ujumbe mfupi au WhatsApp",
  textIntro:
    "Chagua watu kutoka kwenye anwani zako (inapowezekana) au weka nambari, kisha uwatumie kila mmoja ujumbe mfupi au wa WhatsApp wenye viungo vya App Store na Google Play.",
  openingContacts: "Inafungua anwani…",
  chooseContacts: "Chagua kutoka anwani",
  phoneLabel: "Nambari ya simu",
  add: "Ongeza",
  invite: "Alika",
  // Visible label of the contact row's sms: action (the WhatsApp one reuses `whatsApp`), then a one-line hint for Android's "open with" chooser.
  textButton: "SMS",
  textHint: "Simu yako ikikuuliza ifunguliwe na nini, chagua Ujumbe.",
  remove: "Ondoa",
  pickerTitle: "Chagua kutoka anwani",
  searchContacts: "Tafuta kwenye anwani",
  noMatches: "Hakuna anayelingana na utafutaji.",
  addSelected: "one: Ongeza # aliyechaguliwa | other: Ongeza # waliochaguliwa",
  selectToAdd: "Chagua wa kuongeza",
  phoneKinds: { mobile: "Simu ya mkononi", home: "Nyumbani", work: "Kazini", other: "Nyingine" },
  errors: {
    permission:
      "Ruhusa ya kufikia anwani ilikataliwa. Iwashe kwa YuKon3t kwenye mipangilio ya simu yako ili uweze kualika kutoka kwenye anwani zako.",
    noNumbers: "Hakuna mtu kwenye anwani zako mwenye nambari ya simu iliyohifadhiwa.",
    openFailed: "Hatukuweza kufungua anwani zako. Jaribu tena.",
    pickedNoNumbers: "Watu hao hawana nambari ya simu iliyohifadhiwa.",
  },
};
