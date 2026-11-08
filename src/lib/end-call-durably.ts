"use client";

import { endCall } from "@/app/actions/calls";
import { retryUntilAnswered } from "@/lib/call-resilience";
import type { CallDevice } from "@/lib/voip-ring-targets";

const pending = new Set<string>();

/**
 * endCall for a hang-up that has to land even though nothing is left to
 * wait on it: the call UI is torn down the moment the user hangs up, and a
 * call that ends because its reconnect ran out of retries is by definition
 * ending with the network down. Module-level rather than tied to whichever
 * component started the call, which may be long unmounted by then. Retries
 * with backoff and on the browser's "online" event until the server has
 * answered, bounded by END_CALL_RETRY_WINDOW_MS (see retryUntilAnswered) —
 * past that, the other side's grace period or the timeout-missed-calls sweep
 * closes the row. `device`: see endCall.
 */
export function endCallDurably(callId: string, device?: CallDevice) {
  if (pending.has(callId)) return;
  pending.add(callId);
  retryUntilAnswered({
    attempt: () => endCall(callId, device),
    subscribeOnline: (retryNow) => {
      window.addEventListener("online", retryNow);
      return () => window.removeEventListener("online", retryNow);
    },
    onSettled: () => pending.delete(callId),
  });
}
