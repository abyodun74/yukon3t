import { redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { CIRCLE_CATEGORIES } from "@/lib/circle-categories";
import { checkSubCircleParent } from "@/lib/circle-hierarchy";
import { NewCircleWizard } from "@/components/new-circle-wizard";
import { BackButton } from "@/components/back-button";
import { vocabName } from "@/lib/i18n/language-names";
import { aroundPlaceholder, byCode } from "@/lib/i18n/locales";
import { getDictionary } from "@/lib/i18n/server";
import { GuestGatedScreen } from "@/components/guest-preview";

export default async function NewCirclePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; parent?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  // Members only: a guest preview session (src/lib/guest-preview.ts) sees why, and how to join.
  if (me.isGuestPreview) return <GuestGatedScreen kind="create" />;
  const { error, parent: parentSlug } = await searchParams;
  const dictionary = await getDictionary();
  const t = dictionary.circles.create;

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

  const [subIntroBefore, subIntroAfter] = aroundPlaceholder(
    parent?.visibility === "PRIVATE" ? t.subIntroPrivate : t.subIntro,
    "name",
  );
  // The stored value is the English name; only the label a category is shown under follows the reader's language
  // (the job titles among them are shown as stored).
  const categoryOptions = CIRCLE_CATEGORIES.map((category) => ({
    value: category,
    label: vocabName(category, dictionary.vocab.circleCategories),
  }));

  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      {parent && <BackButton href={`/circles/${parent.slug}`} />}
      <h1 className="text-2xl font-semibold">{parent ? t.subTitle : t.title}</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        {parent ? (
          <>
            {subIntroBefore}
            <bdi className="font-medium text-foreground">{parent.name}</bdi>
            {subIntroAfter}
          </>
        ) : (
          t.intro
        )}
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {byCode(t.errors, error === "rate_limited" && parent ? "rate_limited_sub" : error)}
        </p>
      )}

      <NewCircleWizard
        categories={categoryOptions}
        parentId={parent?.id}
        parentName={parent?.name}
        forcePrivate={parent?.visibility === "PRIVATE"}
      />
    </div>
  );
}
