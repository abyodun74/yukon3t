"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const CLASS_NAME = "mb-4 flex items-center gap-1 rounded-lg p-1.5 text-sm text-foreground-soft hover:bg-line";

/**
 * Two behaviors:
 *  - Default: goes back through browser history, or to `fallbackHref` when
 *    there's no history to go back to (a deep link opened cold).
 *  - With `href`: always navigates to that fixed page. For pages reachable
 *    from anywhere (e.g. Connections, opened from the header on any screen),
 *    where "back" through history could land somewhere unrelated and the
 *    real intent is "return to <this one place>".
 */
export function BackButton({ fallbackHref = "/home", href }: { fallbackHref?: string; href?: string }) {
  const router = useRouter();

  if (href) {
    return (
      // w-fit: unlike a <button>, an <a> set to display:flex stretches to the
      // full row, which would make the whole line a click target/hover area.
      <Link href={href} aria-label="Go back" className={`${CLASS_NAME} w-fit`}>
        <ArrowLeft size={18} />
        Back
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      aria-label="Go back"
      className={CLASS_NAME}
    >
      <ArrowLeft size={18} />
      Back
    </button>
  );
}
