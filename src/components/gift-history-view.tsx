"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { GiftArt } from "@/components/gift-art";
import { GiftOpenOverlay } from "@/components/gift-open-overlay";
import { CoinAmount } from "@/components/coin-amount";
import { useGiftsText } from "@/components/gifts-text";
import { getGiftHistory } from "@/app/actions/gift-market";
import { openGift, type OpenedGift } from "@/app/actions/gifts";
import { giftItemName, giftProductName } from "@/lib/gift-names";
import { byCode, format } from "@/lib/i18n/locales";
import type { ReceivedGiftEntry, SentGiftEntry } from "@/lib/gift-history";

type Tab = "sent" | "received";

/**
 * Gift history: the signed-in person's own sent and received gifts (most recent 50 each; the server's rules in
 * src/lib/gift-history.ts decide who is named). A received gift not opened yet can be opened here, and an opened one
 * replayed; both play the recipient's reveal (GiftReveal, reduce-motion still included) through openGift, which only
 * ever answers the recipient.
 */
export function GiftHistoryView() {
  const { locale, t } = useGiftsText();
  const m = t.market;
  const [tab, setTab] = useState<Tab>("sent");
  const [sent, setSent] = useState<SentGiftEntry[] | null>(null);
  const [received, setReceived] = useState<ReceivedGiftEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [opened, setOpened] = useState<OpenedGift | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [isOpening, startOpening] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getGiftHistory(tab)
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
          return;
        }
        setError(null);
        if (result.tab === "sent") setSent(result.sent);
        else setReceived(result.received);
      })
      .catch(() => {
        if (!cancelled) setError("other");
      });
    return () => {
      cancelled = true;
    };
  }, [tab, loadKey]);

  const date = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso)) : "";

  function open(entry: ReceivedGiftEntry) {
    setOpenError(null);
    startOpening(async () => {
      try {
        const result = await openGift(entry.sendId);
        if (result.error) {
          setOpenError(byCode(t.errors, result.error));
          return;
        }
        setOpened(result.gift);
        setReceived((rows) => rows?.map((r) => (r.sendId === entry.sendId ? { ...r, status: "OPENED" } : r)) ?? rows);
      } catch {
        setOpenError(m.result.network);
      }
    });
  }

  const rows = tab === "sent" ? sent : received;
  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`gift-history-tab-${value}`}
      aria-selected={tab === value}
      aria-controls="gift-history-panel"
      onClick={() => setTab(value)}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${tab === value ? "bg-accent text-accent-ink" : "text-foreground-soft"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4">
      <Link href="/gift-marketplace" className="text-xs text-accent hover:underline">
        {m.backToMarket}
      </Link>
      <h1 className="mt-1 text-xl font-semibold">{m.history.title}</h1>
      <div role="tablist" aria-label={m.history.title} className="mt-4 flex gap-1 rounded-xl border border-line p-1">
        {tabButton("sent", m.history.sent)}
        {tabButton("received", m.history.received)}
      </div>
      <div id="gift-history-panel" role="tabpanel" aria-labelledby={`gift-history-tab-${tab}`} className="mt-4">
        {error && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-danger">{error === "rate_limited" ? t.errors.rate_limited : t.loadFailed}</span>
            <button type="button" onClick={() => setLoadKey((k) => k + 1)} className="text-accent underline">
              {t.retry}
            </button>
          </div>
        )}
        {!rows && !error && (
          <ul className="space-y-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-16 animate-pulse rounded-xl bg-surface" />
            ))}
          </ul>
        )}
        {openError && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {openError}
          </p>
        )}
        {rows && rows.length === 0 && (
          <p className="text-sm text-foreground-soft">{tab === "sent" ? m.history.emptySent : m.history.emptyReceived}</p>
        )}
        {tab === "sent" && sent && sent.length > 0 && (
          <ul className="space-y-2">
            {sent.map((entry) => (
              <li key={entry.sendId} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <GiftThumb items={entry.items} name={giftProductName(t, { sku: entry.productSku, isBox: entry.isBox, items: entry.items })} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{giftProductName(t, { sku: entry.productSku, isBox: entry.isBox, items: entry.items })}</span>
                  <span className="block truncate text-xs text-foreground-soft">
                    {format(m.history.to, { name: entry.to === "not_shown" ? m.history.someone : (entry.to.name ?? entry.to.username ?? m.history.someone) })}
                    {" · "}
                    {date(entry.createdAt)}
                  </span>
                  <span className="block text-xs text-foreground-soft">
                    {m.history.statuses[entry.status]}
                    {entry.quantity > 1 ? ` · ${format(m.history.quantity, { count: entry.quantity })}` : ""}
                  </span>
                </span>
                {entry.coins !== null && <CoinAmount amount={entry.coins} className="text-sm font-semibold" />}
              </li>
            ))}
          </ul>
        )}
        {tab === "received" && received && received.length > 0 && (
          <ul className="space-y-2">
            {received.map((entry) => (
              <li key={entry.sendId} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <GiftThumb items={entry.items} name={giftProductName(t, { sku: entry.productSku, isBox: entry.isBox, items: entry.items })} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{giftProductName(t, { sku: entry.productSku, isBox: entry.isBox, items: entry.items })}</span>
                  <span className="block truncate text-xs text-foreground-soft">
                    {entry.from === "award"
                      ? t.profile.fromAward
                      : entry.from === "deleted"
                        ? t.profile.fromDeleted
                        : format(m.history.from, {
                            name: entry.from === "not_shown" ? m.history.someone : (entry.from.name ?? m.history.someone),
                          })}
                    {" · "}
                    {date(entry.deliveredAt)}
                  </span>
                  {entry.quantity > 1 && (
                    <span className="block text-xs text-foreground-soft">{format(m.history.quantity, { count: entry.quantity })}</span>
                  )}
                </span>
                {entry.status === "DELIVERED" ? (
                  <button
                    type="button"
                    onClick={() => open(entry)}
                    disabled={isOpening}
                    className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-60"
                  >
                    {m.history.open}
                  </button>
                ) : (
                  <span className="flex flex-col items-end gap-1">
                    <span className="text-xs text-foreground-soft">{m.history.opened}</span>
                    <button
                      type="button"
                      onClick={() => open(entry)}
                      disabled={isOpening}
                      className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-accent disabled:opacity-60"
                    >
                      <RotateCcw size={12} aria-hidden />
                      {m.history.replay}
                      <span className="sr-only">: {giftProductName(t, { sku: entry.productSku, isBox: entry.isBox, items: entry.items })}</span>
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {rows && rows.length > 0 && <p className="mt-3 text-xs text-foreground-soft">{m.history.recentOnly}</p>}
      </div>
      <GiftOpenOverlay gift={opened} onClose={() => setOpened(null)} />
    </div>
  );
}

function GiftThumb({ items, name }: { items: { slug: string; assetKey: string }[]; name: string }) {
  const { t } = useGiftsText();
  return (
    <span className="flex shrink-0 -space-x-2 rtl:space-x-reverse" title={name}>
      {items.slice(0, 2).map((item, i) => (
        <GiftArt key={`${item.slug}-${i}`} assetKey={item.assetKey} name={giftItemName(t, item.slug)} size={40} />
      ))}
    </span>
  );
}
