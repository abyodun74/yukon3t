"use client";

import { useRef } from "react";

// The request id a coin checkout sends with createGiftIntent (src/lib/coins.ts isClientRequestId / coinPurchaseKey).
// One id per choice: a retry of the same choice (same gift, recipient, quantity and note) reuses it, so the server
// answers the first attempt instead of spending again; a different choice, or a settled answer, gets a new one.

export type CheckoutRequestState = { fingerprint: string; id: string } | null;

/** The id to send for `fingerprint`, and the state to keep. Pure (the id maker is passed in), unit-tested. */
export function checkoutRequestId(
  state: CheckoutRequestState,
  fingerprint: string,
  makeId: () => string,
): { id: string; state: { fingerprint: string; id: string } } {
  if (state && state.fingerprint === fingerprint) return { id: state.id, state };
  const next = { fingerprint, id: makeId() };
  return { id: next.id, state: next };
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Older WebViews without randomUUID: getRandomValues is older and universal there.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function useCheckoutRequestId(fingerprint: string) {
  const state = useRef<CheckoutRequestState>(null);
  return {
    /** The id for the current choice (made on first use, kept for retries). Call it from an event handler. */
    id(): string {
      const next = checkoutRequestId(state.current, fingerprint, newRequestId);
      state.current = next.state;
      return next.id;
    },
    /** The last attempt has a definitive answer: the next send is a new request. */
    settle(): void {
      state.current = null;
    },
  };
}
