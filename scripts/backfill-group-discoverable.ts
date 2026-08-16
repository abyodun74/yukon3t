// One-off backfill: flips every existing group chat to discoverable so
// nothing created before "Make this group discoverable" defaulted to
// checked (see the New Group form) is stuck invisible on /messages/discover.
// New groups already default to discoverable at creation — this only
// touches rows that predate that default. Anyone can still opt back out
// per-group afterward via setGroupDiscoverable (the group's own settings).
// Run with:
//   npx tsx scripts/backfill-group-discoverable.ts
//
// Safe to re-run: it only ever updates rows where discoverable is false.

import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  const result = await prisma.conversation.updateMany({
    where: { isGroup: true, discoverable: false },
    data: { discoverable: true },
  });
  console.log(`Flipped ${result.count} group chat(s) to discoverable.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
