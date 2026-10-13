import { JOB_TITLES } from "@/lib/job-titles";

/** The general categories: the ones the dictionaries translate for display (vocab.circleCategories). */
export const GENERAL_CIRCLE_CATEGORIES = [
  "Travel",
  "Culture",
  "Language Exchange",
  "Professional",
  "Technology & Startups",
  "Hobbies & Crafts",
  "Sports & Fitness",
  "Arts & Entertainment",
  "Food & Cooking",
  "Music",
  "Gaming",
  "Education & Learning",
  "Volunteering & Causes",
  "Health & Wellness",
  "Parenting & Family",
  "Environment & Sustainability",
  "Books & Writing",
  "Photography",
  "Other",
] as const;

// General categories plus every specific job title/occupation (see
// job-titles.ts) — a Circle for, say, Cybersecurity Analysts picks that
// directly rather than being stuck under the broad "Professional" bucket.
// Large enough that the picker (circles/new/page.tsx) needs to be a
// searchable combobox rather than a plain <select>.
export const CIRCLE_CATEGORIES = [...GENERAL_CIRCLE_CATEGORIES, ...JOB_TITLES] as const;
