import { z } from "zod";

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
// gets age-gated, without retroactively forcing it on existing users.
export const onboardingSchema = z.object({
  ...baseProfileFields,
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
  username: usernameSchema,
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
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1),
  password: passwordSchema,
});

export const postsVisibilityValues = ["PUBLIC", "CONNECTIONS_ONLY"] as const;

export const privacySchema = z.object({
  postsVisibility: z.enum(postsVisibilityValues),
  discoverable: z.boolean(),
});

export const circleSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().min(10).max(1000),
  category: z.string().trim().min(2).max(40),
});

export const postSchema = z
  .object({
    circleId: z.string().cuid().optional(),
    content: z.string().trim().max(2000).optional().default(""),
    intentTag: z.enum(intentTagValues).optional(),
    mediaType: z.enum(["NONE", "IMAGE", "VIDEO"]).optional().default("NONE"),
    mediaUrls: z.array(z.string().url()).max(4).optional().default([]),
    videoUrl: z.string().url().optional(),
    videoThumbnailUrl: z.string().url().optional(),
  })
  // A post needs a caption or media — never both empty.
  .refine((data) => data.content.length > 0 || data.mediaType !== "NONE", {
    message: "A post needs a caption or media.",
    path: ["content"],
  });

export const uploadKindValues = [
  "avatar",
  "post-image",
  "post-video",
  "video-thumb",
] as const;

export const requestUploadSchema = z.object({
  kind: z.enum(uploadKindValues),
  contentType: z.string().trim().min(1).max(100),
});

export const confirmAvatarUploadSchema = z.object({
  key: z.string().trim().min(1).max(500),
  publicUrl: z.string().url(),
});

export const collabPostSchema = z.object({
  title: z.string().trim().min(5).max(100),
  description: z.string().trim().min(20).max(2000),
  type: z.enum(["SKILL_EXCHANGE", "VOLUNTEER", "STUDY_GROUP", "PROJECT"]),
  countries: z.array(z.string().trim().min(2).max(60)).min(1).max(10),
});

export const connectionRequestSchema = z.object({
  targetId: z.string().cuid(),
  intentTag: z.enum(intentTagValues),
});

export const messageSchema = z.object({
  conversationId: z.string().cuid().optional(),
  recipientId: z.string().cuid().optional(),
  content: z.string().trim().min(1).max(4000),
});

export const groupChatSchema = z.object({
  name: z.string().trim().min(2).max(60),
  memberIds: z.array(z.string().cuid()).min(2).max(20),
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

export const repostSchema = z.object({
  postId: z.string().cuid(),
  caption: z.string().trim().max(500).optional().default(""),
});

export const moderationActionSchema = z.object({
  reportId: z.string().cuid(),
  action: z.enum(["WARN", "SUSPEND", "BAN", "REPORT_DISMISSED", "REPORT_RESOLVED"]),
  note: z.string().trim().min(5).max(1000),
});
