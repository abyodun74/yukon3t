import type { FaqContent } from "../ids";
import { hi1 } from "./hi-1";
import { hi2 } from "./hi-2";
import { hi3 } from "./hi-3";
import { hi4 } from "./hi-4";
import { hi5 } from "./hi-5";

// The FAQ in Hindi. Same conventions as src/lib/i18n/hi. Every answer says what its English says in ../page.tsx,
// no more and no less: these are factual, privacy and safety claims, so a change there is a change here.
export const hi: FaqContent = {
  heading: "अक्सर पूछे जाने वाले सवाल",
  intro:
    "YuKon3t में अपना रास्ता खोजने के लिए आपको जो कुछ चाहिए, सब यहाँ है। यहाँ जवाब नहीं मिला? किसी भी मॉडरेशन ईमेल का जवाब दें, या संबंधित पेज पर रिपोर्ट करने के विकल्प से हमें लिखें।",
  sections: {
    "getting-around": "शुरुआती जानकारी",
    "android-app": "Android ऐप",
    "posts-media": "पोस्ट और मीडिया",
    "going-live": "लाइव स्ट्रीम",
    stories: "स्टोरी",
    muse: "Muse",
    ambient: "Ambient",
    "connecting-messaging-calls": "कॉन्टैक्ट्स, मैसेज और कॉल",
    "hidden-chats": "छिपी हुई चैट",
    "circles-collab-boards": "Circles और Collab Boards",
    gifts: "गिफ़्ट और चैलेंज",
    advertising: "विज्ञापन",
    "inviting-friends": "दोस्तों को इनवाइट करें",
    "your-account-data": "आपका अकाउंट और आपका डेटा",
    "privacy-safety-trust": "प्राइवेसी, सुरक्षा और भरोसा",
  },
  items: { ...hi1, ...hi2, ...hi3, ...hi4, ...hi5 },
};
