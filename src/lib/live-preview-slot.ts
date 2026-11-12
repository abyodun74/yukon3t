// Which Home-feed live preview may hold a Daily connection right now. daily-js allows one call instance per page
// (CLAUDE.md, "One Daily instance at a time"), and with several people live at once several feed cards can be on
// screen together (a tall or desktop viewport): each used to join on its own, and every one after the first failed
// with "Duplicate DailyIframe instances", after already costing a join (a Daily token, a viewer row, a presence
// signal) it then had to undo. Now the most recently activated card owns the one slot; when it lets go, the slot
// passes back to the newest card still on screen. Pure, no React (live-preview-slot.test.ts).

export type PreviewSlot = {
  /** Marks `id` as on screen and wanting to play; it becomes the owner. */
  claim(id: string): void;
  /** `id` is no longer on screen; if it owned the slot, the newest remaining claimant gets it. */
  release(id: string): void;
  owner(): string | null;
  subscribe(listener: () => void): () => void;
};

export function createPreviewSlot(): PreviewSlot {
  let claimants: string[] = [];
  const listeners = new Set<() => void>();
  const owner = () => (claimants.length > 0 ? claimants[claimants.length - 1] : null);
  function update(next: string[]) {
    const before = owner();
    claimants = next;
    if (owner() !== before) for (const listener of listeners) listener();
  }
  return {
    claim(id) {
      update([...claimants.filter((c) => c !== id), id]);
    },
    release(id) {
      if (claimants.includes(id)) update(claimants.filter((c) => c !== id));
    },
    owner,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The page's one slot, shared by every LiveStreamPreviewEmbed. */
export const livePreviewSlot = createPreviewSlot();
