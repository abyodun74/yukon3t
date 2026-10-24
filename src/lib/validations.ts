import { z } from "zod";
import { TRANSLATION_BATCH_MAX, TRANSLATION_KINDS } from "@/lib/translation";
import { CALL_CAPTION_MAX_CHARS, CALL_CAPTION_MAX_SDP_CHARS } from "@/lib/call-captions";
import { AD_DURATION_OPTIONS } from "@/lib/ads";
import { HIDDEN_PIN_PATTERN } from "@/lib/hidden-chats-rules";
import { COLLAB_CIRCLE_IDS_MAX } from "@/lib/collab-circle-invite";
import { CIRCLE_INVITE_MAX } from "@/lib/circle-invite";
import { APP_PLATFORMS, MESSAGE_MAX_LENGTH } from "@/lib/app-version";
import {
  POLL_DESCRIPTION_MAX,
  POLL_OPTION_TEXT_MAX,
  POLL_OPTIONS_MAX,
  POLL_QUESTION_MAX,
} from "@/lib/polls";
import { EVENT_BRING_ITEM_MAX_LENGTH, EVENT_CHANGE_REASON_MAX_LENGTH } from "@/lib/circle-events";
import { EVENT_ANNOUNCEMENT_MAX_LENGTH } from "@/lib/circle-event-organizer";
import { RSVP_STATUSES } from "@/lib/rsvp";
import { EVENT_REPEAT_FREQUENCIES } from "@/lib/event-recurrence";
import { FORWARD_MAX_RECIPIENTS } from "@/lib/message-forward";

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

export const MIN_AGE = 16;

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
// requires at least one language and one interest: isProfileComplete()
// (src/lib/page-guards.ts) already gates on interests.length > 0 to leave
// onboarding, but this schema previously allowed submitting with zero —
// completeOnboarding would then "succeed" and redirect to /home, which would
// immediately bounce back to /onboarding with no error shown, since nothing
// here actually enforced the requirement the redirect logic depended on.
// Every field is required except bio (see baseProfileFields.bio).
export const onboardingSchema = z.object({
  ...baseProfileFields,
  languages: baseProfileFields.languages.min(1),
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

const passwordSchema = z.string().min(8).max(72);

const verificationMethodValues = ["EMAIL", "PHONE"] as const;

// Handles nobody should be able to register — they'd read as the app or its staff.
const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "support", "moderator", "mod", "staff", "help", "root", "system", "official", "yukon3t", "yukon", "team",
]);

function isReservedUsername(username: string) {
  return RESERVED_USERNAMES.has(username.trim().toLowerCase());
}

export const signUpSchema = z
  .object({
    username: usernameSchema.refine((u) => !isReservedUsername(u), { message: "That username isn't available." }),
    email: z.string().trim().toLowerCase().email(),
    password: passwordSchema,
    birthDate: z.coerce.date().refine(isOldEnough, {
      message: `You must be at least ${MIN_AGE} years old to use YuKon3t.`,
    }),
    verificationMethod: z.enum(verificationMethodValues),
    // Only used (and only required) when verifying by phone: the number the code is texted to.
    phone: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.verificationMethod === "PHONE" && !phoneSchema.safeParse(data.phone).success) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid phone number." });
    }
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

// E.164: "+" then 8-15 digits — assembled client-side from the country
// selector and national number (PhoneNumberField), re-validated here since
// this is what actually gets sent to Twilio. Shape only: the actions that
// text a code use validPhoneSchema (src/lib/phone-number.ts), which also
// checks the number is a real one. That check isn't here because this file is
// bundled client-side and would drag libphonenumber's metadata into every page.
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number.");

export const verifyPhoneCodeSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{4,10}$/, "Enter the code we sent you."),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Those passwords don't match.",
  });

// HIDDEN is admin-only — enforced server-side in updatePrivacy (src/app/actions/profile.ts),
// not just by hiding the option in the Settings UI for non-admins.
const postsVisibilityValues = ["PUBLIC", "CONNECTIONS_ONLY", "HIDDEN"] as const;

export const privacySchema = z.object({
  postsVisibility: z.enum(postsVisibilityValues),
  discoverable: z.boolean(),
});

const ringtoneValues = ["CLASSIC", "CHIME", "DIGITAL", "MARIMBA", "PULSE"] as const;

export const ringtoneSchema = z.object({
  ringtone: z.enum(ringtoneValues),
});

export const newMemberAlertsSchema = z.object({
  newMemberAlerts: z.boolean(),
});

export const autoTranslateSchema = z.object({
  autoTranslate: z.boolean(),
});

// translateContent (actions/translation.ts): which posts/comments/messages to translate, by id only; the server loads
// the text itself after checking the viewer may read it.
export const translateRequestSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(TRANSLATION_KINDS),
        id: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[A-Za-z0-9_-]+$/),
      }),
    )
    .min(1)
    .max(TRANSLATION_BATCH_MAX),
});

// Live translated captions in 1:1 calls (actions/call-captions.ts).
const captionId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
export const callCaptionCallSchema = z.object({ callId: captionId });
export const callCaptionConsentSchema = z.object({ callId: captionId, on: z.boolean() });
export const callCaptionStartSchema = z.object({
  callId: captionId,
  sdp: z.string().min(1).max(CALL_CAPTION_MAX_SDP_CHARS).startsWith("v=0"),
});
export const callCaptionSessionSchema = z.object({ sessionId: captionId });
// The raw sentence may be a little longer than what is shown (spaces are collapsed before the cap).
export const callCaptionTranslateSchema = z.object({
  callId: captionId,
  text: z.string().min(1).max(CALL_CAPTION_MAX_CHARS * 2),
});

export const circleSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().min(10).max(1000),
  category: z.array(z.string().trim().min(2).max(40)).min(1).max(5),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional().default("PUBLIC"),
});

export const updateCircleDetailsSchema = z.object({
  name: z.string().trim().min(3).max(60),
  // "Theme" in the UI (the creation wizard's third step) — same bounds as at
  // creation (circleSchema above).
  description: z.string().trim().min(10).max(1000),
  category: z.array(z.string().trim().min(2).max(40)).min(1).max(5),
  // Omitted = leave the Circle's privacy as it is.
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
});

// inviteToCircle. Past CIRCLE_INVITE_MAX distinct people the action answers
// too_many (selectCircleInvitees); this bound only keeps the input small.
export const circleInviteSchema = z.object({
  inviteeIds: z.array(z.string().cuid()).min(1).max(CIRCLE_INVITE_MAX * 2),
});

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(4000),
  // All three optional — most announcements are text-only. mediaUrl is
  // required alongside mediaType and mediaThumbnailUrl is VIDEO-only, both
  // enforced imperatively in createAnnouncement (same pattern storySchema
  // uses for its own mediaUrl/mediaThumbnailUrl).
  mediaType: z.enum(["IMAGE", "VIDEO"]).optional(),
  mediaUrl: z.string().url().optional(),
  mediaThumbnailUrl: z.string().url().optional(),
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
  "FINANCIAL_TIPS",
  "HEALTH_WELLNESS",
  "MOTIVATIONAL",
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
  FINANCIAL_TIPS: "Financial Tips",
  HEALTH_WELLNESS: "Health & Wellness",
  MOTIVATIONAL: "Motivational",
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
    // Everyone/Friends only/Private (post-composer.tsx) — createPost forces
    // this to PUBLIC when circleId is set, since Circle membership is
    // already that post's access boundary (see getVisiblePostsWhere).
    visibility: z.enum(["PUBLIC", "CONNECTIONS_ONLY", "PRIVATE"]).optional().default("PUBLIC"),
    feedCategory: z.enum(feedCategoryValues).optional().default("GENERAL"),
    mediaType: z.enum(["NONE", "IMAGE", "VIDEO", "EMBED", "LINK", "GIF"]).optional().default("NONE"),
    mediaUrls: z.array(z.string().url()).max(10).optional().default([]),
    videoUrl: z.string().url().optional(),
    videoThumbnailUrl: z.string().url().optional(),
    // Client-probed video duration — not a security boundary (nothing stops
    // a client from lying), just the signal createPost uses to decide
    // whether this video is short enough for Hive's automated scan or needs
    // to route to the long-form review pipeline instead. A lowballed value
    // only risks under-flagging a video that pipeline would then also just
    // fail/skip on, so there's no exploitable upside to lying here.
    // Rounded rather than required to already be a whole number — the web
    // upload path's own <video>.duration probe always sends a rounded
    // value, but the native Android picker's durationMs/1000.0 didn't, and
    // a strict .int() here rejected that fractional value outright, which
    // failed the *entire* post with an unrelated-looking generic "invalid"
    // error (confirmed live: 10.006 seconds killed a whole video post).
    // Rounding server-side closes this off regardless of what any future
    // client-side duration source happens to send.
    videoDurationSeconds: z.coerce.number().positive().transform(Math.round).optional(),
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

const uploadKindValues = [
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
  "comment-audio",
  "comment-video",
  "muse-video",
  "muse-audio",
] as const;

export const requestUploadSchema = z.object({
  kind: z.enum(uploadKindValues),
  contentType: z.string().trim().min(1).max(100),
});

export const requestUploadBatchSchema = z
  .array(requestUploadSchema)
  .min(1)
  .max(12);

export const startMultipartSchema = z.object({
  kind: z.enum(uploadKindValues),
  contentType: z.string().trim().min(1).max(100),
  size: z.coerce.number().int().positive(),
});

export const multipartRefSchema = z.object({
  key: z.string().trim().min(1).max(500),
  uploadId: z.string().trim().min(1).max(1000),
});

export const completeMultipartSchema = multipartRefSchema.extend({
  partCount: z.coerce.number().int().positive().max(10_000),
});

export const confirmAvatarUploadSchema = z.object({
  key: z.string().trim().min(1).max(500),
  publicUrl: z.string().url(),
});

// Private profile pictures (AVATAR_PRIVATE): one content type for both sizes (the client encodes them the same way),
// then the two upload keys it was given. Ownership/shape of the keys is checked again with isPrivateKeyOwnedBy.
export const requestPrivateAvatarUploadSchema = z.object({
  contentType: z.string().trim().min(1).max(100),
});

export const confirmPrivateAvatarUploadSchema = z.object({
  thumbKey: z.string().trim().min(1).max(200),
  fullKey: z.string().trim().min(1).max(200),
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
    // Circles (that the organizer created) whose members are invited too —
    // see selectCircleInvitees in lib/collab-circle-invite.ts.
    circleIds: z.array(z.string().cuid()).max(COLLAB_CIRCLE_IDS_MAX).optional().default([]),
    // Optional recurring session schedule — see CollabBoardPost.scheduleDays's
    // own doc comment on why both are entered directly in UTC. Either both
    // are set (a schedule) or neither is (no schedule) — enforced below.
    scheduleDays: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional().default([]),
    scheduleTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour HH:mm time")
      .optional(),
  })
  // Worldwide posts skip the country list entirely; anything else still
  // needs at least one — the 10-country cap this replaced was read as "this
  // app only supports 10 countries," when really it was just an unlabeled
  // selection limit with no "open to everyone" escape hatch.
  .refine((data) => data.worldwide || data.countries.length > 0, {
    message: "Pick at least one country, or mark this worldwide.",
    path: ["countries"],
  })
  .refine((data) => data.visibility !== "PRIVATE" || data.inviteeIds.length > 0 || data.circleIds.length > 0, {
    message: "Invite at least one person or Circle, or make this collaboration public.",
    path: ["inviteeIds"],
  })
  .refine((data) => data.scheduleDays.length === 0 || !!data.scheduleTime, {
    message: "Pick a time for the recurring session.",
    path: ["scheduleTime"],
  })
  .refine((data) => !data.scheduleTime || data.scheduleDays.length > 0, {
    message: "Pick at least one day for the recurring session.",
    path: ["scheduleDays"],
  });

export const collabInviteSchema = z
  .object({
    inviteeIds: z.array(z.string().cuid()).max(50),
    circleIds: z.array(z.string().cuid()).max(COLLAB_CIRCLE_IDS_MAX),
  })
  .refine((data) => data.inviteeIds.length > 0 || data.circleIds.length > 0, {
    message: "Pick at least one person or Circle to invite.",
    path: ["inviteeIds"],
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

export const ambientMomentSchema = z.object({
  imageUrl: z.string().url(),
  caption: z.string().trim().max(120).optional().default(""),
});

export const storySchema = z.object({
  mediaType: z.enum(["IMAGE", "VIDEO", "EMBED"]),
  // Required for IMAGE/VIDEO, absent for EMBED — createStory enforces the
  // actual per-mediaType requirement imperatively, same pattern postSchema
  // already uses for its own EMBED case (see mediaUrls/videoUrl there).
  mediaUrl: z.string().url().optional(),
  mediaThumbnailUrl: z.string().url().optional(),
  // EMBED only — raw pasted link, input to parseVideoEmbedUrl() server-side
  // (only the parsed provider+id is ever stored, never this raw string).
  // Same field/purpose as postSchema's own embedUrl.
  embedUrl: z.string().url().optional(),
  caption: z.string().trim().max(200).optional().default(""),
});

export const museSchema = z.object({
  caption: z.string().trim().max(200).optional().default(""),
  mediaType: z.enum(["VIDEO", "EMBED"]).optional().default("VIDEO"),
  // Required for VIDEO, absent for EMBED — same imperative-enforcement
  // pattern as storySchema's own mediaUrl above.
  videoUrl: z.string().url().optional(),
  videoThumbnailUrl: z.string().url().optional(),
  // EMBED only — see storySchema's own embedUrl.
  embedUrl: z.string().url().optional(),
  // Client-probed <video>.duration, same non-authoritative routing-hint
  // status as postSchema's own videoDurationSeconds — createMuse re-checks
  // it server-side against MAX_MUSE_VIDEO_DURATION_SECONDS regardless. The
  // 300 below is duplicated from that constant (src/lib/storage.ts), not
  // imported — this file is also bundled client-side (e.g. report-form.tsx),
  // and storage.ts pulls in the AWS S3 SDK + node:crypto, which broke the
  // webpack production build (Netlify forces --webpack; see netlify.toml)
  // with "node:crypto ... Unhandled scheme" once this file imported it.
  // Same reasoning post-composer.tsx's own MAX_UPLOAD_VIDEO_SECONDS
  // duplicate and muse-composer.tsx's MAX_MUSE_SECONDS already document.
  // Required for VIDEO, absent for EMBED — an embed's actual video has no
  // known duration this app controls (see Muse.mediaType's own doc comment).
  videoDurationSeconds: z.coerce.number().int().min(1).max(300).optional(),
  // Set only when the creator chose "use this audio instead" in
  // MuseComposer — absent (not just empty) means "use the video's own
  // sound," never a mix of both. See Muse.audioUrl's schema comment.
  audioUrl: z.string().url().optional(),
});

export const screenshotTargetSchema = z.object({
  type: z.enum(["post", "story", "conversation", "profile"]),
  id: z.string().min(1).max(64),
});

export const notificationIdSchema = z.string().min(1).max(64);

export const notificationIdsSchema = z.array(notificationIdSchema).min(1).max(200);

// A same-origin path only: one leading "/" (not "//", which a browser reads
// as another host) and no backslash (which some treat as a "/").
export const notificationTargetSchema = z
  .string()
  .max(500)
  .refine((url) => url.startsWith("/") && !url.startsWith("//") && !url.includes("\\"));

export const connectionRequestSchema = z.object({
  targetId: z.string().cuid(),
  intentTag: z.enum(intentTagValues),
});

export const messageSchema = z
  .object({
    conversationId: z.string().cuid().optional(),
    recipientId: z.string().cuid().optional(),
    content: z.string().trim().max(4000).optional().default(""),
    mediaType: z.enum(["NONE", "AUDIO", "VIDEO", "IMAGE", "GIF"]).optional().default("NONE"),
    mediaUrl: z.string().url().optional(),
    mediaThumbnailUrl: z.string().url().optional(),
    replyToMessageId: z.string().cuid().optional(),
  })
  // A message needs text or a voice/video/photo attachment — never neither.
  .refine((data) => data.content.length > 0 || data.mediaType !== "NONE", {
    message: "A message needs text or a voice/video/photo attachment.",
    path: ["content"],
  });

/** forwardMessage: which message, and which of the caller's chats (at most FORWARD_MAX_RECIPIENTS). Never the text. */
export const forwardMessageSchema = z.object({
  messageId: z.string().cuid(),
  conversationIds: z.array(z.string().cuid()).min(1).max(FORWARD_MAX_RECIPIENTS),
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

const commentBaseSchema = z.object({
  postId: z.string().cuid(),
  parentId: z.string().cuid().optional(),
  content: z.string().trim().max(1000).optional().default(""),
  // Giphy-hosted GIF, picked via the GIF button — validated as a real
  // Giphy URL server-side (isGiphyUrl) before ever being stored, comments
  // have no upload flow of their own to trust otherwise.
  gifUrl: z.string().url().optional(),
  // A real upload to this app's own bucket (kind "comment-audio") — unlike
  // gifUrl, trusted the same way message mediaUrl is (the presigned-upload
  // step is the actual trust boundary; see createComment's
  // verifyUploadedSize call).
  audioUrl: z.string().url().optional(),
  // Video comment — same fields/semantics as postSchema's own
  // videoUrl/videoThumbnailUrl/videoDurationSeconds (see there for the full
  // rationale); createComment applies the same strict media-moderation
  // policy posts use for video, not audioUrl's lenient no-scan gap.
  videoUrl: z.string().url().optional(),
  videoThumbnailUrl: z.string().url().optional(),
  videoDurationSeconds: z.coerce.number().int().positive().optional(),
});

export const commentSchema = commentBaseSchema.refine(
  (data) => data.content.length > 0 || !!data.gifUrl || !!data.audioUrl || !!data.videoUrl,
  { message: "Comment must have text, a GIF, a voice clip, or a video." },
);

export const editCommentSchema = commentBaseSchema.pick({ content: true }).extend({
  content: z.string().trim().min(1).max(1000),
});

export const repostSchema = z.object({
  postId: z.string().cuid(),
  caption: z.string().trim().max(500).optional().default(""),
});

export const shareToCircleSchema = z.object({
  postId: z.string().cuid(),
  circleId: z.string().cuid(),
  caption: z.string().trim().max(500).optional().default(""),
});

export const liveStreamTitleSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    circleId: z.string().cuid().optional(),
    // "Who can watch" set to one specific person instead — mutually
    // exclusive with circleId, see the .refine() below.
    targetUserId: z.string().cuid().optional(),
  })
  .refine((data) => !(data.circleId && data.targetUserId), {
    message: "A stream can be scoped to a Circle or a specific person, not both.",
  });

/** GUEST/COHOST request a stage slot (see joinLiveStream); omitted/undefined means watch-only. */
export const liveStreamJoinRoleSchema = z.enum(["GUEST", "COHOST"]).optional();

export const liveStreamCommentSchema = z.object({
  content: z.string().trim().min(1).max(300),
});

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
  contentType: z.enum(["POST", "COMMENT", "MESSAGE", "MUSE"]),
  contentId: z.string().cuid(),
  decision: z.enum(["APPROVE", "REMOVE"]),
});

// View-once photo/video messages (actions/view-once.ts). Sizes are re-checked against the real object after upload.
export const viewOnceUploadSchema = z.object({
  conversationId: z.string().cuid(),
  contentType: z.string().trim().min(1).max(100),
  size: z.number().int().positive(),
});

export const viewOnceSendSchema = z.object({
  conversationId: z.string().cuid(),
  objectKey: z.string().trim().min(1).max(500),
  frameKey: z.string().trim().min(1).max(500).optional(),
  mediaType: z.enum(["IMAGE", "VIDEO"]),
  replyToMessageId: z.string().cuid().optional(),
});

export const viewOnceMessageIdSchema = z.string().cuid();

// Hidden chats (actions/hidden-chats.ts). The PIN is 4-8 digits; the pattern lives with the other rules.
export const hiddenPinSchema = z.string().regex(HIDDEN_PIN_PATTERN);

const newHiddenPin = { newPin: hiddenPinSchema, confirmPin: z.string().max(8) };
const pinsMatch = (d: { newPin: string; confirmPin: string }) => d.newPin === d.confirmPin;

export const setHiddenPinSchema = z.object(newHiddenPin).refine(pinsMatch, { path: ["confirmPin"] });

export const changeHiddenPinSchema = z
  .object({ currentPin: hiddenPinSchema, ...newHiddenPin })
  .refine(pinsMatch, { path: ["confirmPin"] });

export const resetHiddenPinSchema = z
  .object({ accountPassword: z.string().min(1).max(72), ...newHiddenPin })
  .refine(pinsMatch, { path: ["confirmPin"] });

export const resetHiddenPinWithCodeSchema = z
  .object({
    challengeId: z.string().min(1).max(64),
    code: z.string().trim().regex(/^\d{4,10}$/),
    ...newHiddenPin,
  })
  .refine(pinsMatch, { path: ["confirmPin"] });

export const hiddenConversationIdSchema = z.string().cuid();

// /admin/system's app update card (actions/app-version.ts). Raw form strings, empty meaning "not set"; what each must
// look like (a build number, a version, a store link) and how they relate is checkAppVersionPolicy in app-version.ts.
export const appVersionPolicyFormSchema = z.object({
  platform: z.enum(APP_PLATFORMS),
  enabled: z.boolean(),
  iosAutoDetect: z.boolean(),
  latestBuild: z.string().trim().max(12),
  minBuild: z.string().trim().max(12),
  latestVersion: z.string().trim().max(32),
  message: z.string().trim().max(MESSAGE_MAX_LENGTH),
  storeUrl: z.string().trim().max(500),
  appStoreId: z.string().trim().max(20),
  // The minBuild value typed again in the force-update confirmation; must match a new or changed minBuild.
  confirmMinBuild: z.string().trim().max(12),
});

export const appUpdateNoticeSchema = z.object({
  platform: z.enum(APP_PLATFORMS),
  includeUnknownBuild: z.boolean(),
});

// Polls (actions/polls.ts). Shapes only: option counts, duplicates, future times and what an edit does to existing
// votes are the pure rules in src/lib/polls.ts. Times are ISO instants (the form reads its UTC inputs into them).
const pollOptionInputSchema = z.object({
  id: z.string().cuid().optional(),
  text: z.string().max(POLL_OPTION_TEXT_MAX * 2).nullish(),
  startsAt: z.string().datetime().nullish(),
});

const pollTextFields = {
  question: z.string().trim().min(3).max(POLL_QUESTION_MAX),
  description: z
    .string()
    .trim()
    .max(POLL_DESCRIPTION_MAX)
    .nullish()
    .transform((value) => value || null),
  closesAt: z.string().datetime().nullish(),
  options: z.array(pollOptionInputSchema).max(POLL_OPTIONS_MAX * 2),
};

export const pollCreateSchema = z.object({
  circleId: z.string().cuid().nullish(),
  channelId: z.string().cuid().nullish(),
  collabId: z.string().cuid().nullish(),
  kind: z.enum(["GENERAL", "SCHEDULE"]),
  allowMultiple: z.boolean(),
  ...pollTextFields,
});

export const pollUpdateSchema = z.object(pollTextFields);

export const pollIdSchema = z.string().cuid();

export const pollVoteSchema = z.array(z.string().cuid()).max(POLL_OPTIONS_MAX);

// A page of polls (loadPolls): one parent, an optional cursor (the last poll shown: its creation time and id) and the
// direction. The cursor is only a position; which polls the viewer may see is decided on the server.
export const pollListSchema = z.object({
  circleId: z.string().cuid().nullish(),
  collabId: z.string().cuid().nullish(),
  cursor: z.object({ createdAt: z.string().datetime(), id: z.string().cuid() }).nullish(),
  mode: z.enum(["older", "through"]),
});

// Circle events (actions/circle-events.ts). Ids are only ids: whether the viewer may see or touch the event is
// decided on the server (circle-events-data.ts).
export const circleEventIdSchema = z.string().cuid();

// "Coming up" on a Circle page: the cursor is the last event shown (its start and id).
export const circleEventListSchema = z.object({
  circleId: z.string().cuid(),
  cursor: z.object({ eventAt: z.string().datetime(), id: z.string().cuid() }).nullish(),
});

// A bring-list item's text before normalizeBringItemText (lib/circle-events.ts) trims it and enforces the real limit.
export const bringItemTextSchema = z.string().max(EVENT_BRING_ITEM_MAX_LENGTH * 4);

// Cancelling / rescheduling a Circle event: an optional reason (normalizeEventChangeReason in lib/circle-events.ts
// trims it and enforces the real limit), the new start as an ISO instant, and whether a cancel also stops the repeat.
export const eventCancelSchema = z.object({
  reason: z.string().max(EVENT_CHANGE_REASON_MAX_LENGTH * 4).nullish(),
  stopSeries: z.boolean().optional(),
});
export const eventRescheduleSchema = z.object({
  eventAt: z.string().datetime(),
  reason: z.string().max(EVENT_CHANGE_REASON_MAX_LENGTH * 4).nullish(),
});

// Organizer tools (actions/circle-event-organizer.ts). An update's text before normalizeAnnouncementText
// (lib/circle-event-organizer.ts) trims it and enforces the real limit; who is checked in and whether; the walk-in
// search as typed; what an export covers.
export const eventAnnouncementSchema = z.object({
  text: z.string().max(EVENT_ANNOUNCEMENT_MAX_LENGTH * 4),
});
export const eventAttendanceSchema = z.object({
  userId: z.string().cuid(),
  attended: z.boolean(),
});
export const eventWalkInSearchSchema = z.object({
  query: z.string().max(200),
});
export const eventExportSchema = z.object({
  scope: z.enum(["event", "series"]),
});
// Editing an organizer update: the same text rules as posting one.
export const eventAnnouncementEditSchema = eventAnnouncementSchema;

// setRsvp (actions/rsvp.ts): the event post and the caller's reply, or null to take it back.
export const rsvpSetSchema = z.object({
  postId: z.string().min(1).max(64),
  status: z.enum(RSVP_STATUSES).nullable(),
});

// Repeat for a new Circle event (createPost): the frequency and exactly one end, either a number of occurrences or a
// date. buildSeriesRule (lib/event-recurrence.ts) checks the limits; this only parses.
export const eventRepeatSchema = z.object({
  frequency: z.enum(EVENT_REPEAT_FREQUENCIES),
  count: z.coerce.number().int().optional(),
  until: z.coerce.date().optional(),
});
