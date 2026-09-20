import { redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { CIRCLE_CATEGORIES } from "@/lib/circle-categories";
import { checkSubCircleParent } from "@/lib/circle-hierarchy";
import { NewCircleWizard } from "@/components/new-circle-wizard";
import { BackButton } from "@/components/back-button";

export default async function NewCirclePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; parent?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { error, parent: parentSlug } = await searchParams;

  // `?parent=<slug>` means "add a sub-circle to that main Circle". Only its
  // owner may (createCircle re-checks this — this is just so nobody is shown
  // a form that can't succeed).
  const parent = parentSlug
    ? await prisma.circle.findUnique({
        where: { slug: parentSlug },
        select: { id: true, name: true, slug: true, createdById: true, parentId: true, visibility: true },
      })
    : null;
  if (parentSlug && checkSubCircleParent(parent, me.id) !== "ok") {
    redirect("/circles");
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      {parent && <BackButton href={`/circles/${parent.slug}`} />}
      <h1 className="text-2xl font-semibold">{parent ? "Add a sub-circle" : "Start a Circle"}</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        {parent ? (
          <>
            A sub-circle of <span className="font-medium text-foreground">{parent.name}</span>, with its own members.
            Anyone can join it on its own{parent.visibility === "PRIVATE" ? ", by request" : ""}. You become its
            owner.
          </>
        ) : (
          "Free forever. You become the owner and first moderator."
        )}
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {error === "rate_limited"
            ? parent
              ? "You're creating sub-circles too fast — try again in an hour."
              : "You're creating Circles too fast — try again in an hour."
            : error === "moderation"
              ? "That name/description didn't pass our content guidelines."
              : error === "invalid_parent"
                ? "You can only add a sub-circle to a main Circle you own."
                : "Please check your inputs."}
        </p>
      )}

      <NewCircleWizard
        categories={CIRCLE_CATEGORIES}
        parentId={parent?.id}
        parentName={parent?.name}
        forcePrivate={parent?.visibility === "PRIVATE"}
      />
    </div>
  );
}
