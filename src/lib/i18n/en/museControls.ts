/**
 * The Muse viewer's own controls (components/muse-feed.tsx): the heart Like button in the right-hand rail and the
 * video length / progress bar along the bottom of a card. Mounted by MuseControlsTextProvider in the /muse and /home
 * layouts (Home opens the Muse viewer over its feed); without a provider these fall back to this.
 */
export const museControlsEn = {
  /** Accessible name of the heart when not liked yet; {likes} is `likes` below. */
  likeLabel: "Like, {likes}",
  /** Accessible name of the heart once liked. */
  unlikeLabel: "Unlike, {likes}",
  likes: "one: # like | other: # likes",
  /** The progress bar (a slider). */
  progressLabel: "Video position",
  /** Its spoken value, e.g. "0:12 of 0:45". */
  progressValue: "{current} of {total}",
};
