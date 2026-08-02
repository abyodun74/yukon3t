"use client";

export function OfflineRetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
    >
      Try again
    </button>
  );
}
