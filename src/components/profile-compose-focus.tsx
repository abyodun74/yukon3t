"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Scrolls to and focuses the own-profile post composer when arriving via
 * Home's "New post" shortcut (?compose=1) — mirrors Home's own goTo()
 * scroll+focus behavior for its (now-removed) inline composer.
 */
export function ProfileComposeFocus() {
  const searchParams = useSearchParams();
  const compose = searchParams.get("compose");

  useEffect(() => {
    if (!compose) return;
    const target = document.getElementById("profile-composer");
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => target?.querySelector("textarea")?.focus(), 300);
  }, [compose]);

  return null;
}
