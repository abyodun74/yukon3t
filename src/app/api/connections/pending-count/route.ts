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

  const count = await prisma.connection.count({
    where: { targetId: user.id, status: "PENDING" },
  });

  return NextResponse.json({ count });
}
