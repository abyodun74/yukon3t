"use client";

import { useState } from "react";

const DEFAULT_MAX_LENGTH = 400;

/**
 * Clamps long text to `maxLength` characters with a "Show more" toggle that
 * expands in place — the full text is already in the DOM/props, so this is
 * just a display switch, not a re-fetch. Cuts at the nearest word boundary
 * rather than mid-word.
 */
export function TruncatedText({
  text,
  maxLength = DEFAULT_MAX_LENGTH,
  className,
}: {
  text: string;
  maxLength?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (text.length <= maxLength) {
    return <p className={className}>{text}</p>;
  }

  const cutAt = text.lastIndexOf(" ", maxLength);
  const truncated = text.slice(0, cutAt > 0 ? cutAt : maxLength);

  return (
    <p className={className}>
      {expanded ? text : `${truncated}… `}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="font-medium text-accent hover:underline"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </p>
  );
}
