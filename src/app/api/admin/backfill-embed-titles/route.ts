import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updatePostEmbedding } from "@/lib/embeddings";
import { fetchEmbedTitle, type EmbedProvider } from "@/lib/video-embed";

// Admin maintenance endpoint, not a user-facing feature — POST-only,
// re-embeds every existing EMBED-type post using the same [content, video
// title] text new posts get at creation time (see createPost in
// actions/circles.ts). Exists because:
//  1. Posts made before that enrichment shipped only ever embedded their
//     (often sparse/absent) caption, so the smart category filter
//     (src/lib/feed-category.ts) has weaker signal for them than for new
//     posts.
//  2. The oEmbed title lookup at post-creation time is deliberately
//     best-effort/fail-open — a slow/down provider at the moment of
//     posting silently skips enrichment for that post, with no retry.
// Safe to re-run any time for either reason; each run just recomputes from
// current post content, no state to get out of sync.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });
  if (!me?.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const posts = await prisma.post.findMany({
    where: { mediaType: "EMBED", embedProvider: { not: null }, embedId: { not: null } },
    select: { id: true, content: true, embedProvider: true, embedId: true },
  });

  let updated = 0;
  const failures: string[] = [];
  for (const post of posts) {
    try {
      const title = await fetchEmbedTitle({
        provider: post.embedProvider as EmbedProvider,
        id: post.embedId!,
      });
      await updatePostEmbedding(post.id, [post.content, title].filter(Boolean).join("\n"));
      updated += 1;
    } catch {
      failures.push(post.id);
    }
  }

  return NextResponse.json({ total: posts.length, updated, failed: failures });
}
