import { JOB_TITLES } from "@/lib/job-titles";

const GENERAL_INTERESTS = [
  "Travel", "Backpacking", "Road Trips", "Food & Cooking", "Coffee Culture",
  "Photography", "Videography", "Music", "Live Concerts", "Dancing",
  "Reading", "Writing", "Poetry", "Film & TV", "Theatre",
  "Art & Design", "Fashion", "Museums", "History", "Architecture",
  "Languages", "Language Exchange", "Cultural Exchange", "Volunteering", "Sustainability",
  "Hiking", "Camping", "Cycling", "Running", "Swimming",
  "Yoga", "Fitness", "Football (Soccer)", "Basketball", "Tennis",
  "Surfing", "Skiing & Snowboarding", "Martial Arts", "Rock Climbing", "Sailing",
  "Gaming", "Board Games", "Chess", "Anime & Manga", "Comics",
  "Tech & Startups", "Entrepreneurship", "Remote Work", "Personal Finance", "Investing",
  "Science", "Space & Astronomy", "Environment & Nature", "Animals & Pets", "Gardening",
  "Meditation & Mindfulness", "Spirituality", "Philosophy", "Politics & Current Events", "Comedy",
  "Nightlife", "Craft Beer & Wine", "Wellness", "Parenting", "Study Abroad",
  "Digital Nomad Life", "Career Networking", "Public Speaking", "Podcasts", "DIY & Crafts",
  // Occupations & professions
  "Engineering", "Construction", "Healthcare & Medicine", "Law & Legal Services", "Education & Teaching",
  "Information Technology", "Software Development", "Cybersecurity", "Data Science & Analytics", "Artificial Intelligence & ML",
  "Finance & Accounting", "Marketing & Sales", "Hospitality & Tourism", "Retail", "Manufacturing",
  "Agriculture", "Government & Public Service", "Real Estate", "Transportation & Logistics", "Consulting",
  "Nonprofit & NGO Work", "Skilled Trades", "Media & Journalism", "Human Resources", "Architecture & Urban Planning",
  "Research & Academia", "Customer Service", "Aviation", "Energy & Utilities", "Telecommunications",
  "Pharmaceuticals & Biotech", "Insurance", "Social Work", "Veterinary Medicine", "Military & Defense",
  "Design (UX/UI & Product)", "Sports & Athletics", "Culinary Arts & Chefs", "Environmental Science", "Supply Chain & Procurement",
] as const;

// General interests plus every specific job title/occupation (see
// job-titles.ts) — lets someone search "Linux Administrator" or "Bookkeeping"
// directly instead of only the broad occupation buckets above.
export const INTERESTS = [...GENERAL_INTERESTS, ...JOB_TITLES] as const;
