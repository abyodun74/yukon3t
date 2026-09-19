// Sends VoIP pushes directly to Apple's APNs, entirely separate from
// Firebase — Firebase's own send API has no way to set the "voip" APNs
// push type PushKit requires, so this bypasses it for this one
// notification kind. Reuses the same token-based APNs auth key already
// registered with Firebase for every other push type (Cloud Messaging →
// Apple app configuration) — a .p8 auth key isn't tied to one delivery
// path, it's just a credential for signing requests to Apple, whether
// Firebase does that signing internally or this file does it directly.
import { createSign } from "node:crypto";
import http2 from "node:http2";
import { prisma } from "@/lib/prisma";

// Same bundle ID as capacitor.config.ts's appId / ios/App/App's actual
// target — VoIP pushes go to "<bundle-id>.voip", not the plain bundle ID
// topic regular APNs pushes use.
const BUNDLE_ID = "com.yukon3t.app";
const APNS_HOST = "https://api.push.apple.com";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedToken: { jwt: string; issuedAt: number } | null = null;

// Apple allows (and expects) a provider token to be reused for up to an
// hour, and separately rate-limits *frequent* token generation for the
// same key — caching avoids both re-signing on every single call and
// risking that limit under a burst of calls.
const TOKEN_TTL_SECONDS = 50 * 60;

function buildProviderToken(): string | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  // Vercel/Netlify env var UIs generally can't hold a literal multi-line
  // value cleanly — stored with escaped \n sequences instead, same
  // convention most APNs/service-account key env vars use elsewhere.
  const privateKey = process.env.APNS_AUTH_KEY?.replace(/\\n/g, "\n");
  if (!keyId || !teamId || !privateKey) return null;

  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedToken.issuedAt < TOKEN_TTL_SECONDS) {
    return cachedToken.jwt;
  }

  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: now }));
  try {
    const signer = createSign("SHA256");
    signer.update(`${header}.${payload}`);
    // APNs requires the raw IEEE-P1363 (R||S) signature format, not the
    // DER encoding Node's crypto produces by default for ECDSA — passing
    // dsaEncoding here avoids having to convert one to the other by hand.
    const signature = base64url(signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" }));
    const jwt = `${header}.${payload}.${signature}`;
    cachedToken = { jwt, issuedAt: now };
    return jwt;
  } catch (err) {
    // A malformed APNS_AUTH_KEY (e.g. a dashboard UI collapsing the
    // pasted newlines) must never take startCall down with it — every
    // other sender in this app (fcm.ts, push.ts) is best-effort too.
    console.log("[voip-debug] failed to sign provider token", { err: String(err) });
    return null;
  }
}

export function isVoipPushConfigured() {
  return Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_AUTH_KEY);
}

/**
 * Sends one VoIP push to a single device token, resolving the APNs HTTP
 * status (0 on a connection-level failure, never throws) — the caller
 * decides what a given status means (200 = delivered; 400/410 mean the
 * token itself is bad/expired and should be pruned).
 */
async function sendVoipPushRaw(deviceToken: string, payload: Record<string, unknown>): Promise<number> {
  const jwt = buildProviderToken();
  if (!jwt) return 0;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: number) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const client = http2.connect(APNS_HOST);
    client.on("error", () => finish(0));

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": `${BUNDLE_ID}.voip`,
      "apns-push-type": "voip",
      "apns-priority": "10",
      "apns-expiration": "0",
      "content-type": "application/json",
    });

    let status = 0;
    req.on("response", (headers) => {
      status = Number(headers[":status"]) || 0;
    });
    req.on("error", () => finish(0));
    req.on("end", () => {
      client.close();
      finish(status);
    });

    req.end(JSON.stringify(payload));
  });
}

export type VoipIncomingCallPayload = {
  callId: string;
  callerName: string;
  callType: "AUDIO" | "VIDEO";
};

/**
 * Sends a VoIP push to every iOS device registered for a user, reporting
 * the incoming call — the counterpart to sendFcmCallToUser (src/lib/fcm.ts)
 * for the one platform/notification-kind Firebase can't carry. Best-effort,
 * same contract as every other call-notification sender in this app: never
 * throws, a send failure here should never fail startCall itself, which
 * already has its own web-push and FCM paths for this same ring.
 */
export async function sendVoipCallToUser(userId: string, payload: VoipIncomingCallPayload) {
  // TEMPORARY diagnostic logging while verifying this feature on real
  // hardware for the first time — same pattern as fcm.ts's [fcm-debug]
  // lines. Remove once confirmed reliable.
  if (!isVoipPushConfigured()) {
    console.log("[voip-debug] not configured, skipping send", { userId });
    return;
  }

  const tokens = await prisma.voipPushToken.findMany({ where: { userId } });
  console.log("[voip-debug] tokens found", { userId, count: tokens.length });
  if (tokens.length === 0) return;

  const staleTokenIds: string[] = [];
  await Promise.all(
    tokens.map(async (t) => {
      const status = await sendVoipPushRaw(t.token, {
        aps: { alert: "" },
        type: "incoming_call",
        callId: payload.callId,
        callerName: payload.callerName,
        callType: payload.callType,
      });
      console.log("[voip-debug] send result", { userId, tokenSuffix: t.token.slice(-8), status });
      // 400 = BadDeviceToken, 410 = Unregistered — either way this exact
      // token is never going to work again, unlike a transient 5xx/0.
      if (status === 400 || status === 410) staleTokenIds.push(t.id);
    }),
  );
  if (staleTokenIds.length > 0) {
    await prisma.voipPushToken.deleteMany({ where: { id: { in: staleTokenIds } } }).catch(() => {});
  }
}

/**
 * Tells a still-ringing iOS device's CallKit UI to dismiss itself — the
 * caller hung up (or the call otherwise stopped ringing) before this
 * device's user answered. Without this, a CXProvider-reported call has no
 * other way to find out the call it's displaying is gone; the counterpart
 * to sendFcmCallCancelToUser (src/lib/fcm.ts).
 */
export async function sendVoipCallCancelToUser(userId: string, callId: string) {
  if (!isVoipPushConfigured()) return;

  const tokens = await prisma.voipPushToken.findMany({ where: { userId } });
  if (tokens.length === 0) return;

  await Promise.all(
    tokens.map((t) =>
      sendVoipPushRaw(t.token, { aps: { alert: "" }, type: "call_cancelled", callId }),
    ),
  );
}
