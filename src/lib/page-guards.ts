import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** For server components/pages: redirects to /sign-in when not authenticated. */
export async function getSessionUserOrRedirect() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.status !== "ACTIVE") {
    redirect("/sign-in");
  }
  return user;
}

function isProfileComplete(user: { name: string | null; country: string | null; interests: string[] }) {
  return Boolean(user.name && user.country && user.interests.length > 0);
}

/** Like getSessionUserOrRedirect, but also forces onboarding completion first. */
export async function getOnboardedUserOrRedirect() {
  const user = await getSessionUserOrRedirect();
  if (!isProfileComplete(user)) {
    redirect("/onboarding");
  }
  return user;
}

export { isProfileComplete };
