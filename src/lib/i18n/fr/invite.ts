import type { inviteEn } from "@/lib/i18n/en/invite";
import { phoneInvalid } from "@/lib/i18n/fr/common";
import { shared } from "@/lib/i18n/fr/shared";

// "Contacts" here are the phone's address book; the people someone is connected with on YuKon3t are "relations".
// The invitation itself is written to a friend, so it says "tu".
export const invite: typeof inviteEn = {
  controls: { phoneField: shared.phoneField, phoneInvalid },
  title: "Inviter des amis",
  intro: "Faites venir vos proches sur YuKon3t.",
  message: "Rejoins-moi sur YuKon3t pour créer des liens au-delà des cultures, des centres d'intérêt et des frontières :",
  linkHeading: "Votre lien d'invitation",
  copy: "Copier",
  copied: "Copié !",
  copyFailed: "Copie impossible",
  share: "Partager",
  textHeading: "Inviter par SMS",
  textIntro:
    "Choisissez des contacts (si votre appareil le permet) ou saisissez un numéro, puis envoyez à chacun un SMS contenant votre lien d'invitation.",
  openingContacts: "Ouverture des contacts…",
  chooseContacts: "Choisir parmi les contacts",
  phoneLabel: "Numéro de téléphone",
  add: "Ajouter",
  invite: "Inviter",
  remove: "Retirer",
  pickerTitle: "Choisir des contacts",
  searchContacts: "Rechercher dans les contacts",
  noMatches: "Aucun contact correspondant.",
  addSelected: "one: Ajouter # contact sélectionné | other: Ajouter # contacts sélectionnés",
  selectToAdd: "Sélectionnez des contacts à ajouter",
  errors: {
    permission:
      "L'accès aux contacts a été refusé. Autorisez-le pour YuKon3t dans les réglages de votre téléphone pour inviter depuis vos contacts.",
    noNumbers: "Aucun de vos contacts n'a de numéro de téléphone enregistré.",
    openFailed: "Impossible d'ouvrir vos contacts. Veuillez réessayer.",
    pickedNoNumbers: "Ces contacts n'ont pas de numéro de téléphone enregistré.",
  },
};
