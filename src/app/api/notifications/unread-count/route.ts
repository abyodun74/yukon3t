import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, AuthError } from "@/lib/auth-guards";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ count: 0 }, { status: 401 });
    }
    throw err;
  }

  const count = await prisma.notification.count({
    where: { recipientId: user.id, readAt: null },
  });

  return NextResponse.json({ count });
}
