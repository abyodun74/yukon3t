import type { ReactNode } from "react";

/**
 * Renders `text` as plain text with any http(s) URL turned into a real
 * clickable link — confirmed live: a link forwarded to a friend
 * (share-target-gate.tsx's sendToFriend, the one case a shared link
 * genuinely has to travel as plain message content rather than an embed)
 * rendered as inert text with no way to tap it open. Opens in a new tab/
 * the native browser (target="_blank" + rel="noopener noreferrer"), never
 * inside this app's own WebView, since a pasted link is almost always to
 * some other site. onClick stops propagation so tapping the link inside a
 * clickable bubble/card doesn't also trigger whatever that container's own
 * click does.
 */
export function linkifyText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"']+/gi)) {
    const url = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
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
    lastIndex = index + url.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length > 0 ? nodes : [text];
}
