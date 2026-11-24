"use client";

import { useState } from "react";
import { Sheet } from "@/components/sheet";
import { useGiftsText } from "@/components/gifts-text";
import {
  DEFAULT_MARKET_FILTERS,
  GIFT_CATEGORIES,
  GIFT_TIERS,
  MARKET_AVAILABILITIES,
  MARKET_EFFECTS,
  MARKET_SORTS,
  normalizePriceRange,
  type MarketFilters,
} from "@/lib/gift-market";

/**
 * The marketplace's filters as a bottom sheet (a centered dialog on wider screens): category and rarity
 * (multi-select), a coin price range, availability, effect and sort. Every filter combines with the others. Changes
 * are a draft until Apply; Reset puts the draft back to the defaults. Native form controls throughout, so keyboard and
 * screen readers work as usual.
 */
export function GiftMarketFilterSheet({
  open,
  onClose,
  value,
  onApply,
  lockedCategory,
}: {
  open: boolean;
  onClose: () => void;
  value: MarketFilters;
  onApply: (filters: MarketFilters) => void;
  /** On a category page the category is fixed by the page itself. */
  lockedCategory: boolean;
}) {
  const { locale, dir, t } = useGiftsText();
  const m = t.market;
  const [draft, setDraft] = useState<MarketFilters>(value);
  const [minText, setMinText] = useState(value.minPrice === null ? "" : String(value.minPrice));
  const [maxText, setMaxText] = useState(value.maxPrice === null ? "" : String(value.maxPrice));

  // A fresh draft from the applied filters on every open (adjusted during render, as gift-picker-sheet.tsx does).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(value);
      setMinText(value.minPrice === null ? "" : String(value.minPrice));
      setMaxText(value.maxPrice === null ? "" : String(value.maxPrice));
    }
  }

  function toggle<T extends string>(list: T[], item: T): T[] {
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  }

  function apply() {
    const range = normalizePriceRange(minText, maxText);
    onApply({ ...draft, ...range });
    onClose();
  }

  function reset() {
    setDraft({ ...DEFAULT_MARKET_FILTERS, categories: lockedCategory ? draft.categories : [] });
    setMinText("");
    setMaxText("");
  }

  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm ${on ? "border-accent bg-accent-soft font-semibold text-foreground" : "border-line text-foreground-soft"}`;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="bottom-sheet"
      responsive
      dragFromHandle
      title={m.filterTitle}
      lang={locale}
      dir={dir}
      panelClassName="sm:max-w-md"
      bodyClassName="flex max-h-[80dvh] min-h-0 flex-col"
    >
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-4">
        {!lockedCategory && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{m.filterCategory}</legend>
            <div className="flex flex-wrap gap-2">
              {GIFT_CATEGORIES.map((category) => {
                const on = draft.categories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraft((d) => ({ ...d, categories: toggle(d.categories, category) }))}
                    className={chip(on)}
                  >
                    {m.categories[category]}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{m.filterRarity}</legend>
          <div className="flex flex-wrap gap-2">
            {GIFT_TIERS.map((tier) => {
              const on = draft.tiers.includes(tier);
              return (
                <button
                  key={tier}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDraft((d) => ({ ...d, tiers: toggle(d.tiers, tier) }))}
                  className={chip(on)}
                >
                  {m.tiers[tier]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{m.filterPrice}</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-foreground-soft">
              {m.minPrice}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={minText}
                onChange={(e) => setMinText(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-base text-foreground sm:text-sm"
              />
            </label>
            <label className="text-xs text-foreground-soft">
              {m.maxPrice}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={maxText}
                onChange={(e) => setMaxText(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-base text-foreground sm:text-sm"
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{m.filterAvailability}</legend>
          <div className="space-y-1.5">
            {MARKET_AVAILABILITIES.map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="gift-market-availability"
                  checked={draft.availability === value}
                  onChange={() => setDraft((d) => ({ ...d, availability: value }))}
                />
                {m.availability[value]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{m.filterEffect}</legend>
          <div className="space-y-1.5">
            {MARKET_EFFECTS.map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="gift-market-effect"
                  checked={draft.effect === value}
                  onChange={() => setDraft((d) => ({ ...d, effect: value }))}
                />
                {m.effects[value]}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-foreground-soft">{m.effectHint}</p>
        </fieldset>

        <label className="block text-sm font-semibold">
          {m.filterSort}
          <select
            value={draft.sort}
            onChange={(e) => setDraft((d) => ({ ...d, sort: e.target.value as MarketFilters["sort"] }))}
            className="mt-2 w-full rounded-lg border border-line bg-background px-3 py-2 text-base font-normal sm:text-sm"
          >
            {MARKET_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {m.sorts[sort]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex shrink-0 gap-3 border-t border-line px-4 pt-3">
        <button type="button" onClick={reset} className="flex-1 rounded-lg border border-line px-4 py-3 text-sm font-semibold">
          {m.reset}
        </button>
        <button type="button" onClick={apply} className="flex-1 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink">
          {m.apply}
        </button>
      </div>
    </Sheet>
  );
}
