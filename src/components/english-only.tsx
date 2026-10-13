/**
 * Marks a part of the page that is still written in English, so it stays left-to-right and is announced as English
 * while the page around it (<html>) is in the reader's language. Used by the layouts of the route segments that are
 * not translated yet and around the call overlays; remove it from a segment when that segment is translated.
 * `contents` keeps the wrapper out of layout (display: contents) for children that position themselves.
 */
export function EnglishOnly({ children, contents = false }: { children: React.ReactNode; contents?: boolean }) {
  return (
    <div lang="en" dir="ltr" className={contents ? "contents" : undefined}>
      {children}
    </div>
  );
}
