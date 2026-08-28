"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, UserPlus, X } from "lucide-react";
import {
  joinCircleVoiceRoom,
  leaveCircleVoiceRoom,
  getCircleVoiceParticipants,
  inviteToVoiceChannel,
  getVoiceChannelInviteCounts,
} from "@/app/actions/circle-voice";
import { CallFrame } from "@/components/call-frame";
import { UserAvatar } from "@/components/user-link";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 5000;

type Participant = { id: string; name: string };
type ActiveRoom = { roomUrl: string; token: string };
type CircleMember = { id: string; name: string | null; avatarUrl: string | null };
type InviteCounts = { pending: number; accepted: number; declined: number };

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

function inviteErrorMessage(code?: string) {
  switch (code) {
    case "not_a_member":
      return "That person isn't a member of this Circle.";
    case "rate_limited":
      return "Slow down a little — try again shortly.";
    default:
      return "Couldn't send that invite — try again.";
  }
}

/** Persistent, drop-in voice room for one voice Channel — no ringing, members join/leave freely. */
export function CircleVoiceRoom({
  channelId,
  canJoin,
  circleMembers,
}: {
  channelId: string;
  canJoin: boolean;
  circleMembers: CircleMember[];
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [active, setActive] = useState<ActiveRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteCounts, setInviteCounts] = useState<InviteCounts>({ pending: 0, accepted: 0, declined: 0 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const channelIdRef = useRef(channelId);
  useEffect(() => {
    channelIdRef.current = channelId;
  });

  const poll = useCallback(async () => {
    const forId = channelIdRef.current;
    const [{ participants: list }, counts] = await Promise.all([
      getCircleVoiceParticipants(forId),
      getVoiceChannelInviteCounts(forId),
    ]);
    // Ignore a response that arrives after the user has switched channels.
    if (channelIdRef.current === forId) {
      setParticipants(list);
      setInviteCounts(counts);
    }
  }, []);

  usePolling(poll, POLL_INTERVAL_MS, !active);

  async function join() {
    setError(null);
    const result = await joinCircleVoiceRoom(channelId);
    if (result.error || !result.roomUrl || !result.token) {
      setError(joinErrorMessage(result.error ?? undefined));
      return;
    }
    setActive({ roomUrl: result.roomUrl, token: result.token });
  }

  function leave() {
    leaveCircleVoiceRoom(channelId);
    setActive(null);
  }

  async function invite(memberId: string) {
    setInviteError(null);
    const result = await inviteToVoiceChannel(channelId, memberId);
    if (result.error) {
      setInviteError(inviteErrorMessage(result.error));
      return;
    }
    setInvitedIds((prev) => new Set(prev).add(memberId));
    setInviteCounts(await getVoiceChannelInviteCounts(channelId));
  }

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Mic size={16} className="shrink-0 text-foreground-soft" />
          {participants.length === 0 ? (
            <span className="text-foreground-soft">No one&apos;s in the voice room</span>
          ) : (
            <span className="min-w-0 break-words">
              {participants.length} talking:{" "}
              <span className="text-foreground-soft">{participants.map((p) => p.name).join(", ")}</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canJoin && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-label="Invite to voice channel"
              className="rounded-lg border border-line p-1.5 text-foreground-soft hover:border-accent hover:text-accent"
            >
              <UserPlus size={16} />
            </button>
          )}
          {canJoin && (
            <button
              type="button"
              onClick={join}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
            >
              Join voice
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-foreground-soft">
        {inviteCounts.pending} pending · {inviteCounts.accepted} accepted · {inviteCounts.declined} declined
      </p>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {pickerOpen && (
        <div
          className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPickerOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="animate-modal-panel-in w-full max-w-sm rounded-xl bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Invite to voice</h2>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                aria-label="Close"
                className="text-foreground-soft hover:text-danger"
              >
                <X size={18} />
              </button>
            </div>
            {inviteError && <p className="mt-2 text-xs text-danger">{inviteError}</p>}
            <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
              {circleMembers.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <UserAvatar avatarUrl={m.avatarUrl} name={m.name} size={24} />
                    <span className="min-w-0 truncate">{m.name ?? "Unknown"}</span>
                  </span>
                  <button
                    type="button"
                    disabled={invitedIds.has(m.id)}
                    onClick={() => invite(m.id)}
                    className="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium hover:border-accent disabled:opacity-50"
                  >
                    {invitedIds.has(m.id) ? "Invited" : "Invite"}
                  </button>
                </li>
              ))}
              {circleMembers.length === 0 && (
                <li className="text-sm text-foreground-soft">No other Circle members yet.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {active && (
        <CallFrame roomUrl={active.roomUrl} token={active.token} type="AUDIO" onLeave={leave} />
      )}
    </div>
  );
}
