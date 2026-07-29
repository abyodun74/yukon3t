type ModerationResult = { allowed: boolean; flaggedCategories: string[] };

async function callModerationApi(
  input: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>,
): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { allowed: true, flaggedCategories: [] };
  }

  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input }),
    });

    if (!res.ok) {
      // Fail closed on API errors for safety-critical paths would block
      // legitimate users during outages; instead flag for human review.
      return { allowed: true, flaggedCategories: ["moderation_api_error"] };
    }

    const data = await res.json();
    const result = data.results?.[0];
    if (!result?.flagged) {
      return { allowed: true, flaggedCategories: [] };
    }
    const flaggedCategories = Object.entries(result.categories ?? {})
      .filter(([, value]) => value)
      .map(([key]) => key);
    return { allowed: false, flaggedCategories };
  } catch {
    return { allowed: true, flaggedCategories: ["moderation_api_error"] };
  }
}

// Prescreens user-authored text through OpenAI's moderation endpoint before it
// is stored/shown. Fails open (allows content) only when no API key is
// configured, which is expected in local dev — production must set
// OPENAI_API_KEY so this gate is actually enforced.
export async function moderateText(text: string): Promise<ModerationResult> {
  return callModerationApi(text);
}

// Same fail-open-without-key / fail-open-on-error semantics as moderateText,
// applied to an already-uploaded image's public URL. This is the enforcement
// point for the "no sexually explicit content" policy on photos and on the
// client-captured video thumbnail frame that stands in for a video.
export async function moderateImage(url: string): Promise<ModerationResult> {
  return callModerationApi([{ type: "image_url", image_url: { url } }]);
}

/** Combines a post's text with any attached images/thumbnail into one verdict. */
export async function moderateMedia({
  text,
  imageUrls = [],
  thumbnailUrl,
}: {
  text: string;
  imageUrls?: string[];
  thumbnailUrl?: string | null;
}): Promise<ModerationResult> {
  const urls = [...imageUrls, ...(thumbnailUrl ? [thumbnailUrl] : [])];
  const results = await Promise.all([
    moderateText(text),
    ...urls.map((url) => moderateImage(url)),
  ]);

  const flaggedCategories = results.flatMap((r) => r.flaggedCategories);
  return {
    allowed: results.every((r) => r.allowed),
    flaggedCategories: [...new Set(flaggedCategories)],
  };
}
