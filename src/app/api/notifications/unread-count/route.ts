import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ count: 0 }, { status: 401 });
  }

  const count = await prisma.notification.count({
    where: { recipientId: session.user.id, readAt: null },
  });

  return NextResponse.json({ count });
}
