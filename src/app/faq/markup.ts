// The inline markup a translated FAQ answer may use (content/*.ts); see FaqContent in ids.ts. Anything else is text.
// Groups: 1 bold, 2 emphasis, 3 code, 4 link text, 5 link target (internal paths only).
export const FAQ_MARKUP = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((\/[^)\s]*)\)/g;

/** The links an answer contains. */
export function answerLinks(text: string): string[] {
  return [...text.matchAll(FAQ_MARKUP)].flatMap((match) => (match[5] === undefined ? [] : [match[5]]));
}
