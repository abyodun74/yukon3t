import type { pushEn } from "@/lib/i18n/en/push";

// The sender's name is the notification's title, so a body is nominal ("إعجاب بمنشورك") and no verb has to agree with
// whoever the name belongs to.

export const push: typeof pushEn = {
  someone: "أحد الأشخاص",
  privateCall: "مكالمة خاصة",
  hiddenBody: "لديك إشعار جديد",
  message: {
    title: "رسالة جديدة",
    photo: "صورة",
    video: "فيديو",
    gif: "صورة GIF",
    voice: "رسالة صوتية",
    unreadable: "رسالة جديدة",
  },
  storyReply: { title: "رد على قصتك", body: "رد على قصتك: {text}" },
  call: {
    incomingVideo: "مكالمة فيديو واردة",
    incomingVoice: "مكالمة صوتية واردة",
    calling: "مكالمة واردة من {name}",
    callingPrivate: "مكالمة خاصة واردة",
    missedTitle: "مكالمة فائتة",
    missed: "مكالمة من {name}",
  },
  activity: {
    CONNECTION_REQUEST: "طلب تواصل جديد",
    CONNECTION_ACCEPTED: "قُبل طلب التواصل الذي أرسلته",
    POST_LIKE: "إعجاب بمنشورك",
    POST_COMMENT: "تعليق على منشورك",
    COMMENT_REPLY: "رد على تعليقك",
    MUSE_LIKE: "تفاعل مع مقطع Muse الخاص بك",
    MUSE_COMMENT: "تعليق على مقطع Muse الخاص بك",
    MUSE_REPOST: "إعادة نشر لمقطع Muse الخاص بك",
    MUSE_SHARE: "مشاركة لمقطع Muse الخاص بك",
    SCREENSHOT_TAKEN: "تم التقاط لقطة شاشة",
    LIVE_STREAM_INVITE: "بث مباشر معك الآن",
    CIRCLE_INVITE: "دعوة للانضمام إلى Circle خاص",
    COLLAB_SESSION_STARTED: "جلسة تعاون مباشرة بدأت الآن",
    POLL_SCHEDULED: "حدّد موعدًا من استطلاع رأي صوّتّ فيه",
    EVENT_RSVP_NUDGE: "يسألك إن كنت ستحضر فعالية",
    EVENT_CANCELLED: "ألغى فعالية تشارك فيها",
    EVENT_RESCHEDULED: "غيّر موعد فعالية تشارك فيها",
  },
  eventChange: {
    newTime: "الموعد الجديد: {when}",
    reason: "السبب: {reason}",
  },
  reminders: {
    eventTitle: "فعاليتك",
    collabTitle: "مشروعك التعاوني",
    eventStartingSoon: "تبدأ الفعالية قريبًا",
    eventStartingSoonAt: "تبدأ الفعالية قريبًا في {location}",
    collabStartingSoon: "تبدأ الجلسة قريبًا",
  },
  appUpdate: {
    title: "يتوفر تحديث",
    body: "إصدار جديد من YuKon3t جاهز. حدّث التطبيق للحصول على أحدث الإصلاحات والميزات.",
  },
  videoReviewTitle: "فيديو قيد المراجعة",
  recordingFailedTitle: "لم يُنشر التسجيل",
};
