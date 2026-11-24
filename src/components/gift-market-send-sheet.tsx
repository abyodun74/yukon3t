"use client";

import { useEffect, useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { Sheet } from "@/components/sheet";
import { GiftArt } from "@/components/gift-art";
import { UserAvatar } from "@/components/user-link";
import { CoinAmount } from "@/components/coin-amount";
import { useGiftsText } from "@/components/gifts-text";
import { checkGiftRecipient, createGiftIntent } from "@/app/actions/gifts";
import { searchGiftRecipients, type GiftRecipientOption } from "@/app/actions/gift-market";
import { GIFT_MESSAGE_MAX } from "@/lib/gifts";
import { GIFT_QUANTITY_MAX, balanceAfterSpend, coinTotal } from "@/lib/coins";
import { giftItemName, giftProductName } from "@/lib/gift-names";
import { useCheckoutRequestId } from "@/lib/use-checkout-request-id";
import { byCode, format } from "@/lib/i18n/locales";
import type { MarketGift } from "@/lib/gift-market";

type Step = "recipient" | "checkout" | "result";
type Outcome = "sent" | "refunded" | "undeliverable" | "pending";

/**
 * Sending a marketplace gift: choose who it's for (recent recipients and connections, searchable), then confirm
 * (quantity, price each, total, balance, what's left), then the outcome. One recipient per send; the price is per gift
 * and the total is price x quantity, both recomputed by the server, which reads its own price. The shown numbers are
 * only a preview: the server can refuse (not enough coins, the gift or the person no longer available) and says so.
 *
 * Money safety on the client side: Send is disabled while a send is in flight, and every attempt of one checkout (same
 * gift, person, quantity and note) carries the same request id, so a double tap or a retry after a lost answer is
 * answered by the server without spending again. A changed choice, or a definitive answer, starts a new request.
 */
export function GiftMarketSendSheet({
  gift,
  onClose,
  coinBalance,
  onBalance,
}: {
  gift: MarketGift | null;
  onClose: () => void;
  coinBalance: number;
  onBalance: (balance: number) => void;
}) {
  const { locale, dir, t } = useGiftsText();
  const m = t.market;
  const [step, setStep] = useState<Step>("recipient");
  const [query, setQuery] = useState("");
  const [lists, setLists] = useState<{ recent: GiftRecipientOption[]; connections: GiftRecipientOption[] } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<GiftRecipientOption | null>(null);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const open = gift !== null;

  // A fresh flow on every open (adjusted during render).
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if ((gift?.sku ?? null) !== openedFor) {
    setOpenedFor(gift?.sku ?? null);
    if (gift) {
      setStep("recipient");
      setQuery("");
      setRecipient(null);
      setRecipientError(null);
      setQuantity(1);
      setNote("");
      setOutcome(null);
      setSendError(null);
    }
  }

  // Recipient search, debounced; the server narrows within the user's own recent recipients and connections.
  useEffect(() => {
    if (!open || step !== "recipient") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchGiftRecipients(query)
        .then((result) => {
          if (cancelled) return;
          if (result.error) setListError(result.error);
          else {
            setListError(null);
            setLists({ recent: result.recent, connections: result.connections });
          }
        })
        .catch(() => {
          if (!cancelled) setListError("other");
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, step, query]);

  const noteText = note.trim();
  const noteLength = [...noteText].length;
  const noteTooLong = noteLength > GIFT_MESSAGE_MAX;
  const total = gift ? (coinTotal(gift.coinPrice, quantity) ?? 0) : 0;
  const insufficient = total > coinBalance;
  const checkout = useCheckoutRequestId([gift?.sku ?? "", recipient?.id ?? "", quantity, noteText].join("|"));

  function pick(person: GiftRecipientOption) {
    if (checking) return;
    setChecking(person.id);
    setRecipientError(null);
    checkGiftRecipient(person.id)
      .then((result) => {
        if (result.error) {
          setRecipientError(result.error === "rate_limited" ? t.errors.rate_limited : m.recipient.unavailable);
          return;
        }
        setRecipient(person);
        setStep("checkout");
      })
      .catch(() => setRecipientError(m.result.network))
      .finally(() => setChecking(null));
  }

  function send() {
    if (!gift || !recipient || isPending || noteTooLong) return;
    // Finishing a pending send spends nothing more (same request id), so the balance it already used doesn't block it.
    if (insufficient && outcome !== "pending") return;
    setSendError(null);
    startTransition(async () => {
      try {
        const result = await createGiftIntent(gift.sku, recipient.id, noteText || null, { context: "DIRECT" }, {
          clientRequestId: checkout.id(),
          quantity,
        });
        if (result.error) {
          if (result.error === "insufficient_coins") onBalance(result.coinBalance);
          checkout.settle();
          setSendError(result.error === "unavailable" || result.error === "not_accepting" ? m.recipient.unavailable : byCode(t.errors, result.error));
          return;
        }
        onBalance(result.coinBalance);
        if (result.pending) {
          // Coins spent, delivery not finished: the same request id finishes it on Try again, spending nothing more.
          setOutcome("pending");
          setStep("result");
          return;
        }
        checkout.settle();
        setOutcome(result.delivered ? "sent" : result.refunded ? "refunded" : "undeliverable");
        setStep("result");
      } catch {
        // No answer (offline, a dropped connection, an expired session): the request id stays, so trying again can't
        // spend twice.
        setSendError(typeof navigator !== "undefined" && navigator.onLine === false ? m.result.network : m.result.failed);
      }
    });
  }

  const giftName = gift ? giftProductName(t, { sku: gift.sku, isBox: false, items: gift.items }) : "";
  const title = step === "recipient" ? m.recipient.title : step === "checkout" ? m.checkout.title : giftName;

  function personRow(person: GiftRecipientOption) {
    const label = person.name ?? person.username ?? "";
    return (
      <li key={person.id}>
        <button
          type="button"
          onClick={() => pick(person)}
          disabled={checking !== null}
          aria-label={format(m.recipient.choose, { name: label })}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start hover:bg-accent-soft disabled:opacity-60"
        >
          <UserAvatar avatarUrl={person.avatarUrl} name={person.name} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{person.name ?? person.username}</span>
            {person.username && <span className="block truncate text-xs text-foreground-soft">@{person.username}</span>}
          </span>
          {checking === person.id && <span className="text-xs text-foreground-soft">{m.recipient.checking}</span>}
        </button>
      </li>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="bottom-sheet"
      responsive
      dragFromHandle
      title={title}
      lang={locale}
      dir={dir}
      panelClassName="sm:max-w-md"
      bodyClassName="flex max-h-[80dvh] min-h-0 flex-col"
    >
      {gift && step === "recipient" && (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          <label className="text-xs font-medium text-foreground-soft" htmlFor="gift-recipient-search">
            {m.recipient.searchLabel}
          </label>
          <input
            id="gift-recipient-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={m.recipient.searchPlaceholder}
            maxLength={60}
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-base sm:text-sm"
          />
          {recipientError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {recipientError}
            </p>
          )}
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-live="polite">
            {!lists && !listError && <p className="text-sm text-foreground-soft">{t.loading}</p>}
            {listError && <p className="text-sm text-danger">{listError === "rate_limited" ? t.errors.rate_limited : t.loadFailed}</p>}
            {lists && lists.recent.length === 0 && lists.connections.length === 0 && (
              <p className="text-sm text-foreground-soft">{query.trim() ? m.recipient.noResults : m.recipient.none}</p>
            )}
            {lists && lists.recent.length > 0 && (
              <section aria-labelledby="gift-recipients-recent">
                <h3 id="gift-recipients-recent" className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
                  {m.recipient.recent}
                </h3>
                <ul className="mt-1">{lists.recent.map(personRow)}</ul>
              </section>
            )}
            {lists && lists.connections.length > 0 && (
              <section aria-labelledby="gift-recipients-connections" className="mt-3">
                <h3 id="gift-recipients-connections" className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
                  {m.recipient.connections}
                </h3>
                <ul className="mt-1">{lists.connections.map(personRow)}</ul>
              </section>
            )}
          </div>
        </div>
      )}

      {gift && recipient && step === "checkout" && (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4">
            <div className="flex items-center gap-3 rounded-xl border border-line p-3">
              <span className="flex shrink-0 -space-x-2 rtl:space-x-reverse">
                {gift.items.slice(0, 3).map((item, i) => (
                  <GiftArt key={`${item.slug}-${i}`} assetKey={item.assetKey} name={giftItemName(t, item.slug)} size={44} />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-foreground-soft">{m.checkout.gift}</span>
                <span className="block truncate text-sm font-semibold">{giftName}</span>
                <span className={`gift-tier-${gift.tier.toLowerCase()} gift-tier-badge mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold`}>
                  {m.tiers[gift.tier]}
                </span>
              </span>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-line p-3">
              <UserAvatar avatarUrl={recipient.avatarUrl} name={recipient.name} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-foreground-soft">{m.checkout.to}</span>
                <span className="block truncate text-sm font-semibold">{recipient.name ?? recipient.username}</span>
              </span>
              <button
                type="button"
                onClick={() => setStep("recipient")}
                disabled={isPending}
                className="rounded-full border border-line px-3 py-1 text-xs font-semibold"
              >
                {m.checkout.change}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span id="gift-quantity-label" className="text-sm font-medium">
                {m.checkout.quantity}
              </span>
              <div role="group" aria-labelledby="gift-quantity-label" className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1 || isPending}
                  aria-label={m.checkout.decrease}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-line disabled:opacity-40"
                >
                  <Minus size={16} aria-hidden />
                </button>
                <output aria-live="polite" className="w-8 text-center text-base font-semibold">
                  {quantity}
                </output>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(GIFT_QUANTITY_MAX, q + 1))}
                  disabled={quantity >= GIFT_QUANTITY_MAX || isPending}
                  aria-label={m.checkout.increase}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-line disabled:opacity-40"
                >
                  <Plus size={16} aria-hidden />
                </button>
              </div>
            </div>

            <dl className="space-y-1.5 rounded-xl bg-surface p-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-foreground-soft">{m.checkout.priceEach}</dt>
                <dd>
                  <CoinAmount amount={gift.coinPrice} />
                </dd>
              </div>
              <div className="flex justify-between gap-3 font-semibold">
                <dt>{m.checkout.total}</dt>
                <dd>
                  <CoinAmount amount={total} />
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-line pt-1.5">
                <dt className="text-foreground-soft">{m.checkout.balance}</dt>
                <dd>
                  <CoinAmount amount={coinBalance} />
                </dd>
              </div>
              {!insufficient && (
                <div className="flex justify-between gap-3">
                  <dt className="text-foreground-soft">{m.checkout.remaining}</dt>
                  <dd>
                    <CoinAmount amount={balanceAfterSpend(coinBalance, total)} />
                  </dd>
                </div>
              )}
            </dl>

            {insufficient && (
              <div role="alert" className="rounded-xl border border-danger/40 p-3 text-sm">
                <p className="font-semibold text-danger">{m.checkout.insufficient}</p>
                <p className="mt-1 text-foreground-soft">{m.grantedNote}</p>
              </div>
            )}

            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="gift-market-note" className="text-xs font-medium text-foreground-soft">
                  {m.checkout.noteLabel}
                </label>
                <p id="gift-market-note-count" className={`text-xs ${noteTooLong ? "text-danger" : "text-foreground-soft"}`}>
                  <bdi>{`${noteLength}/${GIFT_MESSAGE_MAX}`}</bdi>
                </p>
              </div>
              <textarea
                id="gift-market-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                dir="auto"
                placeholder={t.messagePlaceholder}
                aria-describedby="gift-market-note-count"
                aria-invalid={noteTooLong}
                disabled={isPending}
                className="mt-1 w-full resize-none rounded-lg border border-line bg-background px-3 py-2 text-base sm:text-sm"
              />
            </div>
            <p className="text-xs text-foreground-soft">{m.noCashValue}</p>
          </div>

          <div className="shrink-0 space-y-2 border-t border-line px-4 pt-3">
            {sendError && (
              <p role="alert" className="text-sm text-danger">
                {sendError}
              </p>
            )}
            <button
              type="button"
              onClick={send}
              disabled={isPending || insufficient || noteTooLong}
              aria-busy={isPending}
              className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
            >
              {isPending ? m.checkout.sending : sendError ? m.result.tryAgain : m.checkout.confirm}
            </button>
          </div>
        </>
      )}

      {gift && step === "result" && (
        <div className="px-4 pb-4 text-center">
          <div className="mx-auto flex w-fit -space-x-2 rtl:space-x-reverse">
            {gift.items.slice(0, 3).map((item, i) => (
              <GiftArt key={`${item.slug}-${i}`} assetKey={item.assetKey} name={giftItemName(t, item.slug)} size={72} />
            ))}
          </div>
          <p role="status" className={`mt-3 text-sm ${outcome === "sent" ? "text-success" : outcome === "pending" ? "" : "text-danger"}`}>
            {outcome === "sent"
              ? format(m.result.sent, { name: recipient?.name ?? recipient?.username ?? "" })
              : outcome === "refunded"
                ? m.result.refunded
                : outcome === "pending"
                  ? m.result.pending
                  : t.undeliverable}
          </p>
          {sendError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {sendError}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2">
            {outcome === "pending" ? (
              <button
                type="button"
                onClick={send}
                disabled={isPending}
                className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
              >
                {isPending ? m.checkout.sending : m.result.tryAgain}
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
              >
                {m.result.done}
              </button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
