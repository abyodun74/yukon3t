const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;

export const isLinkSafetyCheckConfigured = !!apiKey;

export type LinkSafetyResult = {
  status: "safe" | "flagged" | "unknown";
  threatTypes?: string[];
};

/**
 * Google Safe Browsing v4 Lookup API — checks a URL against Google's
 * continuously-updated malware/phishing/unwanted-software lists in real
 * time. Deliberately checked at click time, not once when the post is
 * created: unlike this app's other moderation (a photo or video's content
 * never changes after upload), a URL's safety status is time-varying — a
 * domain can be compromised or weaponized well after a post goes up, so a
 * one-time check at post time would give viewers a false sense of security
 * on an old post. No key configured, or an outage, degrades to "unknown"
 * rather than blocking navigation — same best-effort contract as
 * isGiphyConfigured()/searchGifs() (see src/lib/giphy.ts).
 */
export async function checkLinkSafety(url: string): Promise<LinkSafetyResult> {
  if (!apiKey) return { status: "unknown" };

  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "yukon3t", clientVersion: "1.0.0" },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }],
          },
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return { status: "unknown" };

    const data: { matches?: { threatType: string }[] } = await res.json();
    if (data.matches && data.matches.length > 0) {
      return { status: "flagged", threatTypes: [...new Set(data.matches.map((m) => m.threatType))] };
    }
    return { status: "safe" };
  } catch {
    return { status: "unknown" };
  }
}
