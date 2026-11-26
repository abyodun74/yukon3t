"use client";

import { useEffect, useRef, useState, type MouseEventHandler } from "react";
import Link from "next/link";
import { linkifyText } from "@/lib/linkify";
import { cn } from "@/lib/utils";
import { postBackgroundStyle, styledPostTextSize, type PostBackgroundStyle } from "@/lib/post-backgrounds";
import { useShellText } from "@/components/ui-text";

/** The styled box's shape: square on a phone, a little wider than tall from `sm`, never taller than 28rem in a list. */
export const STYLED_POST_BOX = "aspect-square sm:aspect-[5/4]";

/**
 * A colored-background text post (src/lib/post-backgrounds.ts): large centred text on the preset's background, in the
 * preset's own text color, so it reads the same in light and dark theme. The box has a fixed shape (no layout shift as
 * fonts or the text load). In a list (`clamp`) long or many-line text is clamped and a "Show more" link opens the
 * post's own page (`href`), which renders it with `clamp` off. Links keep the preset's text color, underlined, which is
 * what keeps them readable on every preset. Renders nothing for a key the catalogue doesn't have.
 */
export function StyledPostText({
  text,
  backgroundKey,
  clamp,
  href,
  onClick,
}: {
  text: string;
  backgroundKey: string | null | undefined;
  clamp: boolean;
  href?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  const style = postBackgroundStyle(backgroundKey);
  if (!style) return null;
  return <StyledBox text={text} style={style} clamp={clamp} href={href} onClick={onClick} backgroundKey={backgroundKey!} />;
}

function StyledBox({
  text,
  style,
  clamp,
  href,
  onClick,
  backgroundKey,
}: {
  text: string;
  style: PostBackgroundStyle;
  clamp: boolean;
  href?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  backgroundKey: string;
}) {
  const { t } = useShellText();
  const size = styledPostTextSize(text);
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  // Whether the clamp is hiding anything: measured, since it depends on the width, the reader's font size and the
  // script. Only "Show more" depends on it, and it sits inside the fixed box, so nothing moves when it appears.
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const box = boxRef.current;
    const p = textRef.current;
    if (!clamp || !box || !p || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setClipped(p.scrollHeight > p.clientHeight + 1 || p.offsetHeight > box.clientHeight + 1);
    });
    observer.observe(box);
    observer.observe(p);
    return () => observer.disconnect();
  }, [clamp, text]);

  return (
    <div
      ref={boxRef}
      onClick={onClick}
      data-post-background={backgroundKey}
      className={cn(
        "animate-styled-post-in relative mt-2 flex w-full rounded-xl [-webkit-tap-highlight-color:transparent]",
        STYLED_POST_BOX,
        clamp && "max-h-[28rem] overflow-hidden",
      )}
      style={style}
    >
      <p
        ref={textRef}
        dir="auto"
        className={cn(
          "m-auto w-full whitespace-pre-wrap break-words px-5 py-7 text-center font-semibold [overflow-wrap:anywhere]",
          clamp && "overflow-hidden pb-10",
        )}
        style={{
          fontSize: `${size.fontSizeRem}rem`,
          lineHeight: size.lineHeight,
          ...(clamp
            ? { display: "-webkit-box", WebkitBoxOrient: "vertical" as const, WebkitLineClamp: size.maxLines }
            : null),
        }}
      >
        {linkifyText(text)}
      </p>
      {clamp && clipped && href && (
        <Link
          href={href}
          prefetch={false}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-0 bottom-1.5 mx-auto w-fit px-3 py-2 text-sm font-semibold underline underline-offset-2"
        >
          {t.text.showMore}
        </Link>
      )}
    </div>
  );
}
