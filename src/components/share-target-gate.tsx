"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, SquarePen, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { checkForPendingShare, type PendingShareMedia } from "@/lib/share-receiver";
import { setPendingShareMedia } from "@/lib/share-target-store";
import { getMyConversationsForShare } from "@/app/actions/messages";
import { UserAvatar } from "@/components/user-link";

type Conversation = { id: string; label: string; avatarUrl: string | null };
type View = "root" | "friends";

/**
 * Root-mounted (src/app/layout.tsx), Android-only — the incoming half of
 * the Share-target feature: another app's Share sheet ("Share to YuKon3t")
 * launches or resumes this app with an ACTION_SEND/SEND_MULTIPLE intent,
 * MainActivity stashes it (see its handleShareIntent), and
 * checkForPendingShare() below reads/consumes it exactly once per launch.
 * When there's something to show, this offers the same two destinations
 * PostComposer/ChatThread can already receive pre-attached media into:
 * a new post, or a specific conversation (reusing ShareModal's own
 * "Send to a friend" conversation list, getMyConversationsForShare) —
 * whichever is picked stores the actual File objects in
 * share-target-store.ts and navigates there, since a Next.js route change
 * can't carry a File through the URL itself.
 */
export function ShareTargetGate({ userId }: { userId: string }) {
  const router = useRouter();
  const [share, setShare] = useState<PendingShareMedia | null>(null);
  const [view, setView] = useState<View>("root");
  const [conversations, setConversations] = useState<Conversation[] | null>(null);

  // Checked both on mount (cold start — the launching SEND intent is
  // already sitting in ShareReceiverPlugin's holder by the time this
  // component's effects run) and on every native "resume" event (the app
  // was already alive in the background; MainActivity's onNewIntent just
  // restashed a new one there). Confirmed live that "resume" is genuinely
  // needed, not just a belt-and-suspenders — incoming-call-listener.tsx's
  // own appUrlOpen event only fires for a VIEW intent carrying a data URI,
  // never for the ACTION_SEND/SEND_MULTIPLE intents this feature runs on,
  // so without this a share arriving while the app was already running
  // silently did nothing until the next full relaunch.
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    let cancelled = false;
    let listener: { remove: () => void } | undefined;

    function check() {
      checkForPendingShare().then((result) => {
        if (!cancelled && result) setShare(result);
      });
    }

    check();
    import("@capacitor/app").then(({ App }) => {
      if (cancelled) return;
      App.addListener("resume", check).then((h) => {
        if (cancelled) h.remove();
        else listener = h;
      });
    });

    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, []);

  useEffect(() => {
    if (view === "friends" && conversations === null) {
      getMyConversationsForShare().then((r) => setConversations(r.conversations));
    }
  }, [view, conversations]);

  const previewUrl = useMemo(() => {
    const first = share?.images[0] ?? share?.video ?? null;
    return first ? URL.createObjectURL(first) : null;
  }, [share]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (!share) return null;

  function close() {
    setShare(null);
    setView("root");
    setConversations(null);
  }

  function goToNewPost() {
    setPendingShareMedia(share!);
    close();
    // Not /home — that route has no PostComposer mounted at all (it's a
    // read-only feed), so nothing would ever call consumePendingShareMedia()
    // and the shared file would silently vanish. The profile page's own
    // PostComposer (no circleId/channelId — a general, non-Circle post) is
    // the one instance that's always reachable from any signed-in state.
    router.push(`/u/${userId}`);
  }

  function goToConversation(conversationId: string) {
    setPendingShareMedia(share!);
    close();
    router.push(`/messages/${conversationId}`);
  }

  return (
    <div
      className="animate-modal-backdrop-in fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={close}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="animate-modal-panel-in w-full max-w-sm rounded-xl bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {view === "root" ? "Share to YuKon3t" : "Send to a friend"}
          </h2>
          <button type="button" onClick={close} aria-label="Close" className="text-foreground-soft hover:text-danger">
            <X size={18} />
          </button>
        </div>

        {view === "root" && (
          <>
            {previewUrl &&
              (share.video ? (
                <video src={previewUrl} className="mt-3 max-h-48 w-full rounded-lg bg-black object-contain" controls />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- a transient blob: URL, not a real asset next/image can optimize
                <img src={previewUrl} alt="" className="mt-3 max-h-48 w-full rounded-lg object-contain" />
              ))}
            {share.text && (
              <p className="mt-3 line-clamp-3 rounded-lg bg-background px-3 py-2 text-sm text-foreground-soft">
                {share.text}
              </p>
            )}
            <div className="mt-3 space-y-1">
              <button
                type="button"
                onClick={goToNewPost}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60"
              >
                <SquarePen size={16} />
                New post
              </button>
              <button
                type="button"
                onClick={() => setView("friends")}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60"
              >
                <Send size={16} />
                Send to a friend
              </button>
            </div>
          </>
        )}

        {view === "friends" && (
          <>
            <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
              {conversations === null && <li className="px-2 py-1 text-sm text-foreground-soft">Loading…</li>}
              {conversations?.length === 0 && (
                <li className="px-2 py-1 text-sm text-foreground-soft">No conversations yet.</li>
              )}
              {conversations?.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => goToConversation(c.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-line/60"
                  >
                    <UserAvatar avatarUrl={c.avatarUrl} name={c.label} size={26} />
                    <span className="truncate">{c.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setView("root")}
              className="mt-3 text-xs text-foreground-soft hover:text-accent"
            >
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
