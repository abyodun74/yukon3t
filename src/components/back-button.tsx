"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useShellText } from "@/components/ui-text";
import { localeDirection } from "@/lib/i18n/locales";

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
export function BackButton({
  fallbackHref = "/home",
  href,
  label,
}: {
  fallbackHref?: string;
  href?: string;
  /** Left out, it is "Back" in the reader's language, on a screen that is still English too (hence its own `lang` and `dir`). */
  label?: string;
}) {
  const router = useRouter();
  const { locale, t } = useShellText();
  const lang = label === undefined ? locale : undefined;
  const dir = lang ? localeDirection(lang) : undefined;
  const text = label ?? t.common.back;

  if (href) {
    return (
      // w-fit: unlike a <button>, an <a> set to display:flex stretches to the
      // full row, which would make the whole line a click target/hover area.
      <Link href={href} lang={lang} dir={dir} className={`${CLASS_NAME} w-fit`}>
        <ArrowLeft size={18} className="rtl:-scale-x-100" />
        {text}
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
      lang={lang}
      dir={dir}
      className={CLASS_NAME}
    >
      <ArrowLeft size={18} className="rtl:-scale-x-100" />
      {text}
    </button>
  );
}
