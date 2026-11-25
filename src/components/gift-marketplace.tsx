"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { Heart, History, Search, SlidersHorizontal, X } from "lucide-react";
import { GiftStage, useLowEndDevice } from "@/components/gift-stage";
import { GiftReveal, useGiftRevealClose } from "@/components/gift-reveal";
import { CoinAmount, CoinMark } from "@/components/coin-amount";
import { GiftMarketFilterSheet } from "@/components/gift-market-filter-sheet";
import { GiftMarketSendSheet } from "@/components/gift-market-send-sheet";
import { useGiftsText } from "@/components/gifts-text";
import { setGiftFavorite } from "@/app/actions/gift-market";
import { formatCoins } from "@/lib/coins";
import { prefetchGiftReveal } from "@/lib/gift-render-capability";
import { giftProductDescription, giftProductName } from "@/lib/gift-names";
import {
  DEFAULT_MARKET_FILTERS,
  GIFT_CATEGORIES,
  activeFilterCount,
  applyMarket,
  categorySlug,
  marketEmptyState,
  type GiftCategoryName,
  type MarketFilters,
  type MarketGift,
} from "@/lib/gift-market";
import { format } from "@/lib/i18n/locales";

/**
 * The gift marketplace (home and category pages): header with the coin balance, search, a banner, the category
 * row, featured gifts, the filter sheet and the grid (2 columns on phones, 3 on tablets, 4-5 on desktops). Tapping a
 * gift opens its preview: the recipient's own reveal (GiftReveal) with a labelled sample sender and note, full screen
 * on a phone, an expanded stage on a tablet, a large panel on a desktop. Previewing buys, sends and charges nothing.
 * Send (once the preview has closed) opens the recipient + checkout sheet. Search, filters and sort only change what is
 * shown (src/lib/gift-market.ts); prices and totals are always the server's at send time.
 */
export function GiftMarketplace({
  gifts,
  initialFavorites,
  initialBalance,
  category,
}: {
  gifts: MarketGift[];
  initialFavorites: string[];
  initialBalance: number;
  /** A category page: only this category, no banner or featured row. */
  category: GiftCategoryName | null;
}) {
  const { locale, t } = useGiftsText();
  const m = t.market;
  const reduce = useReducedMotion() ?? false;
  const lowEnd = useLowEndDevice();
  const [balance, setBalance] = useState(initialBalance);
  const [favorites, setFavorites] = useState(() => new Set(initialFavorites));
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<MarketFilters>({ ...DEFAULT_MARKET_FILTERS, categories: category ? [category] : [] });
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [previewSku, setPreviewSku] = useState<string | null>(null);
  const [sendSku, setSendSku] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const bySku = useMemo(() => new Map(gifts.map((g) => [g.sku, g])), [gifts]);
  const nameOf = (gift: MarketGift) => giftProductName(t, { sku: gift.sku, isBox: false, items: gift.items });
  const descriptionOf = (gift: MarketGift) => giftProductDescription(t, { sku: gift.sku, isBox: false, items: gift.items });
  const scoped = category ? gifts.filter((g) => g.category === category) : gifts;
  const shown = applyMarket(scoped, {
    filters,
    query,
    textsOf: (gift) => [nameOf(gift), descriptionOf(gift), m.categories[gift.category], m.tiers[gift.tier]],
    favoritesOnly,
    favorites,
  });
  const filtersOn = activeFilterCount(category ? { ...filters, categories: [] } : filters);
  const empty = marketEmptyState({ total: scoped.length, shown: shown.length, query, filtersActive: filtersOn > 0, favoritesOnly });
  const featured = !category && !query.trim() && filtersOn === 0 && !favoritesOnly ? gifts.filter((g) => g.featured) : [];
  const preview = previewSku ? (bySku.get(previewSku) ?? null) : null;
  const sending = sendSku ? (bySku.get(sendSku) ?? null) : null;

  function clearFilters() {
    setFilters({ ...DEFAULT_MARKET_FILTERS, categories: category ? [category] : [] });
    setQuery("");
    setFavoritesOnly(false);
  }

  function toggleFavorite(sku: string) {
    const wanted = !favorites.has(sku);
    setFavoriteError(null);
    setFavorites((current) => {
      const next = new Set(current);
      if (wanted) next.add(sku);
      else next.delete(sku);
      return next;
    });
    startTransition(async () => {
      const undo = () =>
        setFavorites((current) => {
          const next = new Set(current);
          if (wanted) next.delete(sku);
          else next.add(sku);
          return next;
        });
      try {
        const result = await setGiftFavorite(sku, wanted);
        if (result.error) {
          undo();
          setFavoriteError(result.error === "rate_limited" ? t.errors.rate_limited : t.errors.other);
        }
      } catch {
        undo();
        setFavoriteError(m.result.network);
      }
    });
  }

  function card(gift: MarketGift) {
    const name = nameOf(gift);
    return (
      <li key={gift.sku}>
        <button
          type="button"
          onClick={() => setPreviewSku(gift.sku)}
          // Intent only: warms an Epic / Legendary gift's 3D scene and model (nothing for the rest, nothing on scroll).
          onPointerEnter={() => prefetchGiftReveal(gift)}
          onFocus={() => prefetchGiftReveal(gift)}
          onPointerDown={() => prefetchGiftReveal(gift)}
          className={`gift-tier-${gift.tier.toLowerCase()} gift-tier-edge flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-surface text-start transition-colors hover:bg-accent-soft/40`}
        >
          <GiftStage tier={gift.tier} items={gift.items} name={name} size={72} reduce compact playAnimation={false} className="aspect-square w-full" />
          <span className="flex flex-1 flex-col gap-1 p-2.5">
            <span className="line-clamp-2 text-sm font-semibold">{name}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="gift-tier-badge rounded-full px-2 py-0.5 text-[11px] font-semibold">{m.tiers[gift.tier]}</span>
              {favorites.has(gift.sku) && <Heart size={12} aria-label={m.preview.unfavorite} className="fill-current text-danger" />}
            </span>
            <span className="mt-auto text-sm">
              <CoinAmount amount={gift.coinPrice} />
            </span>
            {!gift.available && <span className="text-[11px] text-foreground-soft">{m.notAvailableNow}</span>}
          </span>
        </button>
      </li>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {category && (
            <Link href="/gift-marketplace" className="text-xs text-accent hover:underline">
              {m.backToMarket}
            </Link>
          )}
          <h1 className="text-xl font-semibold">{category ? m.categories[category] : m.title}</h1>
          {!category && <p className="text-sm text-foreground-soft">{m.intro}</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-line bg-surface px-3 py-1.5 text-end">
            <span className="block text-[11px] text-foreground-soft">{m.balanceLabel}</span>
            <span className="flex items-center justify-end gap-1 text-base font-semibold" aria-live="polite">
              <CoinMark size={16} />
              <span aria-hidden>{formatCoins(balance, locale)}</span>
              <span className="sr-only">{format(t.balance, { amount: formatCoins(balance, locale) })}</span>
            </span>
          </div>
          <Link
            href="/gift-marketplace/history"
            className="flex h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium hover:border-accent"
          >
            <History size={16} aria-hidden />
            <span className="hidden sm:inline">{m.historyLink}</span>
            <span className="sr-only sm:hidden">{m.historyLink}</span>
          </Link>
        </div>
      </header>
      <p className="mt-2 text-xs text-foreground-soft">
        {m.grantedNote} {m.noCashValue}
      </p>

      <div className="mt-4 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={16} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-foreground-soft" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={m.searchLabel}
            placeholder={m.searchPlaceholder}
            maxLength={60}
            className="w-full rounded-xl border border-line bg-background py-2.5 pe-9 ps-9 text-base sm:text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={m.clearSearch}
              className="absolute end-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-foreground-soft hover:text-foreground"
            >
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium ${filtersOn > 0 ? "border-accent bg-accent-soft" : "border-line"}`}
        >
          <SlidersHorizontal size={16} aria-hidden />
          {filtersOn > 0 ? format(m.filtersActive, { count: filtersOn }) : m.filters}
        </button>
      </div>

      {!category && (
        <section aria-label={m.bannerTitle} className="gift-stage gift-tier-legendary mt-4 overflow-hidden rounded-2xl px-5 py-6 text-white">
          <span className="gift-stage-sweep" aria-hidden />
          <span className="gift-stage-particles" aria-hidden />
          <div className="relative">
            <h2 className="text-lg font-semibold">{m.bannerTitle}</h2>
            <p className="mt-1 max-w-md text-sm opacity-85">{m.bannerBody}</p>
          </div>
        </section>
      )}

      <nav aria-label={m.categoriesNav} className="-mx-4 mt-4 overflow-x-auto px-4">
        <ul className="flex w-max gap-2 pb-1">
          <li>
            <Link
              href="/gift-marketplace"
              aria-current={category === null ? "page" : undefined}
              className={`block whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${category === null ? "border-accent bg-accent-soft font-semibold" : "border-line text-foreground-soft hover:border-accent"}`}
            >
              {m.allCategories}
            </Link>
          </li>
          {GIFT_CATEGORIES.map((c) => (
            <li key={c}>
              <Link
                href={`/gift-marketplace/${categorySlug(c)}`}
                aria-current={category === c ? "page" : undefined}
                className={`block whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${category === c ? "border-accent bg-accent-soft font-semibold" : "border-line text-foreground-soft hover:border-accent"}`}
              >
                {m.categories[c]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {featured.length > 0 && (
        <section aria-labelledby="gift-market-featured" className="mt-5">
          <h2 id="gift-market-featured" className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            {m.featuredHeading}
          </h2>
          <ul className="-mx-4 mt-2 flex gap-3 overflow-x-auto px-4 pb-1 [&>li]:w-40 [&>li]:shrink-0">{featured.map(card)}</ul>
        </section>
      )}

      <section aria-labelledby="gift-market-all" className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="gift-market-all" className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            {category ? m.categories[category] : m.allGiftsHeading}
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} />
            {m.favoritesOnly}
          </label>
        </div>
        {favoriteError && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {favoriteError}
          </p>
        )}
        {empty ? (
          <div className="mt-6 rounded-2xl border border-dashed border-line p-6 text-center">
            <p className="text-sm text-foreground-soft">{m.empty[empty]}</p>
            {empty !== "empty_marketplace" && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-3 rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-accent"
              >
                {m.clearFilters}
              </button>
            )}
          </div>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{shown.map(card)}</ul>
        )}
      </section>

      <GiftMarketFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filters}
        onApply={(next) => setFilters(category ? { ...next, categories: [category] } : next)}
        lockedCategory={category !== null}
      />

      {preview && (
        <GiftReveal
          key={preview.sku}
          mode="preview"
          tier={preview.tier}
          items={preview.items}
          giftName={nameOf(preview)}
          sender="sample"
          message={m.preview.sampleMessage}
          announcement={`${format(m.preview.stageLabel, { name: nameOf(preview) })}. ${m.preview.sampleNote}`}
          onClose={() => setPreviewSku(null)}
          details={
            <>
              <p className="text-xs text-white/65">
                {m.categories[preview.category]} · {m.preview.effects[preview.tier]}
              </p>
              <p className="line-clamp-2 text-sm text-white/85">{descriptionOf(preview)}</p>
              <p role="note" className="text-[11px] text-white/60">
                {m.preview.sampleNote} {m.preview.previewOnly} {m.preview.noSound}
              </p>
              {reduce && (
                <p role="note" className="text-[11px] text-white/60">
                  {m.preview.reducedMotion}
                </p>
              )}
              {!reduce && lowEnd && (
                <p role="note" className="text-[11px] text-white/60">
                  {m.preview.lowEnd}
                </p>
              )}
              {favoriteError && (
                <p role="alert" className="text-sm text-red-200">
                  {favoriteError}
                </p>
              )}
              {!preview.available && (
                <p role="status" className="text-sm text-red-200">
                  {m.preview.unavailable}
                </p>
              )}
            </>
          }
          primary={
            <PreviewSendButton
              label={m.preview.send}
              coinPrice={preview.coinPrice}
              disabled={!preview.available}
              onSend={() => setSendSku(preview.sku)}
            />
          }
          secondary={
            <button
              type="button"
              onClick={() => toggleFavorite(preview.sku)}
              aria-pressed={favorites.has(preview.sku)}
              aria-label={favorites.has(preview.sku) ? m.preview.unfavorite : m.preview.favorite}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 text-white hover:border-white/60"
            >
              <Heart size={16} aria-hidden className={favorites.has(preview.sku) ? "fill-current text-red-300" : ""} />
            </button>
          }
        />
      )}

      <GiftMarketSendSheet gift={sending} onClose={() => setSendSku(null)} coinBalance={balance} onBalance={setBalance} />
    </div>
  );
}

/**
 * Send from the preview: the send sheet opens only once the preview has gone (one overlay at a time: swapping two in
 * one render can leave the new one invisible on iPhone, see create-picker.ts).
 */
function PreviewSendButton({
  label,
  coinPrice,
  disabled,
  onSend,
}: {
  label: string;
  coinPrice: number;
  disabled: boolean;
  onSend: () => void;
}) {
  const close = useGiftRevealClose();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => close(onSend)}
      className="flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
    >
      {label}
      <span aria-hidden>·</span>
      <CoinAmount amount={coinPrice} />
    </button>
  );
}
