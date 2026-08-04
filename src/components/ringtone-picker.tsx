"use client";

import { useState } from "react";
import { RINGTONE_IDS, RINGTONE_LABELS, previewRingtone, type RingtoneId } from "@/lib/ringtones";

/** The <select> submits via the surrounding server-action form; Preview just plays a one-shot locally. */
export function RingtonePicker({ defaultValue }: { defaultValue: RingtoneId }) {
  const [selected, setSelected] = useState<RingtoneId>(defaultValue);

  return (
    <div className="flex items-center gap-2">
      <select
        name="ringtone"
        value={selected}
        onChange={(e) => setSelected(e.target.value as RingtoneId)}
        className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
      >
        {RINGTONE_IDS.map((id) => (
          <option key={id} value={id}>
            {RINGTONE_LABELS[id]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => previewRingtone(selected)}
        className="shrink-0 rounded-lg border border-line px-3 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
      >
        Preview
      </button>
    </div>
  );
}
