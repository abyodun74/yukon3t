"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { inviteToCall } from "@/app/actions/calls";
import { getMyConnectionsForPicker } from "@/app/actions/connections";
import { CALL_MAX_PARTICIPANTS } from "@/lib/call-resilience";
import { captureError } from "@/lib/error-tracking";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useCallsText } from "@/components/calls-text";
import type { callsEn } from "@/lib/i18n/en/calls";
import { format } from "@/lib/i18n/locales";
import { filterBySearch } from "@/lib/friend-search";

type Connection = { id: string; name: string | null };

/** `name` is null for a connection the data has no name for: those four refusals have a wording of their own. */
function inviteErrorMessage(code: string, name: string | null, t: typeof callsEn.add) {
  switch (code) {
    case "full":
      return format(t.full, { max: CALL_MAX_PARTICIPANTS });
    case "not_connected":
      return t.notConnected;
    case "rate_limited":
      return t.rateLimited;
    case "invalid":
    case "not_found":
      return t.ended;
    default: {
      const about = code === "busy" || code === "unavailable" || code === "already_in_call" ? code : "other";
      return name ? format(t.errors[about], { name }) : t.errorsUnnamed[about];
    }
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
  const { t: calls } = useCallsText();
  const t = calls.add;
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
    setError(null);
    setInvitingId(connection.id);
    const result = await inviteToCall(callId, connection.id).catch(() => ({ error: "failed" as const }));
    setInvitingId(null);
    if (result.error) {
      setError(inviteErrorMessage(result.error, connection.name, t));
      return;
    }
    onInvited();
    close();
  }

  if (!open) return null;

  const available = connections?.filter((c) => !excludeIds.has(c.id)) ?? null;
  const matches = available ? filterBySearch(available, query, (c) => [c.name]) : null;

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
          <p id={titleId} className="text-sm font-semibold">{t.title}</p>
          <button
            type="button"
            onClick={close}
            aria-label={t.close}
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
            placeholder={t.search}
            aria-label={t.search}
            dir="auto"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        <ul className="mt-3 max-h-[45vh] space-y-1 overflow-y-auto">
          {loadFailed && (
            <li className="text-sm text-foreground-soft">
              {t.loadFailed}{" "}
              <button type="button" onClick={() => setLoadFailed(false)} className="font-medium text-accent">
                {t.tryAgain}
              </button>
            </li>
          )}
          {!loadFailed && matches === null && <li className="text-sm text-foreground-soft">{t.loading}</li>}
          {available?.length === 0 && (
            <li className="text-sm text-foreground-soft">
              {connections?.length === 0 ? t.none : t.allInCall}
            </li>
          )}
          {available !== null && available.length > 0 && matches?.length === 0 && (
            <li className="text-sm text-foreground-soft">{t.noMatch}</li>
          )}
          {matches?.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={invitingId !== null}
                onClick={() => invite(c)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-start text-sm hover:bg-line disabled:opacity-60"
              >
                <span dir="auto" className="min-w-0 truncate">{c.name ?? t.unnamed}</span>
                <span className="shrink-0 text-xs text-accent">{invitingId === c.id ? t.calling : t.add}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
