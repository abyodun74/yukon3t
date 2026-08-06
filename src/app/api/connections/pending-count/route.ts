import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ count: 0 }, { status: 401 });
  }

  const count = await prisma.connection.count({
    where: { targetId: session.user.id, status: "PENDING" },
  });

  return NextResponse.json({ count });
}
