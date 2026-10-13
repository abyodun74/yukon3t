import { phoneInvalid } from "@/lib/i18n/en/common";
import { sharedEn } from "@/lib/i18n/en/shared";

/**
 * Inviting friends: the /invite page and the invite panel, which Settings mounts too. InviteTextProvider (the
 * layouts of /invite and /settings) hands the panel the reader's language.
 */
export const inviteEn = {
  // The phone field the panel renders, and its own "not a valid number" message.
  controls: { phoneField: sharedEn.phoneField, phoneInvalid },
  title: "Invite friends",
  intro: "Bring people you know onto YuKon3t.",
  // What the invited person receives, followed by the sign-up link.
  message: "Join me on YuKon3t — connect across cultures, interests, and borders:",
  linkHeading: "Your invite link",
  copy: "Copy",
  copied: "Copied!",
  copyFailed: "Couldn't copy",
  share: "Share",
  textHeading: "Invite by text message",
  textIntro: "Pick contacts (where supported) or enter a number, then send each one a text with your invite link.",
  openingContacts: "Opening contacts…",
  chooseContacts: "Choose from contacts",
  phoneLabel: "Phone number",
  add: "Add",
  invite: "Invite",
  remove: "Remove",
  pickerTitle: "Choose contacts",
  searchContacts: "Search contacts",
  noMatches: "No matching contacts.",
  addSelected: "one: Add # selected | other: Add # selected",
  selectToAdd: "Select contacts to add",
  errors: {
    permission:
      "Contacts permission was denied — enable it for YuKon3t in your phone's Settings to invite from your contacts.",
    noNumbers: "None of your contacts have a phone number saved.",
    openFailed: "Couldn't open your contacts — please try again.",
    pickedNoNumbers: "Those contacts don't have a phone number saved.",
  },
};
