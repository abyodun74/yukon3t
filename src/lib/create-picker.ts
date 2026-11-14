// The "+" on your own profile picture (the "Your story" ring on Home, the avatar on your own profile) opens a small
// picker: Story, Feed post or Muse. Each choice leads to that type's existing composer; nothing here creates content.
// Pure so the order and the feed-post destination are unit-tested (src/lib/create-picker.test.ts).

export const CREATE_PICKER_KINDS = ["story", "feed", "muse"] as const;
export type CreatePickerKind = (typeof CREATE_PICKER_KINDS)[number];

/** The id of the own-profile post composer's wrapper on /u/<id> (src/app/u/[userId]/page.tsx). */
export const PROFILE_COMPOSER_ID = "profile-composer";

/**
 * Where "Feed post" goes when the composer isn't on the current screen: your own profile, whose ProfileComposeFocus
 * scrolls to and focuses the composer on `?compose=1` (same destination as Home's "New post" quick action).
 */
export function feedComposeHref(userId: string): string {
  return `/u/${encodeURIComponent(userId)}?compose=1`;
}

/** A choice that opens a full-screen composer over the page (Feed post goes to the profile's inline composer). */
export type CreateComposerKind = Exclude<CreatePickerKind, "feed">;

/**
 * The picker -> composer hand-off, as a state machine (2026-11-14). Choosing Story used to close the picker and open
 * the Story composer in the same render, two overlays swapping at once, and on iPhone the composer could come up
 * invisible. Now the picker closes FIRST and the composer opens only once the picker's exit animation has finished
 * (Sheet's onExitComplete), or after CREATE_PICKER_HANDOFF_MAX_MS if that never comes (a WebView whose animation
 * frames are paused): never both on screen, and never neither (during the hand-off the picker is still on screen,
 * leaving).
 *
 * - closed: nothing is open.
 * - picker: the picker is open.
 * - handoff: the picker is closing; `next` opens as soon as it has gone.
 * - composer: the Story / Muse composer is open.
 */
export type CreateFlowState =
  | { phase: "closed" }
  | { phase: "picker" }
  | { phase: "handoff"; next: CreateComposerKind }
  | { phase: "composer"; kind: CreateComposerKind };

export type CreateFlowEvent =
  | { type: "open" }
  | { type: "dismiss" }
  | { type: "choose"; kind: CreatePickerKind }
  | { type: "pickerExited" }
  | { type: "handoffTimeout" }
  | { type: "composerClosed" };

/** Longest the hand-off waits for the picker's exit (Sheet's bottom-sheet tween is 0.3s) before opening anyway. */
export const CREATE_PICKER_HANDOFF_MAX_MS = 450;

export const CREATE_FLOW_CLOSED: CreateFlowState = { phase: "closed" };

export function createFlowReducer(state: CreateFlowState, event: CreateFlowEvent): CreateFlowState {
  switch (event.type) {
    case "open":
      // Only from rest: a second tap on the + while something is already up changes nothing.
      return state.phase === "closed" ? { phase: "picker" } : state;
    case "dismiss":
      return state.phase === "picker" ? CREATE_FLOW_CLOSED : state;
    case "choose":
      if (state.phase !== "picker") return state;
      // Feed post leaves the picker for the profile composer (focused or navigated to by the caller).
      if (event.kind === "feed") return CREATE_FLOW_CLOSED;
      return { phase: "handoff", next: event.kind };
    case "pickerExited":
    case "handoffTimeout":
      return state.phase === "handoff" ? { phase: "composer", kind: state.next } : state;
    case "composerClosed":
      return state.phase === "composer" ? CREATE_FLOW_CLOSED : state;
  }
}

/** What to render for a state: whether the picker sheet is open, and which composer (if any) is open. */
export function createFlowView(state: CreateFlowState): { pickerOpen: boolean; composer: CreateComposerKind | null } {
  return {
    pickerOpen: state.phase === "picker",
    composer: state.phase === "composer" ? state.kind : null,
  };
}

/** What is on screen: the picker, the picker while it leaves, a composer, or nothing. */
export function createFlowOnScreen(state: CreateFlowState): "picker" | "picker-leaving" | CreateComposerKind | null {
  if (state.phase === "picker") return "picker";
  if (state.phase === "handoff") return "picker-leaving";
  if (state.phase === "composer") return state.kind;
  return null;
}
