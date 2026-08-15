import { timingSafeEqual } from "node:crypto";

/**
 * Shared authorization check for Netlify Scheduled Function cron endpoints —
 * a plain `===` on the secret would leak timing information proportional to
 * how many leading bytes match, so this compares equal-length buffers via
 * timingSafeEqual instead. Length is checked first (timingSafeEqual throws
 * on mismatched lengths rather than returning false).
 */
export function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  return headerBuf.length === expectedBuf.length && timingSafeEqual(headerBuf, expectedBuf);
}
