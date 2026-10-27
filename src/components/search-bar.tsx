"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/** Global search bar — people, Circles, and collaborations, all from one box. Submits to /search rather than live-querying on every keystroke. */
export function SearchBar({
  initialQuery = "",
  className,
  labels,
}: {
  initialQuery?: string;
  className?: string;
  labels: { placeholder: string; label: string };
}) {
  const [value, setValue] = useState(initialQuery);
  const router = useRouter();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length < 2) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form data-guest-ok onSubmit={handleSubmit} className={className ?? "relative w-full"}>
      <Search
        size={14}
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-foreground-soft"
      />
      <input dir="auto"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={labels.placeholder}
        aria-label={labels.label}
        className="w-full rounded-full border border-line bg-surface py-1.5 ps-8 pe-3 text-sm outline-none focus:border-accent"
      />
    </form>
  );
}
