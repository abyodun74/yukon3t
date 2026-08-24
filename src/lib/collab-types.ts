// Searchable "type of collaboration" list — same MultiSelect-combobox
// pattern as CIRCLE_CATEGORIES and INTERESTS/JOB_TITLES. The stored value
// *is* the display label (unlike the old CollabType enum's SCREAMING_SNAKE
// keys), so no separate label-lookup map is needed anywhere a collab's type
// is rendered — see collab-permissions.ts's sibling files for the same
// value-is-label convention.
export const COLLAB_TYPES = [
  // Original set
  "Skill Exchange",
  "Volunteer",
  "Study Group",
  "Project",

  // Finance & professional services
  "Tax Preparation Service",
  "Tax Advising",
  "Bookkeeping & Accounting Service",
  "Legal Consultation",
  "Business Planning",
  "Fundraising & Grants",
  "Private Consultant",
  "Investment & Funding",

  // Events & governance
  "Auctions",
  "Annual General Meetings",
  "Workshops & Training",
  "Panel Discussions",
  "Hackathons",
  "Event Planning",

  // Career & professional development
  "Career Counseling",
  "Careers Exploration",
  "Interviews",
  "Resume & Portfolio Review",
  "Job Shadowing",
  "Mentorship",
  "Networking",
  "Public Speaking Practice",

  // Sales, marketing & creative
  "Sales & Marketing",
  "Creative & Content Projects",
  "Digital Products",
  "Design Feedback",
  "Translation & Localization",

  // Community, research & problem-solving
  "Community & Research",
  "Problem Solving & Innovation",
  "Research Collaboration",
  "Peer Support Groups",
  "Book Club",

  // Technical
  "Code Review & Pair Programming",
  "Product Testing & Feedback",
  "Startup Co-founder Search",

  "Other",
] as const;
