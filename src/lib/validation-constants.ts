// Plain constants shared by the zod schemas in src/lib/validations.ts and by client components. This file must stay
// free of zod (and of anything that imports it): a "use client" component importing validations.ts directly pulls all
// of zod (~65KB gzipped) into its route's JavaScript, because the schemas there are built at module load and can't be
// tree-shaken away. src/lib/client-bundle-zod.test.ts checks that no client component reaches zod.

export const intentTagValues = [
  "FRIENDSHIP",
  "CULTURAL_EXCHANGE",
  "PROFESSIONAL",
  "COMMUNITY",
  "TRAVEL_TIPS",
] as const;
export type IntentTag = (typeof intentTagValues)[number];

export const MIN_AGE = 16;

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

export const reportReasonCategoryValues = [
  "SPAM",
  "SCAM_OR_FRAUD",
  "PHISHING",
  "HARASSMENT",
  "FAKE_ACCOUNT",
  "INAPPROPRIATE_CONTENT",
  "OTHER",
] as const;
