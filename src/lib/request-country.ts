import { headers } from "next/headers";

/**
 * The visitor's country (ISO 3166-1 alpha-2, upper-case) from the hosting platform's geo headers, or null: Vercel
 * sets `x-vercel-ip-country`; Netlify sets `x-country` and `x-nf-geo` (base64 JSON, `{ country: { code } }`). Only a
 * hint for defaults such as the phone field's country selector — never trust it for anything that matters.
 */
export function countryFromGeoHeaders(get: (name: string) => string | null): string | null {
  const direct = normalize(get("x-vercel-ip-country")) ?? normalize(get("x-country"));
  if (direct) return direct;
  const geo = get("x-nf-geo");
  if (!geo) return null;
  try {
    const parsed = JSON.parse(Buffer.from(geo, "base64").toString("utf8")) as { country?: { code?: unknown } };
    return normalize(parsed.country?.code);
  } catch {
    return null;
  }
}

function normalize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export async function getRequestCountry(): Promise<string | null> {
  const h = await headers();
  return countryFromGeoHeaders((name) => h.get(name));
}
