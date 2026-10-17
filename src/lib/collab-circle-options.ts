import { prisma } from "@/lib/prisma";
import { plural, type Locale } from "@/lib/i18n/locales";

/**
 * The "Invite a Circle" picker's options on a collab's create form and its page: only Circles `userId` created (the
 * rule expandCircleInvites enforces), labelled "Name (N members)", a sub-circle as "Main › Sub" like getMyCircles'
 * pickers. A main Circle's option invites its own members only, not its sub-circles'.
 */
export async function getOwnedCircleOptions(userId: string, locale: Locale, memberCountForms: string) {
  const circles = await prisma.circle.findMany({
    where: { createdById: userId },
    select: { id: true, name: true, parent: { select: { name: true } }, _count: { select: { members: true } } },
  });
  return circles
    .map((c) => ({
      value: c.id,
      name: c.parent ? `${c.parent.name} › ${c.name}` : c.name,
      members: c._count.members,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale))
    .map((c) => ({ value: c.value, label: `${c.name} (${plural(locale, memberCountForms, c.members)})` }));
}
