import { Fragment, isValidElement, type ReactNode } from "react";
import { FAQ_MARKUP } from "./markup";

// An FAQ answer as plain text, for the page's FAQPage structured data: exactly the words the page shows, with a line
// break where the page has <br /> and the inline markup (bold, emphasis, code, links) reduced to its text.
// faq-json-ld.test.ts renders the page and checks the two agree.

function normalize(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) {
    if (node.type === "br") return "\n";
    // Host elements (strong, em, a, code) and fragments: their children are the text. The English answers use
    // nothing else; anything else is read the same way rather than dropped.
    const children = (node.props as { children?: ReactNode }).children;
    return node.type === Fragment || typeof node.type === "string" || children !== undefined ? nodeText(children) : "";
  }
  return "";
}

/** The text of an English answer (JSX in page.tsx). */
export function reactNodeToText(node: ReactNode): string {
  return normalize(nodeText(node));
}

/** The text of a translated answer (content/*.ts markup, as FaqAnswer draws it). */
export function faqMarkupToText(text: string): string {
  return normalize(
    text
      .split("\n\n")
      .map((paragraph) =>
        paragraph.replace(FAQ_MARKUP, (_whole, bold, emphasis, code, linkText) => bold ?? emphasis ?? code ?? linkText ?? ""),
      )
      .join("\n\n"),
  );
}
