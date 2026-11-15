import type { ReactNode } from "react";
import Link from "next/link";
import { classifyLink } from "@/lib/app-links";

/**
 * Renders `text` as plain text with any http(s) URL turned into a real clickable link (chat messages, post captions,
 * comments shown through TruncatedText). The link text is always what was typed. Where it goes depends on what it
 * points to (classifyLink, src/lib/app-links.ts):
 * - a YuKon3t page (https://yukon3t.com/..., www too) is an in-app link to that path: same window, client-side
 *   navigation, so in the native app it never leaves the WebView for Safari/Chrome;
 * - any other site opens outside the app (target="_blank" + rel="noopener noreferrer": a new tab on the web, the
 *   system browser in the app).
 * onClick stops propagation so tapping the link inside a clickable bubble/card doesn't also trigger whatever that
 * container's own click does.
 */
export function linkifyText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"']+/gi)) {
    const url = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
    const target = classifyLink(url);
    if (target.kind === "internal") {
      nodes.push(
        <Link key={key++} href={target.path} prefetch={false} className="underline" onClick={(e) => e.stopPropagation()}>
          {url}
        </Link>,
      );
    } else if (target.kind === "external") {
      nodes.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>,
      );
    } else {
      nodes.push(url);
    }
    lastIndex = index + url.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length > 0 ? nodes : [text];
}
