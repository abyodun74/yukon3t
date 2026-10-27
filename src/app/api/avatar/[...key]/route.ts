import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBlockedEitherWay } from "@/lib/blocks";
import { isAvatarBucketConfigured } from "@/lib/storage";
import { avatarObjectExists, presignAvatarForViewer } from "@/lib/avatar-storage";
import { avatarNeedsFullSizeCheck, avatarServedObject, parseAvatarRouteSegments } from "@/lib/avatar-url";

// Every non-redirect answer: never cached, so a later sign-in (or an unblock) isn't stuck behind it.
const NO_STORE = { "Cache-Control": "no-store" };

// The missing-bucket error is logged once per server instance: every avatar request would hit it.
let reportedMissingBucket = false;

function refuse(status: 401 | 404 | 429 | 503) {
  return new NextResponse(null, {
    status,
    headers: status === 429 ? { ...NO_STORE, "Retry-After": "60" } : NO_STORE,
  });
}

/**
 * GET /api/avatar/<ownerId>/<uuid>[-t].<ext>[?size=full] — a private profile picture (see src/lib/avatar-url.ts).
 *
 * Signed-in users only (the session JWT; no database read for that). Answers with a 302 to a presigned R2 GET: the
 * image bytes never pass through this server. The presigned URL is signed as of the start of the hour, so it is the
 * same URL for the whole hour and the browser caches the image; the redirect itself is cached privately for 50
 * minutes, less than the link's remaining life. `?size=full` gets the full-size image only for the owner and their
 * accepted connections; anyone else is redirected to the thumbnail instead (not refused). Someone blocked either way
 * gets a 404, like an avatar that doesn't exist.
 *
 * A qualifying `?size=full` request (and only that, never a thumbnail) first HEADs the full-size object; if it is
 * missing, or the HEAD fails, the viewer is redirected to the thumbnail instead, with a 60-second max-age so a repair
 * or re-upload shows up quickly. If the avatar bucket (R2_AVATAR_BUCKET_NAME) isn't configured the answer is a 503
 * (after the 401 for signed-out requests), logged once per server instance.
 *
 * The path ends in an image extension, so src/proxy.ts's matcher skips it: a feed's ~20 avatars don't count against
 * the page rate limit. This route's own per-user limiter (avatarView) applies instead.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const target = parseAvatarRouteSegments((await params).key);
  if (!target) return refuse(404);

  const session = await auth();
  const viewerId = session?.user?.id;
  if (!viewerId) return refuse(401);

  if (!isAvatarBucketConfigured()) {
    if (!reportedMissingBucket) {
      reportedMissingBucket = true;
      console.error("[avatar] R2_AVATAR_BUCKET_NAME is not configured");
    }
    return refuse(503);
  }
  // A guest preview session counts under its own session id: every guest shares one user id (src/lib/guest-preview.ts).
  const limiterKey = session?.user?.isGuest ? `guest:${session.guestSessionId ?? "unknown"}` : viewerId;
  if (!(await checkRateLimit("avatarView", limiterKey))) return refuse(429);

  const wantFull = request.nextUrl.searchParams.get("size") === "full";
  const isOwner = viewerId === target.ownerId;
  let isConnection = false;

  if (!isOwner) {
    // Only a two-size avatar's full image needs the connection check; everything else is one query (the block).
    const needsConnection = wantFull && target.twoSize;
    const [blocked, connection] = await Promise.all([
      isBlockedEitherWay(viewerId, target.ownerId),
      needsConnection
        ? prisma.connection.findFirst({
            where: {
              status: "ACCEPTED",
              OR: [
                { requesterId: viewerId, targetId: target.ownerId },
                { requesterId: target.ownerId, targetId: viewerId },
              ],
            },
            select: { id: true },
          })
        : null,
    ]);
    if (blocked) return refuse(404);
    isConnection = Boolean(connection);
  }

  const viewer = { wantFull, isOwner, isConnection };
  let fullExists = true;
  if (avatarNeedsFullSizeCheck(target, viewer)) {
    fullExists = await avatarObjectExists(target.fullKey);
    if (!fullExists) console.warn("[avatar] full-size object missing", { key: target.fullKey });
  }
  const served = avatarServedObject(target, viewer, fullExists);

  let location: string;
  try {
    location = await presignAvatarForViewer(served.key);
  } catch (err) {
    console.error("[avatar] failed to sign avatar redirect", err);
    return refuse(503);
  }

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": `private, max-age=${served.maxAgeSeconds}`,
      "Referrer-Policy": "no-referrer",
    },
  });
}
