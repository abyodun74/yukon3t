import type { advertiseEn } from "@/lib/i18n/en/advertise";
import { captchaUnavailable, serverUnreachable } from "@/lib/i18n/hi/common";
import { shared } from "@/lib/i18n/hi/shared";

export const advertise: typeof advertiseEn = {
  page: {
    eyebrow: "YuKon3t पर विज्ञापन दें",
    title: "अपने बिज़नेस को वैश्विक और वेरिफ़ाइड ऑडियंस तक पहुँचाएँ।",
    intro:
      "एक तय कीमत, अकाउंट की ज़रूरत नहीं और ऑडियंस टार्गेटिंग का कोई झंझट नहीं: आपका विज्ञापन आपके चुने हुए दिनों तक पूरे ऐप में दिखाया जाता है। हर विज्ञापन प्रकाशित होने से पहले रिव्यू किया जाता है, और कीमत {price} प्रति दिन है।",
    canceled: "भुगतान रद्द कर दिया गया और कोई चार्ज नहीं लगा। आप जब चाहें इसे दोबारा सबमिट कर सकते हैं।",
    notConfigured: "विज्ञापन बुकिंग अभी उपलब्ध नहीं है। जल्द ही फिर आएँ या हमें सीधे लिखें।",
  },
  success: {
    eyebrow: "भुगतान मिल गया",
    title: "धन्यवाद: आपका विज्ञापन बुक हो गया है।",
    body: "प्रकाशित करने से पहले हम जल्द ही आपके विज्ञापन का रिव्यू करेंगे (आम तौर पर एक कार्य दिवस में)। अगर हमारा कोई सवाल हुआ, तो हम आपके दिए संपर्क ईमेल पर लिखेंगे।",
    back: "YuKon3t पर वापस जाएँ",
  },
  form: {
    company: "कंपनी का नाम",
    contactName: "संपर्क का नाम",
    contactEmail: "संपर्क ईमेल",
    emailPlaceholder: "aap@company.com",
    emailHint: "आपको रसीद और रिव्यू की स्थिति यहीं मिलेगी।",
    headline: "शीर्षक",
    headlinePlaceholder: "आप किसका विज्ञापन दे रहे हैं?",
    copy: "विज्ञापन का टेक्स्ट",
    copyPlaceholder: "एक या दो वाक्य, जो बताएँ कि आप क्या पेश करते हैं।",
    link: "लिंक का URL",
    linkPlaceholder: "https://aapkikampani.com",
    creative: "विज्ञापन की इमेज या वीडियो",
    removeMedia: "फ़ाइल हटाएँ",
    addPhoto: "फ़ोटो जोड़ें",
    addVideo: "वीडियो जोड़ें",
    uploadFromDevice: "डिवाइस से अपलोड करें",
    takePhoto: "फ़ोटो लें",
    duration: "अवधि",
    days: "one: # दिन | other: # दिन",
    total: "कुल",
    preparing: "भुगतान तैयार हो रहा है...",
    continue: "भुगतान के लिए आगे बढ़ें: {price}",
    stripeNote:
      "आप Stripe से सुरक्षित रूप से भुगतान करेंगे। विज्ञापन एक त्वरित रिव्यू के बाद प्रकाशित होते हैं, आम तौर पर एक कार्य दिवस में।",
    oneTime:
      "one: # दिन के लिए एक बार का चार्ज। यह अपने आप रिन्यू या दोहराया नहीं जाता। बाद में कोई और कैंपेन चलाने के लिए आपको नई बुकिंग और अलग चार्ज की ज़रूरत होगी। | other: # दिनों के लिए एक बार का चार्ज। यह अपने आप रिन्यू या दोहराया नहीं जाता। बाद में कोई और कैंपेन चलाने के लिए आपको नई बुकिंग और अलग चार्ज की ज़रूरत होगी।",
    // The bot check's own button and status lines (TurnstileWidget), the same sentences as the account screens.
    turnstile: shared.turnstile,
    errors: {
      too_large: "वह फ़ाइल बहुत बड़ी है।",
      moderation: "यह विज्ञापन हमारी कंटेंट नीति के अनुसार नहीं है।",
      rate_limited: "बहुत ज़्यादा कोशिशें। थोड़ी देर में फिर कोशिश करें।",
      not_configured: "विज्ञापन बुकिंग अभी उपलब्ध नहीं है। जल्द ही फिर आएँ।",
      payment_setup_failed: "हम भुगतान शुरू नहीं कर सके। फिर कोशिश करें।",
      invalid: "आपने जो जानकारी भरी है, उसे जाँच लें।",
      network: serverUnreachable,
      captcha: "हम सुरक्षा जाँच पूरी नहीं कर सके। थोड़ा रुकें और फिर कोशिश करें।",
      captcha_unavailable: captchaUnavailable,
      other: "हम बुकिंग सबमिट नहीं कर सके। फिर कोशिश करें।",
      imageType: "JPEG, PNG या WebP इमेज इस्तेमाल करें।",
      imageTooLarge: "इमेज 25 MB या उससे कम की होनी चाहिए।",
      videoType: "MP4, MOV या WebM वीडियो इस्तेमाल करें।",
      videoTooLarge: "वीडियो 250 MB या उससे कम का होना चाहिए।",
      videoTooLong: "one: वीडियो # सेकंड या उससे छोटे होने चाहिए। | other: वीडियो # सेकंड या उससे छोटे होने चाहिए।",
      details: "अपनी कंपनी और संपर्क की जानकारी पूरी करें।",
      adFields: "अपने विज्ञापन का शीर्षक, टेक्स्ट और लिंक भरें।",
      media: "अपने विज्ञापन में फ़ोटो या वीडियो जोड़ें।",
    },
  },
};
