"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function MultiSelect({
  name,
  options,
  defaultValues = [],
  placeholder = "Search and select...",
  max,
}: {
  name: string;
  options: readonly string[];
  defaultValues?: string[];
  placeholder?: string;
  max?: number;
}) {
  const [selected, setSelected] = useState<string[]>(defaultValues);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) => !selected.includes(o) && (q === "" || o.toLowerCase().includes(q)),
    );
  }, [options, selected, query]);

  const atMax = typeof max === "number" && selected.length >= max;

  function add(value: string) {
    if (atMax || selected.includes(value)) return;
    setSelected((prev) => [...prev, value]);
    setQuery("");
    // Close after each pick — an open panel is absolutely positioned and can
    // otherwise float over and block clicks on form fields below it.
    setOpen(false);
  }

  function remove(value: string) {
    setSelected((prev) => prev.filter((v) => v !== value));
  }

  return (
    <div ref={containerRef} className="relative">
      {selected.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}

      <div
        className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 focus-within:border-accent"
        onClick={() => setOpen(true)}
      >
        {selected.map((value) => (
          <span
            key={value}
            className="flex items-center gap-1 rounded-full bg-teal/10 px-2 py-0.5 text-xs text-teal"
          >
            {value}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(value);
              }}
              aria-label={`Remove ${value}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={selected.length === 0 ? placeholder : ""}
          disabled={atMax}
          className="min-w-[8ch] flex-1 bg-transparent text-sm outline-none disabled:cursor-not-allowed"
        />
        <ChevronDown size={14} className="shrink-0 text-foreground-soft" />
      </div>

      {open && !atMax && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-foreground-soft">No matches</p>
          ) : (
            filtered.slice(0, 40).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => add(option)}
                className={cn(
                  "block w-full px-3 py-2 text-left text-sm hover:bg-line",
                )}
              >
                {option}
              </button>
            ))
          )}
        </div>
      )}
      {max && (
        <p className="mt-1 text-xs text-foreground-soft">
          {selected.length}/{max} selected
        </p>
      )}
    </div>
  );
}
