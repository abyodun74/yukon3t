// iOS reports a cold start's universal link twice: as App.getLaunchUrl() and, once the plugins load, as a replayed
// `appUrlOpen` (Capacitor's SceneDelegateProxy). The same URL arriving again within this window is that echo, not a
// second tap; capacitor-bridge.tsx opens it once. A deliberate second tap on the same link later still opens.

export const REPEAT_OPEN_WINDOW_MS = 3_000;

let last: { url: string; at: number } | null = null;

export function isRepeatOpen(url: string, now: number): boolean {
  const repeat = last !== null && last.url === url && now >= last.at && now - last.at < REPEAT_OPEN_WINDOW_MS;
  last = { url, at: now };
  return repeat;
}

/** Tests only. */
export function resetRepeatOpenForTests() {
  last = null;
}
