import { z } from "zod";
import { AD_DURATION_OPTIONS } from "@/lib/ads";

export const intentTagValues = [
  "FRIENDSHIP",
  "CULTURAL_EXCHANGE",
  "PROFESSIONAL",
  "COMMUNITY",
  "TRAVEL_TIPS",
] as const;

export const intentLabels: Record<(typeof intentTagValues)[number], string> = {
  FRIENDSHIP: "Friendship",
  CULTURAL_EXCHANGE: "Cultural Exchange",
  PROFESSIONAL: "Professional",
  COMMUNITY: "Community",
  TRAVEL_TIPS: "Travel Tips",
};

export const MIN_AGE = 13;

/** True when someone born on `birthDate` is at least `minAge` years old today. */
export function isOldEnough(birthDate: Date, minAge = MIN_AGE) {
  const now = new Date();
  const cutoff = new Date(now.getFullYear() - minAge, now.getMonth(), now.getDate());
  return birthDate <= cutoff;
}

const baseProfileFields = {
  name: z.string().trim().min(2).max(60),
  bio: z.string().trim().max(500).optional().default(""),
  country: z.string().trim().min(2).max(60),
  languages: z.array(z.string().trim().min(2).max(30)).max(10),
  interests: z.array(z.string().trim().min(2).max(30)).max(15),
  openToIntents: z.array(z.enum(intentTagValues)).min(1),
};

// Used by settings updates for already-onboarded users — deliberately does
// NOT touch birthDate (collected once, at onboarding/signup, not editable
// here — same pattern most social apps use for a birthdate field).
export const profileUpdateSchema = z.object(baseProfileFields);

// Used by first-time onboarding — requires birthDate so every new profile
// gets age-gated, without retroactively forcing it on existing users. Also
// requires at least one interest: isProfileComplete() (src/lib/page-guards.ts)
// already gates on interests.length > 0 to leave onboarding, but this schema
// previously allowed submitting with zero — completeOnboarding would then
// "succeed" and redirect to /home, which would immediately bounce back to
// /onboarding with no error shown, since nothing here actually enforced the
// requirement the redirect logic depended on.
export const onboardingSchema = z.object({
  ...baseProfileFields,
  interests: baseProfileFields.interests.min(1),
  birthDate: z.coerce.date().refine(isOldEnough, {
    message: `You must be at least ${MIN_AGE} years old to use YuKon3t.`,
  }),
});

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, and underscores only.");

export const passwordSchema = z.string().min(8).max(72);

export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  birthDate: z.coerce.date().refine(isOldEnough, {
    message: `You must be at least ${MIN_AGE} years old to use YuKon3t.`,
  }),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(72),
});

export const setPasswordSchema = z.object({
  password: passwordSchema,
  // Only required when the user already has a passwordHash (checked
  // imperatively in the setPassword action, not here, since that depends on
  // DB state the schema itself can't see) — prevents a hijacked session
  // cookie from being escalated into a durable password-login backdoor.
  currentPassword: z.string().max(72).optional(),
});

// E.164: "+" then 8-15 digits — normalized client-side before submit,
// re-validated here since this is what actually gets sent to Twilio.
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number with country code.");

export const verifyPhoneCodeSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{4,10}$/, "Enter the code we sent you."),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1),
  password: passwordSchema,
});

// HIDDEN is admin-only — enforced server-side in updatePrivacy (src/app/actions/profile.ts),
// not just by hiding the option in the Settings UI for non-admins.
export const postsVisibilityValues = ["PUBLIC", "CONNECTIONS_ONLY", "HIDDEN"] as const;

export const privacySchema = z.object({
  postsVisibility: z.enum(postsVisibilityValues),
  discoverable: z.boolean(),
});

export const ringtoneValues = ["CLASSIC", "CHIME", "DIGITAL", "MARIMBA", "PULSE"] as const;

export const ringtoneSchema = z.object({
  ringtone: z.enum(ringtoneValues),
});

export const circleSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().min(10).max(1000),
  category: z.array(z.string().trim().min(2).max(40)).min(1).max(5),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional().default("PUBLIC"),
});

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(4000),
});

export const channelSchema = z.object({
  name: z.string().trim().min(2).max(50),
  type: z.enum(["TEXT", "VOICE"]),
  topic: z.string().trim().max(200).optional().default(""),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional().default("PUBLIC"),
});

export const updateChannelSchema = z.object({
  name: z.string().trim().min(2).max(50),
  topic: z.string().trim().max(200).optional().default(""),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
});

// Mirrors the Prisma FeedCategory enum — which Home feed section a post is
// filed under (src/app/home/page.tsx). Both the composer's category picker
// and Home's filter tabs read from these two constants, so adding a
// category here is the only change needed to surface it in both places.
export const feedCategoryValues = [
  "OCCUPATIONAL",
  "ENTERTAINMENT",
  "POLITICS",
  "SPORTS",
  "EDUCATIONAL",
  "NEWS",
  "RELIGIOUS_SPIRITUAL",
  "GENERAL",
] as const;
export const feedCategoryLabels: Record<(typeof feedCategoryValues)[number], string> = {
  OCCUPATIONAL: "Occupational",
  ENTERTAINMENT: "Entertainment",
  POLITICS: "Politics",
  SPORTS: "Sports",
  EDUCATIONAL: "Educational",
  NEWS: "Local & International News",
  RELIGIOUS_SPIRITUAL: "Religious & Spiritual",
  GENERAL: "General",
};

export const postSchema = z
  .object({
    circleId: z.string().cuid().optional(),
    // Not z.string().cuid(): pre-existing Circles' General/Voice channels
    // were backfilled (migration 20260807020052) with gen_random_uuid()
    // ids, not Prisma's cuid() — a strict cuid check here rejects every
    // post to any Circle created before that migration.
    channelId: z.string().min(1).optional(),
    // No practical cap on post length — raised from 2000 so "show more"
    // can expand posts of any size. Still bounded (not fully unlimited) so a
    // single request can't ship an arbitrarily huge payload.
    content: z.string().trim().max(50000).optional().default(""),
    intentTag: z.enum(intentTagValues).optional(),
    feedCategory: z.enum(feedCategoryValues).optional().default("GENERAL"),
    mediaType: z.enum(["NONE", "IMAGE", "VIDEO", "EMBED", "LINK"]).optional().default("NONE"),
    mediaUrls: z.array(z.string().url()).max(10).optional().default([]),
    videoUrl: z.string().url().optional(),
    videoThumbnailUrl: z.string().url().optional(),
    // Raw pasted link — for mediaType EMBED, server-side input to
    // parseVideoEmbedUrl() (only the parsed provider+id is stored). For
    // mediaType LINK (any other http(s) URL), input to normalizeLinkUrl()
    // and stored as-is, since it's only ever rendered as a plain <a href>.
    embedUrl: z.string().trim().max(2000).optional(),
    eventAt: z.coerce.date().optional(),
    eventLocation: z.string().trim().min(2).max(200).optional(),
  })
  // A post needs a caption, media, or event details — never all three empty.
  .refine((data) => data.content.length > 0 || data.mediaType !== "NONE" || Boolean(data.eventAt), {
    message: "A post needs a caption or media.",
    path: ["content"],
  })
  .refine((data) => !data.eventAt || data.eventAt > new Date(), {
    message: "Event date must be in the future.",
    path: ["eventAt"],
  })
  .refine((data) => !data.eventAt || Boolean(data.eventLocation), {
    message: "Events need a location.",
    path: ["eventLocation"],
  });

export const uploadKindValues = [
  "avatar",
  "post-image",
  "post-video",
  "video-thumb",
  "message-audio",
  "message-video",
  "message-image",
  "circle-cover",
  "story-image",
  "story-video",
  "ad-image",
  "ad-video",
  "collab-material",
  "voice-dictation",
] as const;

export const requestUploadSchema = z.object({
  kind: z.enum(uploadKindValues),
  contentType: z.string().trim().min(1).max(100),
});

export const confirmAvatarUploadSchema = z.object({
  key: z.string().trim().min(1).max(500),
  publicUrl: z.string().url(),
});

export const confirmCircleCoverUploadSchema = z.object({
  circleId: z.string().cuid(),
  key: z.string().trim().min(1).max(500),
  publicUrl: z.string().url(),
});

export const imageFromUrlSchema = z.object({
  url: z.string().trim().url().max(2000),
});

export const collabPostSchema = z
  .object({
    title: z.string().trim().min(5).max(100),
    description: z.string().trim().min(20).max(2000),
    type: z.string().trim().min(2).max(60),
    worldwide: z.coerce.boolean().optional().default(false),
    countries: z.array(z.string().trim().min(2).max(60)).max(20).optional().default([]),
    visibility: z.enum(["PUBLIC", "PRIVATE"]).optional().default("PUBLIC"),
    // Only meaningful (and required) when visibility is PRIVATE — who the
    // organizer is inviting up front. See createCollabPost.
    inviteeIds: z.array(z.string().cuid()).max(50).optional().default([]),
  })
  // Worldwide posts skip the country list entirely; anything else still
  // needs at least one — the 10-country cap this replaced was read as "this
  // app only supports 10 countries," when really it was just an unlabeled
  // selection limit with no "open to everyone" escape hatch.
  .refine((data) => data.worldwide || data.countries.length > 0, {
    message: "Pick at least one country, or mark this worldwide.",
    path: ["countries"],
  })
  .refine((data) => data.visibility !== "PRIVATE" || data.inviteeIds.length > 0, {
    message: "Invite at least one person, or make this collaboration public.",
    path: ["inviteeIds"],
  });

export const collabInviteSchema = z.object({
  inviteeIds: z.array(z.string().cuid()).min(1).max(50),
});

export const adBookingSchema = z.object({
  companyName: z.string().trim().min(2).max(100),
  contactName: z.string().trim().min(2).max(100),
  contactEmail: z.string().trim().toLowerCase().email(),
  headline: z.string().trim().min(5).max(80),
  body: z.string().trim().min(10).max(280),
  // z.string().url() alone accepts any syntactically valid URL, including
  // javascript:/data: schemes — this is rendered as a raw <a href> to every
  // visitor (once approved) and to admins reviewing it beforehand, so
  // without this an advertiser could submit a script-executing "link" as a
  // stored XSS payload. http(s)-only closes that off.
  linkUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((url) => /^https?:\/\//i.test(url), { message: "Link must start with http:// or https://" }),
  mediaType: z.enum(["IMAGE", "VIDEO"]),
  mediaUrl: z.string().url(),
  mediaThumbnailUrl: z.string().url().optional(),
  durationDays: z.coerce.number().refine((d) => (AD_DURATION_OPTIONS as readonly number[]).includes(d), {
    message: "Pick one of the offered durations.",
  }),
});

export const storySchema = z.object({
  mediaType: z.enum(["IMAGE", "VIDEO"]),
  mediaUrl: z.string().url(),
  mediaThumbnailUrl: z.string().url().optional(),
  caption: z.string().trim().max(200).optional().default(""),
});

export const connectionRequestSchema = z.object({
  targetId: z.string().cuid(),
  intentTag: z.enum(intentTagValues),
});

export const messageSchema = z
  .object({
    conversationId: z.string().cuid().optional(),
    recipientId: z.string().cuid().optional(),
    content: z.string().trim().max(4000).optional().default(""),
    mediaType: z.enum(["NONE", "AUDIO", "VIDEO", "IMAGE"]).optional().default("NONE"),
    mediaUrl: z.string().url().optional(),
    mediaThumbnailUrl: z.string().url().optional(),
    replyToMessageId: z.string().cuid().optional(),
  })
  // A message needs text or a voice/video/photo attachment — never neither.
  .refine((data) => data.content.length > 0 || data.mediaType !== "NONE", {
    message: "A message needs text or a voice/video/photo attachment.",
    path: ["content"],
  });

export const groupChatSchema = z.object({
  name: z.string().trim().min(2).max(60),
  // No upper bound — group size is unlimited. Still naturally bounded by
  // requiring every id to be an actual accepted connection of the creator
  // (see createGroupChat's acceptedCount check) and by the groupChatCreate
  // rate limiter.
  memberIds: z.array(z.string().cuid()).min(2),
  discoverable: z.boolean(),
});

export const groupNameSchema = groupChatSchema.pick({ name: true });

// For addGroupMembers (adding connections to an already-created group) —
// same id shape as groupChatSchema.memberIds, but no minimum, since adding
// just one more member at a time is the normal case.
export const addGroupMembersSchema = z.object({
  memberIds: z.array(z.string().cuid()).min(1),
});

export const correctionSchema = z.object({
  correctedText: z.string().trim().min(1).max(4000),
});

export const reportReasonCategoryValues = [
  "SPAM",
  "SCAM_OR_FRAUD",
  "PHISHING",
  "HARASSMENT",
  "FAKE_ACCOUNT",
  "INAPPROPRIATE_CONTENT",
  "OTHER",
] as const;

export const reportReasonCategoryLabels: Record<(typeof reportReasonCategoryValues)[number], string> = {
  SPAM: "Spam",
  SCAM_OR_FRAUD: "Scam or fraud",
  PHISHING: "Phishing",
  HARASSMENT: "Harassment or abuse",
  FAKE_ACCOUNT: "Fake account / impersonation",
  INAPPROPRIATE_CONTENT: "Inappropriate or unwanted content",
  OTHER: "Something else",
};

export const reportSchema = z.object({
  targetType: z.enum(["USER", "POST", "MESSAGE", "CIRCLE", "COLLAB_POST", "COMMENT"]),
  targetId: z.string().cuid(),
  reportedUserId: z.string().cuid().optional(),
  reasonCategory: z.enum(reportReasonCategoryValues).optional().default("OTHER"),
  reason: z.string().trim().min(10).max(1000),
});

export const commentSchema = z.object({
  postId: z.string().cuid(),
  parentId: z.string().cuid().optional(),
  content: z.string().trim().min(1).max(1000),
});

export const editCommentSchema = commentSchema.pick({ content: true });

export const repostSchema = z.object({
  postId: z.string().cuid(),
  caption: z.string().trim().max(500).optional().default(""),
});

export const shareToCircleSchema = z.object({
  postId: z.string().cuid(),
  circleId: z.string().cuid(),
  caption: z.string().trim().max(500).optional().default(""),
});

export const liveStreamTitleSchema = z.object({
  title: z.string().trim().min(1).max(100),
  circleId: z.string().cuid().optional(),
});

/** GUEST/COHOST request a stage slot (see joinLiveStream); omitted/undefined means watch-only. */
export const liveStreamJoinRoleSchema = z.enum(["GUEST", "COHOST"]).optional();

export const moderationActionSchema = z.object({
  reportId: z.string().cuid(),
  action: z.enum([
    "WARN",
    "SUSPEND",
    "BAN",
    "REMOVE_CONTENT",
    "REPORT_DISMISSED",
    "REPORT_RESOLVED",
  ]),
  note: z.string().trim().min(5).max(1000),
});

export const adminDeleteUserSchema = z.object({
  userId: z.string().cuid(),
  confirmHandle: z.string().trim().min(1),
  reason: z.string().trim().min(5).max(1000),
});

export const transcribeAudioSchema = z.object({
  key: z.string().min(1),
});

export const flaggedContentActionSchema = z.object({
  contentType: z.enum(["POST", "COMMENT", "MESSAGE"]),
  contentId: z.string().cuid(),
  decision: z.enum(["APPROVE", "REMOVE"]),
});
