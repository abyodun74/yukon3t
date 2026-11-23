// Rules for keeping a Story video playing, or getting it out of a frozen state, in the Story viewer
// (src/components/story-viewer.tsx). Pure, so they run in tests without a DOM.
//
// The bug these exist for (owner report 2026-11-22, "this story not playing after other stories played"): the
// viewer called video.play() once per story and swallowed every rejection. Anything that paused the video
// afterwards (the app-wide one-video-at-a-time rule reacting to a feed video under the viewer starting, see
// installMediaGuard) or a play() that never got going left the story on its first frame with an empty
// progress bar forever: no image timer, no retry, nothing to tap.

/** No forward progress for this long while the story should be playing: try starting it again, once. */
export const STORY_VIDEO_STALL_RETRY_MS = 6000;
/** Still no progress this long after the last (re)start: stop waiting and show "Tap to play". */
export const STORY_VIDEO_STALL_GIVE_UP_MS = 12000;
/** How often the stall watchdog looks. */
export const STORY_VIDEO_WATCHDOG_INTERVAL_MS = 1000;
/**
 * Automatic restarts after something else paused the video, per story. Bounded so the viewer never fights the OS
 * (another app taking audio focus) or another player in a loop: past this, "Tap to play" is shown instead.
 */
export const STORY_VIDEO_MAX_AUTO_RESUMES = 3;

/** Why a Story video isn't playing when it should be, as shown to the viewer. */
export type StoryVideoIssue = "blocked" | "stalled" | "error";

export type PlayFailureAction = "retry-muted" | "blocked" | "error" | "ignore";

/**
 * What to do when video.play() rejects.
 * - NotAllowedError: the browser refused playback without a tap. Unmuted, try again muted (allowed everywhere
 *   muted autoplay is); already muted, only a tap can start it.
 * - NotSupportedError: the file can't be played here (an HEVC .mov on many Android phones, a broken upload).
 * - AbortError and anything else: the play was interrupted (a pause, a new source); the pause handler and the
 *   stall watchdog deal with what happens next.
 */
export function playFailureAction(error: unknown, muted: boolean): PlayFailureAction {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "NotAllowedError") return muted ? "blocked" : "retry-muted";
  if (name === "NotSupportedError") return "error";
  return "ignore";
}

/**
 * Whether a `pause` event on the story's video should be undone by playing again: only when the viewer wants it
 * playing (no hold, Pause, panel, sheet or close), the video didn't simply end, it is still on the page and
 * visible, no issue is already shown, and the per-story budget of automatic restarts isn't used up.
 */
export function shouldResumeAfterPause(s: {
  wantPlaying: boolean;
  ended: boolean;
  connected: boolean;
  pageVisible: boolean;
  issueShown: boolean;
  autoResumes: number;
}): boolean {
  return (
    s.wantPlaying &&
    !s.ended &&
    s.connected &&
    s.pageVisible &&
    !s.issueShown &&
    s.autoResumes < STORY_VIDEO_MAX_AUTO_RESUMES
  );
}

export type StallAction = "wait" | "retry" | "give-up";

/**
 * The stall watchdog's decision, from how long the video has gone without forward progress since it was last
 * (re)started and how many watchdog restarts it has had: one restart, then "Tap to play".
 */
export function stallAction(msWithoutProgress: number, retries: number): StallAction {
  if (retries === 0) return msWithoutProgress >= STORY_VIDEO_STALL_RETRY_MS ? "retry" : "wait";
  return msWithoutProgress >= STORY_VIDEO_STALL_GIVE_UP_MS - STORY_VIDEO_STALL_RETRY_MS ? "give-up" : "wait";
}

// --- A Muse's sound track on a Story (Story.audioUrl, shareMuseToStory) ---------------------------------------------
//
// The video plays muted and a separate <audio> plays the track, like the Muse viewer (muse-feed.tsx): both from 0,
// the track looping over its own length. The video stays the clock: the track only plays while the video is actually
// playing (paused on its pause, buffering and end, so a hold, the Pause button, a sheet, a call or a stall silence
// it too), and is moved back into step whenever it has drifted.

/** How far (seconds) the track may drift from the video before it is moved back into step. */
export const STORY_SOUND_TRACK_MAX_DRIFT_S = 0.3;

/**
 * Where the track should be for the video's current time: the video's time, wrapped over the track's length (the
 * track loops). Null while the track's length isn't known yet (nothing to align against).
 */
export function soundTrackPosition(videoTime: number, trackDuration: number): number | null {
  if (!Number.isFinite(trackDuration) || trackDuration <= 0 || !Number.isFinite(videoTime) || videoTime < 0) return null;
  return videoTime % trackDuration;
}

/** Whether the track, at `trackTime`, is out of step with `target` (measured around the loop, so the wrap point isn't drift). */
export function soundTrackOutOfStep(trackTime: number, target: number, trackDuration: number): boolean {
  const gap = Math.abs(trackTime - target);
  return Math.min(gap, trackDuration - gap) > STORY_SOUND_TRACK_MAX_DRIFT_S;
}
