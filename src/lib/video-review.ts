// Automated review for post videos over Hive's 60s scan limit (see
// storage.ts's HIVE_VIDEO_MODERATION_MAX_SECONDS and createPost's
// videoNeedsManualReview) — these publish hidden (moderationStatus FLAGGED)
// at creation time, and this is what turns that hidden state into a real
// verdict: PUBLISHED if clean, deleted outright if flagged. Driven by the
// moderate-long-videos cron, one post per tick.
//
// One call to advanceLongVideoReview covers exactly one cron tick's worth of
// work. Cloudflare Stream processing a full-length video (copy/encode, then
// caption generation) routinely spans several ticks, so this is written to
// be safely called repeatedly against the same post: it re-derives what to
// do next from Cloudflare's own live status rather than tracking its own
// separate stage field, so a killed/timed-out tick just gets redone by the
// next one with no lost progress beyond that one tick's API calls.
import {
  isStreamConfigured,
  createStreamCopy,
  isStreamReady,
  getCaptionState,
  requestCaptions,
  getCaptionsVtt,
  vttToPlainText,
  thumbnailUrl,
  deleteStreamVideo,
} from "@/lib/cloudflare-stream";
import { moderateText, moderateImage } from "@/lib/moderation";
import { containsProfanity } from "@/lib/profanity-wordlist";

export type VideoReviewResult =
  // Still waiting on Cloudflare (copy/encode or caption generation) —
  // caller should persist `streamUid` (if newly created) and try again next
  // tick. Not a failure: this is the expected state for most ticks of a
  // long video's review.
  | { kind: "in_progress"; streamUid: string }
  // A Stream call itself failed (network/API error, or Stream not
  // configured) — caller should unclaim so a later tick retries from
  // scratch, without treating this as a content verdict either way.
  | { kind: "error" }
  | { kind: "clean" }
  | { kind: "flagged"; reasons: string[] };

// Sampled every 30s across the whole video (not just Hive's old 60s window)
// — capped so a mis-reported/unbounded duration can't turn into an unbounded
// number of OpenAI calls in one tick.
const FRAME_INTERVAL_SECONDS = 30;
const MAX_FRAMES = 120;
const FRAME_MODERATION_CONCURRENCY = 10;

async function moderateFramesConcurrently(streamUid: string, durationSeconds: number): Promise<string[]> {
  const frameCount = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(durationSeconds / FRAME_INTERVAL_SECONDS)));
  const timestamps = Array.from({ length: frameCount }, (_, i) => i * FRAME_INTERVAL_SECONDS);

  const reasons: string[] = [];
  for (let i = 0; i < timestamps.length; i += FRAME_MODERATION_CONCURRENCY) {
    const batch = timestamps.slice(i, i + FRAME_MODERATION_CONCURRENCY);
    const results = await Promise.all(
      batch.map((t) => moderateImage(thumbnailUrl(streamUid, t))),
    );
    results.forEach((result, idx) => {
      if (!result.allowed) {
        reasons.push(`frame@${batch[idx]}s: ${result.flaggedCategories.join(",")}`);
      }
    });
  }
  return reasons;
}

export async function advanceLongVideoReview({
  videoUrl,
  videoDurationSeconds,
  streamUid,
}: {
  videoUrl: string;
  videoDurationSeconds: number;
  streamUid: string | null;
}): Promise<VideoReviewResult> {
  if (!isStreamConfigured()) {
    // Nothing this job can safely do — leave the post FLAGGED (hidden) for
    // an admin to handle via the existing manual queue rather than either
    // guessing at a verdict or auto-publishing something never actually
    // reviewed.
    return { kind: "error" };
  }

  let uid = streamUid;
  if (!uid) {
    uid = await createStreamCopy(videoUrl);
    if (!uid) return { kind: "error" };
    return { kind: "in_progress", streamUid: uid };
  }

  const ready = await isStreamReady(uid);
  if (ready === null) return { kind: "error" };
  if (!ready) return { kind: "in_progress", streamUid: uid };

  const captionState = await getCaptionState(uid);
  if (captionState === null) return { kind: "error" };

  if (captionState === "missing") {
    const requested = await requestCaptions(uid);
    if (!requested) return { kind: "error" };
    return { kind: "in_progress", streamUid: uid };
  }
  if (captionState === "inprogress") {
    return { kind: "in_progress", streamUid: uid };
  }

  // captionState is "ready" or "error" here — an errored caption *job* isn't
  // treated as a pipeline failure: frame moderation alone is still a
  // meaningful check, so this proceeds without a transcript rather than
  // stalling the post's review forever over one sub-feature. A failed VTT
  // *fetch* despite Cloudflare reporting "ready" is different — that's a
  // transient error on our side, not a real "no transcript exists" case, so
  // it retries next tick rather than silently finalizing a verdict without
  // ever having checked the transcript.
  const transcriptReasons: string[] = [];
  if (captionState === "ready") {
    const vtt = await getCaptionsVtt(uid);
    if (vtt === null) return { kind: "error" };
    const transcript = vttToPlainText(vtt);
    const [textResult, profanity] = await Promise.all([
      moderateText(transcript),
      Promise.resolve(containsProfanity(transcript)),
    ]);
    if (!textResult.allowed) {
      transcriptReasons.push(`audio: ${textResult.flaggedCategories.join(",")}`);
    }
    if (profanity.flagged) {
      transcriptReasons.push(`audio: profanity (${profanity.matches.join(",")})`);
    }
  }

  const frameReasons = await moderateFramesConcurrently(uid, videoDurationSeconds);
  const reasons = [...transcriptReasons, ...frameReasons];

  await deleteStreamVideo(uid);

  return reasons.length > 0 ? { kind: "flagged", reasons } : { kind: "clean" };
}
