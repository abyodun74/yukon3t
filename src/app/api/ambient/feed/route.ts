import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";

/**
 * The actual surface a future native widget/watch app would poll — see
 * AmbientWidgetToken's schema doc comment and generateAmbientWidgetToken
 * (actions/ambient.ts) for why this uses its own bearer token instead of
 * the normal session cookie: a widget extension process has no access to
 * the main app's browser session at all, and even if it did, a credential
 * meant to sit in a widget's own storage long-term should be narrowly
 * scoped — this route can only ever return a small, read-only slice of
 * content (one user's inner-circle ambient moments), nothing else.
 *
 * No native consumer exists yet (see the schema doc comments across
 * InnerCircleMember/AmbientMoment/AmbientWidgetToken) — this route is the
 * groundwork a future one would be built against.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : null;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Keyed by the token itself (not a user id, which isn't known until the
  // lookup below succeeds) — bounds brute-force guessing of a valid token
  // the same way every other secret-bearing endpoint in this app is
  // defended, without needing to know who's guessing first.
  const ip = await getClientIp();
  const allowed = await checkRateLimit("ambientWidgetToken", `feed:${ip}`);
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const widgetToken = await prisma.ambientWidgetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!widgetToken || widgetToken.revokedAt) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fire-and-forget — a future widget polls this on its own schedule, so
  // this is the only signal this app has for "is this token actually still
  // in use," surfaced on the settings page (getAmbientWidgetTokenStatus).
  prisma.ambientWidgetToken
    .update({ where: { id: widgetToken.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  const members = await prisma.innerCircleMember.findMany({
    where: { ownerId: widgetToken.userId },
    select: { memberId: true },
  });
  const memberIds = members.map((m) => m.memberId);
  if (memberIds.length === 0) {
    return NextResponse.json({ moments: [] });
  }

  const moments = await prisma.ambientMoment.findMany({
    where: { authorId: { in: memberIds }, moderationStatus: "PUBLISHED", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    // A widget timeline is a handful of recent entries, not a scrollable
    // feed — generous enough to cover an inner circle all posting around
    // the same time, far short of anything worth paginating.
    take: 20,
    select: {
      id: true,
      imageUrl: true,
      caption: true,
      createdAt: true,
      author: { select: { id: true, name: true, username: true, avatarUrl: true } },
    },
  });

  return NextResponse.json({ moments });
}
