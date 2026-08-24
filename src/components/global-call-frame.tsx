"use client";

import { Maximize2, Minimize2, PhoneOff } from "lucide-react";
import { CallFrame } from "@/components/call-frame";
import { useCallSession } from "@/lib/call-session";

/**
 * The single place <CallFrame> gets mounted, root-rendered (src/app/layout.tsx)
 * so it survives navigation regardless of which page/component started the
 * session (see call-session.tsx). Toggling `minimized` only changes this
 * wrapper's size/position — the underlying <CallFrame>/Daily iframe never
 * unmounts, so the call itself is never interrupted.
 */
export function GlobalCallFrame() {
  const { session, minimized, dailyCall, setDailyCall, endSession, minimize, expand } = useCallSession();

  if (!session) return null;

  return (
    <>
      <div
        className={
          minimized
            ? "fixed right-4 z-[60] h-40 w-64 overflow-hidden rounded-xl border border-line bg-black shadow-lg"
            : "fixed inset-0 z-[60] bg-black"
        }
        // bottom offset as an inline style, not a `bottom-*` Tailwind
        // utility — that wasn't taking effect here for reasons that didn't
        // reproduce for any other utility on this same element (right-4/
        // h-40/w-64/z-[60] all applied correctly); this is a guaranteed-to-
        // work fallback. 5rem clears the mobile bottom nav (layout.tsx's
        // `pb-16` on signed-in users) — a bit more clearance than strictly
        // needed on desktop, not worth a resize-aware breakpoint for.
        style={minimized ? { bottom: "5rem" } : undefined}
      >
        <CallFrame
          roomUrl={session.roomUrl}
          token={session.token}
          type={session.type}
          activeSpeakerMode={session.activeSpeakerMode}
          onCallObject={setDailyCall}
          onLeave={() => {
            session.onLeave();
            endSession();
          }}
        />

        {minimized && (
          // Positioned relative to the small widget itself — a self-
          // contained corner of its own, nothing else renders there, so no
          // stacking-context concerns like the fullscreen button below.
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
            <span className="max-w-[7rem] truncate rounded-md bg-black/60 px-2 py-1 text-xs text-white">
              {session.label}
            </span>
            <button
              type="button"
              onClick={expand}
              title="Expand"
              className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80"
            >
              <Maximize2 size={14} />
            </button>
            <button
              type="button"
              // Daily's own leave button becomes impractically small at this
              // size — call .leave() directly and let the resulting
              // "left-meeting" event drive CallFrame's onLeave above, same
              // cleanup path as a normal in-app hangup.
              onClick={() => dailyCall?.leave()}
              title="Hang up"
              className="rounded-md bg-danger p-1.5 text-white hover:opacity-90"
            >
              <PhoneOff size={14} />
            </button>
          </div>
        )}
      </div>

      {!minimized && (
        // Rendered as a SIBLING of the z-[60] video wrapper above, not a
        // descendant — `position: fixed` + `z-index` establishes a new
        // stacking context, so a high z-index on a *descendant* can never
        // out-rank a sibling of its ancestor (e.g. LiveStreamRoom's
        // top-corner Record/Screenshot/viewer-count bars, z-[70]) no matter
        // how large that descendant's own z-index is. This has to sit at
        // the same level as that div to actually win. Bottom-right since
        // every corner near the top is already spoken for between those
        // and Daily's own built-in controls.
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-1.5">
          <button
            type="button"
            // App-level leave control alongside Minimize, not just Daily's
            // own in-iframe leave button — same .leave() call as the
            // minimized widget's hang-up button below, kept reachable even
            // fullscreen so leaving never depends on finding Daily's own
            // control inside the call UI (e.g. tucked under its "..." menu
            // on a narrow viewport).
            onClick={() => dailyCall?.leave()}
            title="Leave session"
            className="rounded-md bg-danger p-1.5 text-white hover:opacity-90"
          >
            <PhoneOff size={14} />
          </button>
          <button
            type="button"
            onClick={minimize}
            title="Minimize"
            className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80"
          >
            <Minimize2 size={14} />
          </button>
        </div>
      )}
    </>
  );
}
