"use client";

import { useState } from "react";
import { Clapperboard } from "lucide-react";
import { MuseComposer } from "@/components/muse-composer";

/** Owner-only entry point into MuseComposer — the modal itself has no built-in trigger, so any page that wants "post a Muse" mounts this small client wrapper (currently just the owner's own profile). */
export function PostMuseButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
      >
        <Clapperboard size={14} />
        Post a Muse
      </button>
      {open && <MuseComposer onClose={() => setOpen(false)} />}
    </>
  );
}
