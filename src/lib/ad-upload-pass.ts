import { encode, decode } from "next-auth/jwt";

// The public /advertise booking is two calls: requestAdUpload (mints the presigned PUTs) and, after the browser has
// uploaded, createAdCampaign. Turnstile runs on the FIRST one (an unauthenticated presign is what needed the bot check:
// audit H4) and a token is single-use, so that call hands back this pass: an Auth.js-encoded token under its own salt
// (same pattern as hidden-unlock-token.ts), naming the exact object keys it minted. createAdCampaign accepts the pass
// in place of a second Turnstile token, and only for those keys. One human check per booking, as before.

export const AD_UPLOAD_PASS_SALT = "yukon3t.ad-upload-pass";
/** Covers the longest ad upload (AD_VIDEO_UPLOAD_URL_TTL_SECONDS) plus filling in the rest of the form. */
export const AD_UPLOAD_PASS_MAX_AGE_SECONDS = 2 * 60 * 60;

export function encodeAdUploadPass(keys: string[], secret: string): Promise<string> {
  return encode({
    token: { keys },
    secret,
    salt: AD_UPLOAD_PASS_SALT,
    maxAge: AD_UPLOAD_PASS_MAX_AGE_SECONDS,
  });
}

/** True only for an unexpired, untampered pass that names every one of `keys`. */
export async function verifyAdUploadPass(token: unknown, keys: string[], secret: string): Promise<boolean> {
  if (typeof token !== "string" || token.length === 0 || token.length > 4000 || keys.length === 0) return false;
  try {
    const payload = await decode({ token, secret, salt: AD_UPLOAD_PASS_SALT });
    const granted = Array.isArray(payload?.keys) ? (payload.keys as unknown[]) : [];
    return keys.every((k) => granted.includes(k));
  } catch {
    return false;
  }
}
