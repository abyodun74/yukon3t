import { z } from "zod";

export const intentTagValues = [
  "FRIENDSHIP",
  "CULTURAL_EXCHANGE",
  "PROFESSIONAL",
  "COMMUNITY",
  "DATING",
] as const;

export const onboardingSchema = z.object({
  name: z.string().trim().min(2).max(60),
  bio: z.string().trim().max(500).optional().default(""),
  country: z.string().trim().min(2).max(60),
  languages: z.array(z.string().trim().min(2).max(30)).max(10),
  interests: z.array(z.string().trim().min(2).max(30)).max(15),
  openToIntents: z.array(z.enum(intentTagValues)).min(1),
});

export const circleSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().min(10).max(1000),
  category: z.string().trim().min(2).max(40),
});

export const postSchema = z.object({
  circleId: z.string().cuid().optional(),
  content: z.string().trim().min(1).max(2000),
  intentTag: z.enum(intentTagValues).optional(),
  mediaType: z.enum(["NONE", "IMAGE", "VIDEO"]).optional().default("NONE"),
  mediaUrls: z.array(z.string().url()).max(4).optional().default([]),
  videoUrl: z.string().url().optional(),
  videoThumbnailUrl: z.string().url().optional(),
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

export const reportSchema = z.object({
  targetType: z.enum(["USER", "POST", "MESSAGE", "CIRCLE", "COLLAB_POST"]),
  targetId: z.string().cuid(),
  reportedUserId: z.string().cuid().optional(),
  reason: z.string().trim().min(10).max(1000),
});

export const moderationActionSchema = z.object({
  reportId: z.string().cuid(),
  action: z.enum(["WARN", "SUSPEND", "BAN", "REPORT_DISMISSED", "REPORT_RESOLVED"]),
  note: z.string().trim().min(5).max(1000),
});
