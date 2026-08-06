"use client";

import type { ReactNode } from "react";
import { recordAdClick } from "@/app/actions/ads";

/**
 * target="_blank" isn't just UX — it means the current tab never unloads,
 * so the fire-and-forget recordAdClick() call always has time to actually
 * reach the server instead of racing a navigation that could cut it off.
 */
export function AdClickTracker({ id, href, children }: { id: string; href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={() => {
        recordAdClick(id);
      }}
      className="block hover:opacity-90"
    >
      {children}
    </a>
  );
}
