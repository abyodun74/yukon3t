// Natural modern Hindi (Devanagari), polite "आप" register. Product names (YuKon3t, Circles, Collab Boards, Muse) stay in Latin.
// Under /messages the people someone is connected with are "कॉन्टैक्ट" (a request is a "कॉन्टैक्ट रिक्वेस्ट"),
// because "कनेक्शन" already means the network connection. A story is "स्टोरी", a post "पोस्ट", a live
// stream "लाइव स्ट्रीम". A screen is referred to by the label the nav gives it ("डिस्कवर", "सेटिंग्स"), even
// while the screen itself is still English. A state of the reader is worded without a gendered form.

export const captchaFailed =
  "सुरक्षा जाँच पूरी नहीं हुई। «खुद को इंसान साबित करें» पर फिर से टैप करें और आगे बढ़ने से पहले उसके पूरा होने का इंतज़ार करें। धीमे कनेक्शन पर इसमें एक मिनट तक लग सकता है।";
export const captchaUnavailable =
  "हमारी सुरक्षा जाँच सेवा अभी जवाब नहीं दे रही, इसलिए हम आगे नहीं बढ़ सकते। यह आपके फ़ोन या कनेक्शन की समस्या नहीं है। कृपया कुछ मिनट बाद फिर कोशिश करें।";
export const phoneInvalid = "यह नंबर चुने गए देश के लिए मान्य नहीं है। देश और अंक जाँच लें।";
export const emailPlaceholder = "aap@udaharan.com";

export const serverUnreachable = "सर्वर से कनेक्ट नहीं हो सका। अपना कनेक्शन जाँचें और फिर कोशिश करें।";
export const newVersionAvailable = "ऐप का नया वर्ज़न उपलब्ध है। आगे बढ़ने के लिए पेज रीफ़्रेश करें।";
// Also under messages.controls: the screens under /messages render these two controls as well.
export const passwordInput = { show: "पासवर्ड दिखाएँ", hide: "पासवर्ड छिपाएँ" };
export const multiSelect = {
  placeholder: "खोजें और चुनें...",
  noMatches: "कोई नतीजा नहीं",
  remove: "{label} हटाएँ",
  selected: "{count}/{max} चुने गए",
};
