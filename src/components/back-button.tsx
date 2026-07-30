"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export function BackButton({ fallbackHref = "/home" }: { fallbackHref?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      aria-label="Go back"
      className="mb-4 flex items-center gap-1 rounded-lg p-1.5 text-sm text-foreground-soft hover:bg-line"
    >
      <ArrowLeft size={18} />
      Back
    </button>
  );
}
