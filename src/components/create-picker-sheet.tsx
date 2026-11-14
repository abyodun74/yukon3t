"use client";

import { useEffect, useReducer, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, ImagePlus, Plus, SquarePen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/sheet";
import { StoryUploadModal } from "@/components/story-upload-modal";
import { MuseComposer } from "@/components/muse-composer";
import { useFeedText } from "@/components/feed-text";
import {
  CREATE_FLOW_CLOSED,
  CREATE_PICKER_HANDOFF_MAX_MS,
  CREATE_PICKER_KINDS,
  PROFILE_COMPOSER_ID,
  createFlowReducer,
  createFlowView,
  feedComposeHref,
  type CreatePickerKind,
} from "@/lib/create-picker";

/** Scrolls to and focuses the own-profile composer when it is on this screen; false when it isn't. */
function focusProfileComposer(): boolean {
  const target = document.getElementById(PROFILE_COMPOSER_ID);
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  // After the sheet has closed and handed focus back, so this focus wins (see useDialogFocus).
  window.setTimeout(() => target.querySelector("textarea")?.focus(), 300);
  return true;
}

/**
 * The "+" on your own profile picture (Home's "Your story" ring and the avatar on your own profile). Tapping it opens
 * a small bottom sheet with Story / Feed post / Muse, each leading to that type's existing composer: the story upload
 * modal, the profile post composer (scrolled to and focused here, or reached via /u/<id>?compose=1 from elsewhere),
 * and the Muse composer. Owns the picker and both modals so its callers only place the button.
 *
 * Choosing Story or Muse is a hand-off (createFlowReducer, src/lib/create-picker.ts): the picker closes first and the
 * composer opens once the picker has left the screen (its Sheet's onExitComplete, or CREATE_PICKER_HANDOFF_MAX_MS),
 * never both at once. All three render through the root overlay host (Sheet portals), never inside the story tray's
 * horizontal scroller or the avatar this button sits on.
 *
 * `buttonClassName` positions the 44px tap target around the small visible badge.
 */
export function CreatePickerButton({ userId, buttonClassName }: { userId: string; buttonClassName: string }) {
  const { t } = useFeedText();
  const text = t.createPicker;
  const router = useRouter();
  const [flow, dispatch] = useReducer(createFlowReducer, CREATE_FLOW_CLOSED);
  const { pickerOpen, composer } = createFlowView(flow);

  // The hand-off's backstop: the composer opens even if the picker's exit animation never reports finishing.
  const handingOff = flow.phase === "handoff";
  useEffect(() => {
    if (!handingOff) return undefined;
    const timer = window.setTimeout(() => dispatch({ type: "handoffTimeout" }), CREATE_PICKER_HANDOFF_MAX_MS);
    return () => window.clearTimeout(timer);
  }, [handingOff]);

  function choose(kind: CreatePickerKind) {
    dispatch({ type: "choose", kind });
    if (kind === "feed" && !focusProfileComposer()) router.push(feedComposeHref(userId));
  }

  const options: Record<CreatePickerKind, { label: string; hint: string; icon: ReactNode; iconClassName: string }> = {
    story: { label: text.story, hint: text.storyHint, icon: <ImagePlus size={18} aria-hidden />, iconClassName: "bg-teal text-white" },
    feed: { label: text.feed, hint: text.feedHint, icon: <SquarePen size={18} aria-hidden />, iconClassName: "bg-accent text-accent-ink" },
    muse: { label: text.muse, hint: text.museHint, icon: <Clapperboard size={18} aria-hidden />, iconClassName: "bg-foreground text-background" },
  };

  return (
    <>
      <button
        type="button"
        data-guest-block
        onClick={() => dispatch({ type: "open" })}
        aria-label={text.open}
        aria-haspopup="dialog"
        className={cn("absolute flex h-11 w-11 items-center justify-center", buttonClassName)}
      >
        <span className="rounded-full border-2 border-background bg-accent p-1 text-accent-ink">
          <Plus size={12} aria-hidden />
        </span>
      </button>

      <Sheet
        open={pickerOpen}
        onClose={() => dispatch({ type: "dismiss" })}
        onExitComplete={() => dispatch({ type: "pickerExited" })}
        variant="bottom-sheet"
        responsive
        title={text.title}
        panelClassName="sm:max-w-sm"
      >
        <ul className="space-y-1">
          {CREATE_PICKER_KINDS.map((kind) => {
            const option = options[kind];
            return (
              <li key={kind}>
                <button
                  type="button"
                  onClick={() => choose(kind)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-start hover:bg-line/60"
                >
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", option.iconClassName)}>
                    {option.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="block text-xs text-foreground-soft">{option.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>

      <StoryUploadModal open={composer === "story"} onClose={() => dispatch({ type: "composerClosed" })} />
      <MuseComposer open={composer === "muse"} onClose={() => dispatch({ type: "composerClosed" })} />
    </>
  );
}
