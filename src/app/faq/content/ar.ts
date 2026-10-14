import type { FaqContent } from "../ids";
import { ar1 } from "./ar-1";
import { ar2 } from "./ar-2";
import { ar3 } from "./ar-3";
import { ar4 } from "./ar-4";

// The FAQ in Arabic. Same conventions as src/lib/i18n/ar. Every answer says what its English says in ../page.tsx,
// no more and no less: these are factual, privacy and safety claims, so a change there is a change here. The one
// deliberate difference is direction: where the Arabic layout mirrors a gesture or a corner, the answer describes
// what an Arabic reader actually does.
export const ar: FaqContent = {
  heading: "الأسئلة الشائعة",
  intro:
    "كل ما تحتاج إليه لتعرف طريقك في YuKon3t. لم تجد إجابة هنا؟ ردّ على أي رسالة بريد إلكتروني تصلك من فريق الإشراف، أو تواصل معنا عبر خيار الإبلاغ في الصفحة المعنية.",
  sections: {
    "getting-around": "التنقل في التطبيق",
    "android-app": "تطبيق Android",
    "posts-media": "المنشورات والوسائط",
    "going-live": "البث المباشر",
    stories: "القصص",
    muse: "Muse",
    ambient: "Ambient",
    "connecting-messaging-calls": "التواصل والمراسلة والمكالمات",
    "hidden-chats": "المحادثات المخفية",
    "circles-collab-boards": "مجتمعات Circles ولوحات Collab Boards",
    advertising: "الإعلان",
    "inviting-friends": "دعوة الأصدقاء",
    "your-account-data": "حسابك وبياناتك",
    "privacy-safety-trust": "الخصوصية والأمان والثقة",
  },
  items: { ...ar1, ...ar2, ...ar3, ...ar4 },
};
