"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { inviteToCall } from "@/app/actions/calls";
import { getMyConnectionsForPicker } from "@/app/actions/connections";
import { CALL_MAX_PARTICIPANTS } from "@/lib/call-resilience";
import { captureError } from "@/lib/error-tracking";
import { useDialogFocus } from "@/lib/use-dialog-focus";

type Connection = { id: string; name: string | null };

function inviteErrorMessage(code: string, name: string) {
  switch (code) {
    case "busy":
      return `${name} is on another call.`;
    case "unavailable":
      return `${name} can't be added right now.`;
    case "full":
      return `This call is full — ${CALL_MAX_PARTICIPANTS} people is the most it can hold.`;
    case "already_in_call":
      return `${name} is already in this call.`;
    case "not_connected":
      return "You can only add your connections.";
    case "rate_limited":
      return "Too many calls — slow down a little.";
    case "invalid":
    case "not_found":
      return "This call has ended.";
    default:
      return `Couldn't add ${name} — try again.`;
  }
}

/**
 * The "Add person" picker for a call in progress: the user's own
 * connections, minus whoever is already in the call or being rung for it.
 * Picking someone rings them (inviteToCall) and closes the sheet; a refusal
 * is shown inline instead.
 *
 * Hand-rolled rather than <Sheet>, same as story-share-button.tsx: it opens
 * over the fullscreen call (z-[60], controls at z-[80]), above where Sheet's
 * own z-50 backdrop sits.
 */
export function AddCallParticipantSheet({
  open,
  onClose,
  callId,
  excludeIds,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  callId: string;
  /** Everyone in the call or currently being rung for it. */
  excludeIds: ReadonlySet<string>;
  onInvited: () => void;
}) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose);

  const loadingRef = useRef(false);
  useEffect(() => {
    if (!open || connections !== null || loadFailed || loadingRef.current) return;
    loadingRef.current = true;
    getMyConnectionsForPicker()
      .then((r) => setConnections(r.connections))
      .catch((err) => {
        setLoadFailed(true);
        captureError(err, { component: "add-call-participant-sheet", flow: "getMyConnectionsForPicker" });
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, [open, connections, loadFailed]);

  function close() {
    setError(null);
    setQuery("");
    onClose();
  }

  async function invite(connection: Connection) {
    if (invitingId) return;
    const name = connection.name ?? "This person";
    setError(null);
    setInvitingId(connection.id);
    const result = await inviteToCall(callId, connection.id).catch(() => ({ error: "failed" as const }));
    setInvitingId(null);
    if (result.error) {
      setError(inviteErrorMessage(result.error, name));
      return;
    }
    onInvited();
    close();
  }

  if (!open) return null;

  const needle = query.trim().toLowerCase();
  const available = connections?.filter((c) => !excludeIds.has(c.id)) ?? null;
  const matches = available?.filter((c) => (c.name ?? "").toLowerCase().includes(needle)) ?? null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 outline-none sm:items-center sm:p-4"
      onClick={close}
    >
      <div
        className="max-h-[75vh] w-full max-w-md overflow-hidden rounded-t-2xl bg-surface p-4 text-foreground sm:rounded-2xl"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p id={titleId} className="text-sm font-semibold">Add someone to this call</p>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-lg p-1 text-foreground-soft hover:bg-line"
          >
            <X size={16} />
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2">
          <Search size={14} className="shrink-0 text-foreground-soft" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your connections"
            aria-label="Search your connections"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        <ul className="mt-3 max-h-[45vh] space-y-1 overflow-y-auto">
          {loadFailed && (
            <li className="text-sm text-foreground-soft">
              Couldn&apos;t load your connections.{" "}
              <button type="button" onClick={() => setLoadFailed(false)} className="font-medium text-accent">
                Try again
              </button>
            </li>
          )}
          {!loadFailed && matches === null && <li className="text-sm text-foreground-soft">Loading…</li>}
          {available?.length === 0 && (
            <li className="text-sm text-foreground-soft">
              {connections?.length === 0
                ? "You don't have any connections to add yet."
                : "All of your connections are already in this call."}
            </li>
          )}
          {available !== null && available.length > 0 && matches?.length === 0 && (
            <li className="text-sm text-foreground-soft">No connections match that search.</li>
          )}
          {matches?.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={invitingId !== null}
                onClick={() => invite(c)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-line disabled:opacity-60"
              >
                <span className="min-w-0 truncate">{c.name ?? "Unnamed"}</span>
                <span className="shrink-0 text-xs text-accent">{invitingId === c.id ? "Calling…" : "Add"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
