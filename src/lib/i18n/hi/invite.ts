import type { inviteEn } from "@/lib/i18n/en/invite";
import { phoneInvalid } from "@/lib/i18n/hi/common";
import { shared } from "@/lib/i18n/hi/shared";

// The contacts here are the phone's address book ("फ़ोन के कॉन्टैक्ट"), not the people someone is
// connected with on YuKon3t.
export const invite: typeof inviteEn = {
  controls: { phoneField: shared.phoneField, phoneInvalid },
  title: "दोस्तों को आमंत्रित करें",
  intro: "अपने जानने वालों को YuKon3t पर लाएँ।",
  message: "मेरे साथ YuKon3t पर जुड़ें और अलग-अलग संस्कृतियों, रुचियों और देशों के लोगों से मिलें:",
  linkHeading: "आपके इनवाइट लिंक",
  copy: "कॉपी करें",
  copied: "कॉपी हो गया!",
  copyFailed: "कॉपी नहीं हो सका",
  share: "शेयर करें",
  shareFailed: "शेयर नहीं हो सका। फिर कोशिश करें।",
  whatsApp: "WhatsApp",
  whatsAppLabel: "WhatsApp से आमंत्रित करें",
  textHeading: "टेक्स्ट मैसेज या WhatsApp से आमंत्रित करें",
  textIntro:
    "अपने फ़ोन के कॉन्टैक्ट में से लोग चुनें (जहाँ संभव हो) या कोई नंबर डालें, और हर किसी को App Store और Google Play के लिंक के साथ टेक्स्ट या WhatsApp मैसेज भेजें।",
  openingContacts: "कॉन्टैक्ट खुल रहे हैं…",
  chooseContacts: "कॉन्टैक्ट से चुनें",
  phoneLabel: "फ़ोन नंबर",
  add: "जोड़ें",
  invite: "आमंत्रित करें",
  // Visible label of the contact row's sms: action (the WhatsApp one reuses `whatsApp`), then a one-line hint for Android's "open with" chooser.
  textButton: "SMS",
  textHint: "अगर आपका फ़ोन पूछे कि किससे खोलना है, तो मैसेज चुनें।",
  remove: "हटाएँ",
  pickerTitle: "कॉन्टैक्ट से चुनें",
  searchContacts: "कॉन्टैक्ट में खोजें",
  noMatches: "खोज से कोई मेल नहीं खाता।",
  addSelected: "one: चुने हुए # को जोड़ें | other: चुने हुए # को जोड़ें",
  selectToAdd: "जोड़ने के लिए लोग चुनें",
  phoneKinds: { mobile: "मोबाइल", home: "घर", work: "काम", other: "अन्य" },
  errors: {
    permission:
      "कॉन्टैक्ट की अनुमति नहीं मिली। अपने कॉन्टैक्ट से आमंत्रित करने के लिए अपने फ़ोन की सेटिंग्स में YuKon3t के लिए इसे चालू करें।",
    noNumbers: "आपके कॉन्टैक्ट में किसी का फ़ोन नंबर सेव नहीं है।",
    openFailed: "आपके कॉन्टैक्ट खोले नहीं जा सके। फिर कोशिश करें।",
    pickedNoNumbers: "उन लोगों का फ़ोन नंबर सेव नहीं है।",
  },
};
