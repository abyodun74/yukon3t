import type { ReactNode } from "react";
import { FAQ_MARKUP } from "./markup";


function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(FAQ_MARKUP)) {
    const [whole, bold, emphasis, code, linkText, href] = match;
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${match.index}`;
    if (bold !== undefined) out.push(<strong key={key}>{bold}</strong>);
    else if (emphasis !== undefined) out.push(<em key={key}>{emphasis}</em>);
    else if (code !== undefined)
      // A web address or file name: left-to-right whatever the language around it.
      out.push(
        <code key={key} dir="ltr">
          {code}
        </code>,
      );
    else
      out.push(
        <a key={key} href={href} className="text-accent hover:underline">
          {linkText}
        </a>,
      );
    last = match.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A translated answer: its paragraphs separated the way the English JSX separates them (two line breaks). */
export function FaqAnswer({ text }: { text: string }) {
  return text.split("\n\n").map((paragraph, index) => (
    <span key={index}>
      {index > 0 && (
        <>
          <br />
          <br />
        </>
      )}
      {inline(paragraph, String(index))}
    </span>
  ));
}

