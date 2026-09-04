// Plain wordlist match over a video's transcribed audio (see video-review.ts)
// — OpenAI's moderation endpoint (moderation.ts) doesn't have a profanity
// category at all, only harm categories (harassment/hate/violence/self-harm/
// sexual/illicit), so mere cursing with no other violation slips straight
// through it. This exists to catch exactly that gap, nothing else.
const PROFANITY_WORDS = [
  "fuck",
  "fucking",
  "fucker",
  "motherfucker",
  "shit",
  "bullshit",
  "bitch",
  "bastard",
  "asshole",
  "ass",
  "dick",
  "dickhead",
  "piss",
  "pissed",
  "cunt",
  "cock",
  "prick",
  "twat",
  "wanker",
  "slut",
  "whore",
  "nigger",
  "nigga",
  "faggot",
  "fag",
  "retard",
  "retarded",
  "spic",
  "chink",
  "kike",
  "tranny",
  "coon",
];

// A few common leetspeak/spacing dodges — deliberately shallow (not trying
// to defeat determined obfuscation, just the casual "sh1t"/"f u c k" cases a
// real transcript is likely to contain verbatim from spoken audio anyway).
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/[^a-z\s]/g, " ");
}

export function containsProfanity(text: string): { flagged: boolean; matches: string[] } {
  const normalized = normalize(text);
  const matches = PROFANITY_WORDS.filter((word) => new RegExp(`\\b${word}\\b`).test(normalized));
  return { flagged: matches.length > 0, matches };
}
