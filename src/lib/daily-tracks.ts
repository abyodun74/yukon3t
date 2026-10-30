import type { DailyParticipant } from "@daily-co/daily-js";

/** Whether a Daily participant's track is on: anything but "off" or "blocked" (e.g. "playable", "loading", "sendable"). */
export function trackIsOn(state: DailyParticipant["tracks"]["audio"]["state"]) {
  return state !== "off" && state !== "blocked";
}
