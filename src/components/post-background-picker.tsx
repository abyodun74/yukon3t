"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { Ban, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  POST_BACKGROUND_KEYS,
  postBackgroundStyle,
  type PostBackgroundKey,
} from "@/lib/post-backgrounds";
import { useFeedText } from "@/components/feed-text";

type Option = PostBackgroundKey | null;
const OPTIONS: readonly Option[] = [null, ...POST_BACKGROUND_KEYS];

/** Which option an arrow / Home / End key moves to (a radio group wraps round). RTL swaps left and right. */
export function nextBackgroundOption(current: Option, key: string, rtl: boolean): Option | undefined {
  const index = Math.max(0, OPTIONS.indexOf(current));
  const last = OPTIONS.length - 1;
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  const backward = rtl ? "ArrowRight" : "ArrowLeft";
  if (key === forward || key === "ArrowDown") return OPTIONS[index === last ? 0 : index + 1];
  if (key === backward || key === "ArrowUp") return OPTIONS[index === 0 ? last : index - 1];
  if (key === "Home") return OPTIONS[0];
  if (key === "End") return OPTIONS[last];
  return undefined;
}

/**
 * The composer's background picker for a text-only post, or the frame picker for the author's own video (`forVideo`:
 * same presets, named as a frame): "No background" / "No frame" then every preset, as one radio group in a
 * horizontally scrolling row. 44px targets; one tab stop (the checked option), arrow keys move and select (mirrored in
 * right-to-left languages), Home/End jump to the ends; every swatch is named in the reader's language.
 */
export function PostBackgroundPicker({
  value,
  onChange,
  disabled,
  forVideo = false,
}: {
  value: Option;
  onChange: (next: Option) => void;
  disabled?: boolean;
  forVideo?: boolean;
}) {
  const { t } = useFeedText();
  const text = t.composer.background;
  const hintId = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const next = nextBackgroundOption(value, e.key, rtl);
    if (next === undefined) return;
    e.preventDefault();
    onChange(next);
    const button = buttons.current.get(next ?? "");
    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  return (
    <div className="mt-2">
      <div
        role="radiogroup"
        aria-label={forVideo ? text.frameLabel : text.label}
        aria-describedby={hintId}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        className="flex gap-2 overflow-x-auto overscroll-x-contain p-1"
      >
        {OPTIONS.map((option) => {
          const checked = option === value;
          const style = postBackgroundStyle(option);
          const name = option ? text.names[option] : forVideo ? text.frameNone : text.none;
          return (
            <button
              key={option ?? "none"}
              ref={(el) => {
                if (el) buttons.current.set(option ?? "", el);
                else buttons.current.delete(option ?? "");
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={name}
              title={name}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option)}
              className={cn(
                "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm font-semibold disabled:opacity-50",
                style ? "border-black/10" : "border-line bg-background text-foreground-soft",
                checked && "outline-2 outline-offset-2 outline-accent outline-solid",
              )}
              style={style ?? undefined}
            >
              {option === null ? (
                <Ban size={18} aria-hidden />
              ) : checked ? (
                <Check size={18} strokeWidth={3} aria-hidden />
              ) : (
                <span aria-hidden>{forVideo ? "" : "Aa"}</span>
              )}
            </button>
          );
        })}
      </div>
      <p id={hintId} className="mt-0.5 text-[0.6875rem] text-foreground-soft">
        {forVideo ? text.frameHint : text.hint}
      </p>
    </div>
  );
}
