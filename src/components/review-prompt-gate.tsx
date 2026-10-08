"use client";

import { useEffect, useState, useTransition } from "react";
import { Capacitor } from "@capacitor/core";
import {
  checkReviewPromptEligibility,
  recordReviewPromptShown,
  recordReviewPromptChoice,
  submitAppFeedback,
} from "@/app/actions/review-prompt";
import { requestNativeReview } from "@/lib/in-app-review";
import { Sheet } from "@/components/sheet";

// How long after mount to check eligibility — long enough that this never
// competes with a page's own first paint/data loading, short enough that
// it doesn't feel disconnected from "you've been using the app a while"
// once it does appear.
const CHECK_DELAY_MS = 3000;

type Step = "closed" | "ask" | "feedback" | "thanks";

/**
 * The "How's the yukon3t app?" gate — mounted once, globally, for every
 * signed-in session (see layout.tsx). Native-app-only: the whole point is
 * to lead into the OS's own native review popup (in-app-review.ts), which
 * doesn't exist for a plain browser tab, and a "Could be better" web
 * visitor can already reach support/feedback other ways.
 *
 * The one rule everything here is built around: a lukewarm or negative
 * signal must never reach the native popup. "I love it" is the only path
 * that calls requestNativeReview() — "Could be better" routes to a private
 * feedback form instead (see actions/review-prompt.ts's AppFeedback),
 * "Maybe later" just snoozes. See lib/review-prompt.ts for the eligibility
 * thresholds (account age, real activity, ask-count cap).
 */
export function ReviewPromptGate() {
  const [step, setStep] = useState<Step>("closed");
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // This now stays mounted through its own close animation (Sheet's
  // AnimatePresence — see that file) rather than returning null outright,
  // but `step` itself flips straight to "closed" on every dismiss path,
  // which would otherwise blank the dialog's title/content mid-exit.
  // Remembers the last real step for rendering while `step !== "closed"`
  // alone still drives the Sheet's `open`; adjusted during render (React's
  // documented pattern for this) rather than a useEffect.
  const [displayedStep, setDisplayedStep] = useState<Step>("closed");
  if (step !== "closed" && step !== displayedStep) setDisplayedStep(step);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const timer = setTimeout(() => {
      checkReviewPromptEligibility()
        .then((result) => {
          if (result.eligible) {
            setStep("ask");
            void recordReviewPromptShown();
          }
        })
        .catch(() => {});
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  function dismissAsLater() {
    setStep("closed");
    void recordReviewPromptChoice("LATER");
  }

  function chooseLove() {
    setStep("closed");
    startTransition(async () => {
      await recordReviewPromptChoice("LOVE");
      await requestNativeReview();
    });
  }

  function chooseMeh() {
    // Terminal the moment they pick this — matches the server action's own
    // semantics (DECLINED is recorded here, not after the feedback text is
    // actually typed/submitted), so someone who picks "Could be better"
    // and then closes without writing anything still isn't asked again.
    void recordReviewPromptChoice("MEH");
    setStep("feedback");
  }

  function submitFeedback() {
    const text = feedback.trim();
    if (!text) return;
    setFeedbackError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("content", text);
      const result = await submitAppFeedback(fd);
      if (result.error) {
        setFeedbackError(
          result.error === "rate_limited" ? "Slow down a little." : "Couldn't send that — try again.",
        );
        return;
      }
      setStep("thanks");
    });
  }

  // dismissAsLater is the right close action only while actually on "ask"
  // (backdrop/drag dismiss from "feedback"/"thanks" should just close, not
  // also record a LATER choice on top of whatever was already recorded) —
  // same condition the old backdrop onClick used, now driving Sheet's
  // onClose directly.
  function close() {
    if (displayedStep === "ask") dismissAsLater();
    else setStep("closed");
  }

  return (
    <Sheet
      open={step !== "closed"}
      onClose={close}
      variant="bottom-sheet"
      responsive
      panelClassName="p-5"
      ariaLabel="App feedback"
    >
        {displayedStep === "ask" && (
          <>
            <h2 className="text-base font-semibold">How&apos;s the yukon3t app?</h2>
            <p className="mt-1 text-sm text-foreground-soft">
              Your feedback makes the app better for everyone.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={chooseLove}
                disabled={isPending}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink disabled:opacity-50"
              >
                I love it
              </button>
              <button
                type="button"
                onClick={chooseMeh}
                disabled={isPending}
                className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium disabled:opacity-50"
              >
                Could be better
              </button>
              <button
                type="button"
                onClick={dismissAsLater}
                disabled={isPending}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-foreground-soft disabled:opacity-50"
              >
                Maybe later
              </button>
            </div>
          </>
        )}

        {displayedStep === "feedback" && (
          <>
            <h2 className="text-base font-semibold">What could be better?</h2>
            <p className="mt-1 text-sm text-foreground-soft">
              This goes straight to our team, not a public review — tell us what&apos;s not working.
            </p>
            <textarea
              aria-label="What's on your mind?"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value.slice(0, 2000))}
              rows={4}
              autoFocus
              placeholder="What's on your mind?"
              className="mt-3 w-full resize-none rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {feedbackError && <p role="alert" className="mt-1.5 text-xs text-danger">{feedbackError}</p>}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setStep("closed")}
                disabled={isPending}
                className="rounded-lg px-3 py-2 text-sm font-medium text-foreground-soft disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitFeedback}
                disabled={isPending || !feedback.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
              >
                {isPending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}

        {displayedStep === "thanks" && (
          <>
            <h2 className="text-base font-semibold">Thanks for the feedback 🙏</h2>
            <p className="mt-1 text-sm text-foreground-soft">
              We read every message — this genuinely helps us improve the app.
            </p>
            <button
              type="button"
              onClick={() => setStep("closed")}
              className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink"
            >
              Done
            </button>
          </>
        )}
    </Sheet>
  );
}
