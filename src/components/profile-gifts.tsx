"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gift } from "lucide-react";
import { GiftArt } from "@/components/gift-art";
import { GiftOpenOverlay } from "@/components/gift-open-overlay";
import { GiftPickerSheet, type GiftPickerPlace } from "@/components/gift-picker-sheet";
import { useGiftsText } from "@/components/gifts-text";
import { ReportModal } from "@/components/report-form";
import { equipGift, hideGift, openGift, unequipGift, type OpenedGift } from "@/app/actions/gifts";
import { giftItemName, giftProductName } from "@/lib/gift-names";
import { format } from "@/lib/i18n/locales";
import type { ProfileGiftsView } from "@/lib/gift-profile";

/**
 * "Send a gift" for a profile, a chat header or a live room. Rendered only where giftsEnabledFor is on for the viewer
 * (and the recipient): the caller decides, createGiftIntent enforces it again.
 */
export function SendGiftButton({
  recipientId,
  recipientName,
  place,
  label,
  className,
  iconOnly = false,
}: {
  recipientId: string;
  recipientName: string | null;
  place: GiftPickerPlace;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const { t } = useGiftsText();
  const [open, setOpen] = useState(false);
  const text = label ?? t.send;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={iconOnly ? text : undefined}
        title={iconOnly ? text : undefined}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
        }
      >
        <Gift size={16} aria-hidden />
        {!iconOnly && <span>{text}</span>}
      </button>
      <GiftPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        recipientId={recipientId}
        recipientName={recipientName}
        place={place}
      />
    </>
  );
}

/** The badge worn next to the profile name, with its name for screen readers and as a tooltip. */
export function ProfileGiftBadge({ badge }: { badge: { slug: string; assetKey: string } }) {
  const { t } = useGiftsText();
  const name = giftItemName(t, badge.slug);
  const label = format(t.profile.badgeLabel, { name });
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 align-middle">
      <GiftArt assetKey={badge.assetKey} name={name} size={22} eager />
    </span>
  );
}

/** The frame's accessible name, for the element that wraps the avatar it is drawn around. */
export function ProfileFrameLabel({ frame }: { frame: { slug: string } }) {
  const { t } = useGiftsText();
  return <span className="sr-only">{format(t.profile.frameLabel, { name: giftItemName(t, frame.slug) })}</span>;
}

/**
 * The profile's Gifts area (#gifts). Its owner sees every delivered gift (new ones first to open), who sent each, and
 * can open, hide or report one, and wear or take off a frame or badge they own. A visitor sees only opened gifts and
 * never who sent them.
 */
export function ProfileGiftsSection({ view, isOwner }: { view: ProfileGiftsView; isOwner: boolean }) {
  const { locale, dir, t } = useGiftsText();
  const router = useRouter();
  const [opened, setOpened] = useState<OpenedGift | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ error: string | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) {
          setError((t.errors as Record<string, string>)[result.error] ?? t.errors.other);
          return;
        }
        after?.();
        router.refresh();
      } catch {
        setError(t.errors.other);
      }
    });
  }

  function open(sendId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await openGift(sendId);
        if (result.error) {
          setError((t.errors as Record<string, string>)[result.error] ?? t.errors.other);
          return;
        }
        setOpened(result.gift);
      } catch {
        setError(t.errors.other);
      }
    });
  }

  if (!isOwner && view.gifts.length === 0) return null;

  return (
    <section id="gifts" lang={locale} dir={dir} className="mt-8 scroll-mt-20" aria-labelledby="profile-gifts-heading">
      <h2 id="profile-gifts-heading" className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
        {t.profile.heading}
      </h2>
      {isOwner && <p className="mt-1 text-xs text-foreground-soft">{t.profile.ownerHint}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {isOwner && view.wearable.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {view.wearable.map((item) => {
            const wearing = (item.kind === "FRAME" ? view.frame : view.badge)?.slug === item.slug;
            const name = giftItemName(t, item.slug);
            return (
              <li key={item.slug} className="flex items-center gap-2 rounded-xl border border-line px-2 py-1.5 text-xs">
                <GiftArt assetKey={item.assetKey} name={name} size={28} />
                <span>
                  <span className="block font-medium">{name}</span>
                  <span className="block text-foreground-soft">{t.kinds[item.kind]}</span>
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  aria-pressed={wearing}
                  aria-label={`${wearing ? t.profile.takeOff : t.profile.wear}: ${name}`}
                  onClick={() =>
                    run(() => (wearing ? unequipGift(item.kind as "FRAME" | "BADGE") : equipGift(item.slug)))
                  }
                  className={`rounded-full px-2.5 py-1 font-semibold ${
                    wearing ? "bg-accent text-accent-ink" : "border border-line hover:border-accent"
                  }`}
                >
                  {wearing ? t.profile.wearing : t.profile.wear}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {view.gifts.length === 0 ? (
        <p className="mt-3 text-sm text-foreground-soft">{t.profile.empty}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {view.gifts.map((gift) => {
            const name = giftProductName(t, { sku: gift.productSku, isBox: gift.isBox, items: gift.items });
            const isNew = gift.status === "DELIVERED";
            return (
              <li key={gift.sendId} className="flex flex-col items-center gap-1 rounded-xl border border-line p-2 text-center text-xs">
                <span className="flex -space-x-3 rtl:space-x-reverse">
                  {gift.items.slice(0, 3).map((item, i) => (
                    <GiftArt key={`${item.slug}-${i}`} assetKey={item.assetKey} name={giftItemName(t, item.slug)} size={36} />
                  ))}
                </span>
                <span className="font-medium">{name}</span>
                {isOwner && gift.sender && (
                  <span className="text-foreground-soft">
                    {gift.sender === "deleted"
                      ? t.profile.fromDeleted
                      : format(t.profile.from, { name: gift.sender.name ?? t.open.fromSomeone })}
                  </span>
                )}
                {isOwner && (
                  <span className="mt-1 flex flex-wrap justify-center gap-1">
                    {isNew && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => open(gift.sendId)}
                        className="rounded-full bg-accent px-2.5 py-1 font-semibold text-accent-ink"
                      >
                        {t.profile.open}
                        <span className="sr-only">: {name}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => run(() => hideGift(gift.sendId))}
                      className="rounded-full border border-line px-2.5 py-1 hover:border-accent"
                    >
                      {t.profile.hide}
                      <span className="sr-only">: {name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReporting(gift.sendId)}
                      className="rounded-full border border-line px-2.5 py-1 hover:border-danger hover:text-danger"
                    >
                      {t.profile.report}
                      <span className="sr-only">: {name}</span>
                    </button>
                  </span>
                )}
                {isOwner && isNew && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold">{t.profile.newGift}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <GiftOpenOverlay
        gift={opened}
        onClose={() => {
          setOpened(null);
          router.refresh();
        }}
      />
      {isOwner && (
        <ReportModal
          targetType="GIFT"
          targetId={reporting ?? ""}
          open={reporting !== null}
          onClose={() => setReporting(null)}
        />
      )}
    </section>
  );
}
