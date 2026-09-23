// One-off backfill: splits every existing multi-photo Post row (one row
// holding several mediaUrls, the old data model) into the new one-Post-per-
// photo shape createPost (actions/circles.ts) now writes going forward —
// see the albumId/albumIndex comment on the Post model in schema.prisma.
//
// The existing row is kept and mutated in place to become the album's lead
// (albumIndex 0): its id, and everything that already points at that id
// (likes, comments, reposts, shares, notifications, RSVPs) stays exactly
// where it is — only its own mediaUrls is trimmed down to just the first
// photo. A brand-new Post row is created for each additional photo, sharing
// the same albumId/authorId/circleId/channelId/visibility/feedCategory/
// moderationStatus/createdAt/eventAt/eventLocation as the original, with no
// caption (see createPost's own "first photo only" rule) and, necessarily,
// no history to inherit: engagement on a multi-photo post was never tracked
// per-photo before this, so it can't be reconstructed — every photo but the
// first starts at zero likes/comments/reposts/shares. This is the explicit,
// accepted tradeoff of running this script rather than leaving old
// multi-photo posts as they are.
//
// Safe to re-run: it only ever selects rows where mediaType = 'IMAGE' AND
// "albumId" IS NULL — a row already processed (albumId set, mediaUrls
// trimmed to 1) never matches again, and an ordinary single-photo post is
// selected but simply skipped (no albumId assigned to it either — this
// script only ever touches a post that actually has more than one photo).
//
// Usage:
//   npx tsx scripts/backfill-post-albums.ts
//     Dry run (the default): reports how many posts/photos would be
//     affected. Touches nothing.
//
//   npx tsx scripts/backfill-post-albums.ts --apply
//     Actually performs the split, one post at a time (each post's own
//     lead-update + sibling-creates run together in one transaction, so a
//     single post is never left half-migrated; a failure partway through
//     the whole run just leaves the remaining posts to catch on a re-run).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

function parseArgs(argv: string[]) {
  return { apply: argv.includes("--apply") };
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));

  // Not paginated: Prisma has no "array length > 1" filter, so every IMAGE
  // post without an albumId yet has to be fetched and checked in JS anyway
  // (most of them are ordinary single-photo posts that this then just
  // leaves alone) — batching that by a fixed page size would keep
  // re-fetching the same untouched single-photo rows forever, since they
  // never leave the WHERE clause. This app's post volume makes one query
  // for every not-yet-split IMAGE post entirely reasonable for a one-off,
  // manually-run script.
  const rows = await prisma.post.findMany({
    where: { mediaType: "IMAGE", albumId: null },
    select: {
      id: true,
      authorId: true,
      circleId: true,
      channelId: true,
      intentTag: true,
      visibility: true,
      feedCategory: true,
      mediaUrls: true,
      eventAt: true,
      eventLocation: true,
      moderationStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const multiPhoto = rows.filter((r) => r.mediaUrls.length > 1);

  console.log(
    `Scanned ${rows.length} IMAGE post(s) without an album yet — ${multiPhoto.length} have more than one photo.`,
  );

  let siblingsCreated = 0;
  for (const post of multiPhoto) {
    const [leadUrl, ...siblingUrls] = post.mediaUrls;
    console.log(
      `${apply ? "Splitting" : "[dry run] Would split"} post ${post.id} (author ${post.authorId}) — ${post.mediaUrls.length} photos`,
    );
    if (!apply) {
      siblingsCreated += siblingUrls.length;
      continue;
    }

    const albumId = randomUUID();
    await prisma.$transaction([
      prisma.post.update({
        where: { id: post.id },
        data: { albumId, albumIndex: 0, mediaUrls: [leadUrl] },
      }),
      ...siblingUrls.map((url, i) =>
        prisma.post.create({
          data: {
            authorId: post.authorId,
            circleId: post.circleId,
            channelId: post.channelId,
            content: "",
            intentTag: post.intentTag,
            visibility: post.visibility,
            feedCategory: post.feedCategory,
            mediaType: "IMAGE",
            mediaUrls: [url],
            eventAt: post.eventAt,
            eventLocation: post.eventLocation,
            moderationStatus: post.moderationStatus,
            createdAt: post.createdAt,
            albumId,
            albumIndex: i + 1,
          },
        }),
      ),
    ]);
    siblingsCreated += siblingUrls.length;
  }

  console.log(
    `\n${apply ? "Done." : "Dry run complete — nothing was changed."} ${multiPhoto.length} post(s) ${apply ? "split" : "would be split"}, ${siblingsCreated} new sibling post(s) ${apply ? "created" : "would be created"}.`,
  );
  if (!apply && multiPhoto.length > 0) {
    console.log("Re-run with --apply to actually perform this.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
