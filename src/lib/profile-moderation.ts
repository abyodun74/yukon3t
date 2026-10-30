/**
 * The profile text that has to pass the moderation gate before it is saved (audit M5, 2026-10-29): the bio whenever
 * there is one (as before), plus the display name when it is new or changed — the name is shown on every surface and
 * in push notifications. An unchanged name isn't re-checked, so editing only the bio never trips on an old name.
 * Returns "" when there is nothing to check.
 */
export function profileTextToModerate(name: string, currentName: string | null | undefined, bio: string | null | undefined): string {
  const parts: string[] = [];
  const trimmedName = name.trim();
  if (trimmedName && trimmedName !== (currentName ?? "").trim()) parts.push(trimmedName);
  if (bio && bio.trim()) parts.push(bio);
  return parts.join("\n");
}
