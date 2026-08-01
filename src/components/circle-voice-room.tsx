"use client";

import { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import { joinCircleVoiceRoom, leaveCircleVoiceRoom, getCircleVoiceParticipants } from "@/app/actions/circle-voice";
import { CallFrame } from "@/components/call-frame";

const POLL_INTERVAL_MS = 3000;

type Participant = { id: string; name: string };
type ActiveRoom = { roomUrl: string; token: string };

function joinErrorMessage(code?: string) {
  switch (code) {
    case "not_configured":
      return "Voice rooms aren't set up yet.";
    case "not_a_member":
      return "Join this Circle first to use the voice room.";
    default:
      return "Couldn't join the voice room — try again.";
  }
}

/** Persistent, drop-in voice room for a Circle — no ringing, members join/leave freely. */
export function CircleVoiceRoom({ circleId, canJoin }: { circleId: string; canJoin: boolean }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [active, setActive] = useState<ActiveRoom | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (active) return undefined;
    let cancelled = false;
    const poll = async () => {
      const { participants: list } = await getCircleVoiceParticipants(circleId);
      if (!cancelled) setParticipants(list);
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [circleId, active]);

  async function join() {
    setError(null);
    const result = await joinCircleVoiceRoom(circleId);
    if (result.error || !result.roomUrl || !result.token) {
      setError(joinErrorMessage(result.error ?? undefined));
      return;
    }
    setActive({ roomUrl: result.roomUrl, token: result.token });
  }

  function leave() {
    leaveCircleVoiceRoom(circleId);
    setActive(null);
  }

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Mic size={16} className="text-foreground-soft" />
          {participants.length === 0 ? (
            <span className="text-foreground-soft">No one&apos;s in the voice room</span>
          ) : (
            <span>
              {participants.length} talking:{" "}
              <span className="text-foreground-soft">{participants.map((p) => p.name).join(", ")}</span>
            </span>
          )}
        </div>
        {canJoin && (
          <button
            type="button"
            onClick={join}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
          >
            Join voice
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {active && (
        <CallFrame roomUrl={active.roomUrl} token={active.token} type="AUDIO" onLeave={leave} />
      )}
    </div>
  );
}
