"use client";

import { useEffect, useId, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { useFeedText } from "@/components/feed-text";
import { format } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";
import { POST_MUSIC_KEYS, POST_MUSIC_MOODS, type PostMusicKey } from "@/lib/post-music";
import { startPostMusic, stopPostMusic, unlockPostMusic, usePostMusicState } from "@/lib/post-music-player";

/**
 * Picks a post's optional music: "No music" (the default) or one of the built-in original tracks, each with its own
 * preview play/stop (44px). Native radio inputs, so arrow keys move through the list in either reading direction. The
 * preview is this picker's own (one track at a time, like everywhere) and stops when the picker closes or unmounts;
 * the composer also stops it on Post (stopPostMusic). On a video it says the music replaces the video's own sound.
 */
export function PostMusicPicker({
  value,
  onChange,
  replacesVideoSound,
}: {
  value: PostMusicKey | null;
  onChange: (next: PostMusicKey | null) => void;
  replacesVideoSound: boolean;
}) {
  const { t } = useFeedText();
  const m = t.composer.music;
  const group = useId();
  const [owner] = useState(() => Symbol("post-music-preview"));
  const state = usePostMusicState();
  useEffect(() => () => stopPostMusic(owner), [owner]);

  function togglePreview(key: PostMusicKey) {
    if (state.owner === owner && state.key === key && (state.status === "playing" || state.status === "loading")) {
      stopPostMusic(owner);
      return;
    }
    unlockPostMusic();
    void startPostMusic(owner, key, 0);
  }

  const row = "flex min-h-11 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-line/50";
  return (
    <fieldset className="mt-2 rounded-xl border border-line p-2">
      <legend className="px-1 text-xs font-semibold">{m.label}</legend>
      <p className="px-1 text-xs text-foreground-soft">{m.hint}</p>
      {replacesVideoSound && <p className="mt-1 px-1 text-xs font-medium text-foreground">{m.replacesVideoSound}</p>}
      <ul className="mt-1 max-h-72 overflow-y-auto overscroll-contain">
        <li className="flex items-center">
          <label className={row}>
            <input
              type="radio"
              name={group}
              checked={value === null}
              onChange={() => onChange(null)}
              className="h-4 w-4 shrink-0 accent-accent"
            />
            <span>{m.none}</span>
          </label>
        </li>
        {POST_MUSIC_KEYS.map((key) => {
          const name = m.names[key];
          const previewing = state.owner === owner && state.key === key;
          const playing = previewing && state.status === "playing";
          const loading = previewing && state.status === "loading";
          return (
            <li key={key} className="flex items-center gap-1">
              <label className={row}>
                <input
                  type="radio"
                  name={group}
                  checked={value === key}
                  onChange={() => onChange(key)}
                  className="h-4 w-4 shrink-0 accent-accent"
                />
                <span dir="auto" className={cn("min-w-0 truncate", value === key && "font-semibold")}>
                  {name}
                </span>
                <span className="ms-auto shrink-0 text-xs text-foreground-soft">{m.moods[POST_MUSIC_MOODS[key]]}</span>
              </label>
              <button
                type="button"
                onClick={() => togglePreview(key)}
                aria-label={format(playing || loading ? m.stopPreview : m.preview, { name })}
                aria-pressed={playing}
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-line",
                  playing || loading ? "text-accent" : "text-foreground-soft",
                )}
              >
                {loading ? (
                  <Loader2 size={16} aria-hidden className="animate-spin motion-reduce:animate-none" />
                ) : playing ? (
                  <Square size={14} aria-hidden fill="currentColor" />
                ) : (
                  <Play size={16} aria-hidden />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
