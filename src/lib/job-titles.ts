// Shared job-title/occupation taxonomy — searched via the same MultiSelect
// combobox pattern used for countries (collab-countries-field.tsx) and
// interests (edit-profile-form.tsx). Flat on purpose: search matches by
// substring across the whole list (see MultiSelect), so a nested/tree
// structure would need its own picker UI for no real benefit here. Grouped
// by comment only, for maintainers adding to it later.
export const JOB_TITLES = [
  // Accounting & Finance
  "Bookkeeping", "Taxation", "Auditing", "Financial Analyst", "Financial Planner",
  "Accountant", "Payroll Specialist", "Investment Banking", "Actuary", "Credit Analyst",
  "Budget Analyst", "Tax Preparer", "Controller", "Treasury Analyst",

  // Engineering
  "Civil Engineer", "Mechanical Engineer", "Electrical Engineer", "Chemical Engineer",
  "Aerospace Engineer", "Industrial Engineer", "Structural Engineer", "Environmental Engineer",
  "Biomedical Engineer", "Petroleum Engineer", "Robotics Engineer", "Materials Engineer",
  "Mining Engineer", "Marine Engineer",

  // Information Technology
  "Cybersecurity Analyst", "System Analyst", "System Administrator", "Linux Administrator",
  "Network Administrator", "Database Administrator", "DevOps Engineer", "Cloud Engineer",
  "Software Engineer", "Backend Developer", "Frontend Developer", "Full-Stack Developer",
  "Mobile App Developer", "QA Engineer", "IT Support Specialist", "Site Reliability Engineer",
  "Data Engineer", "Machine Learning Engineer", "Solutions Architect", "IT Project Manager",
  "Network Engineer", "Penetration Tester", "IT Auditor", "ERP Consultant",

  // Data & Analytics
  "Data Scientist", "Data Analyst", "Business Intelligence Analyst", "Statistician",

  // Healthcare
  "Registered Nurse", "Physician", "Surgeon", "Dentist", "Pharmacist",
  "Physical Therapist", "Occupational Therapist", "Radiologic Technologist",
  "Medical Laboratory Technician", "Paramedic", "Nurse Practitioner", "Physician Assistant",
  "Nutritionist / Dietitian", "Mental Health Counselor", "Psychiatrist", "Psychologist",
  "Midwife", "Optometrist", "Chiropractor",

  // Legal
  "Corporate Lawyer", "Paralegal", "Litigation Attorney", "Legal Counsel",
  "Compliance Officer", "Patent Attorney", "Family Law Attorney", "Notary",

  // Education
  "Teacher", "School Administrator", "Curriculum Developer", "Special Education Teacher",
  "University Professor", "Academic Advisor", "Instructional Designer", "Tutor",

  // Marketing & Sales
  "Digital Marketer", "SEO Specialist", "Content Marketer", "Social Media Manager",
  "Sales Representative", "Account Executive", "Marketing Manager", "Brand Manager",
  "Public Relations Specialist", "Copywriter", "Growth Marketer",

  // Human Resources
  "Recruiter", "HR Generalist", "HR Business Partner", "Talent Acquisition Specialist",
  "Compensation & Benefits Analyst", "Learning & Development Specialist",

  // Design & Creative
  "Graphic Designer", "UX Designer", "UI Designer", "Product Designer",
  "Motion Graphics Designer", "Industrial Designer", "Interior Designer", "Fashion Designer",

  // Construction & Skilled Trades
  "Electrician", "Plumber", "Carpenter", "HVAC Technician", "Welder", "Mason",
  "Heavy Equipment Operator", "General Contractor", "Surveyor", "Roofer",

  // Operations & Management
  "Project Manager", "Product Manager", "Operations Manager", "Supply Chain Analyst",
  "Logistics Coordinator", "Procurement Specialist", "Business Analyst", "Management Consultant",
  "Quality Assurance Manager",

  // Hospitality & Tourism
  "Hotel Manager", "Chef", "Event Planner", "Travel Agent", "Tour Guide", "Restaurant Manager",
  "Bartender", "Sommelier",

  // Science & Research
  "Research Scientist", "Lab Technician", "Biologist", "Chemist", "Physicist",
  "Environmental Scientist", "Geologist", "Astronomer",

  // Government & Public Service
  "Policy Analyst", "Urban Planner", "Diplomat / Foreign Service Officer", "Social Worker",
  "Public Health Officer", "City Planner",

  // Real Estate
  "Real Estate Agent", "Property Manager", "Real Estate Appraiser", "Mortgage Broker",

  // Media & Journalism
  "Journalist", "Editor", "Broadcast Producer", "Photojournalist", "Video Editor",

  // Agriculture
  "Agronomist", "Farm Manager", "Veterinarian", "Veterinary Technician",

  // Transportation
  "Pilot", "Truck Driver", "Logistics Manager", "Air Traffic Controller", "Ship Captain",
] as const;
