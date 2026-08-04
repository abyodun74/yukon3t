"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

/** Blocking is a one-click safety action — no separate connection-request step, unlike everything else that touches another account. */
export async function blockUser(targetId: string) {
  const user = await requireUser();
  if (targetId === user.id) {
    return { error: "invalid" as const };
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) {
    return { error: "not_found" as const };
  }

  await prisma.$transaction([
    prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: user.id, blockedId: targetId } },
      create: { blockerId: user.id, blockedId: targetId },
      update: {},
    }),
    // Blocking severs any existing connection — otherwise the two would stay
    // "connected" (and able to call each other) while messaging is blocked.
    prisma.connection.deleteMany({
      where: {
        OR: [
          { requesterId: user.id, targetId },
          { requesterId: targetId, targetId: user.id },
        ],
      },
    }),
  ]);

  revalidatePath(`/u/${targetId}`);
  revalidatePath("/settings");
  revalidatePath("/connections");
  return { error: null };
}

export async function unblockUser(targetId: string) {
  const user = await requireUser();
  await prisma.block.deleteMany({ where: { blockerId: user.id, blockedId: targetId } });

  revalidatePath(`/u/${targetId}`);
  revalidatePath("/settings");
  return { error: null };
}

export async function listBlockedUsers() {
  const user = await requireUser();
  return prisma.block.findMany({
    where: { blockerId: user.id },
    orderBy: { createdAt: "desc" },
    include: { blocked: { select: { id: true, name: true, avatarUrl: true } } },
  });
}
