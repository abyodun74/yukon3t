"use client";

import { cn } from "@/lib/utils";
import { useSettingsText } from "@/components/settings-text";
import { DATA_SAVER_VALUES } from "@/lib/network-quality";
import { setDataSaverPreference, useDataSaverPreference, useNetworkQuality } from "@/lib/network-quality-client";

/**
 * Settings → Data saver. A per-device preference (localStorage, like the
 * emoji style's cookie it never reaches the server) — "Automatic" by
 * default, which follows the connection (see classifyNetwork). The line
 * under the buttons says what applies right now, so "Automatic" isn't a
 * mystery.
 */
export function DataSaverSetting() {
  const { t } = useSettingsText();
  const text = t.dataSaver;
  const preference = useDataSaverPreference();
  const quality = useNetworkQuality();

  return (
    <div>
      <div role="radiogroup" aria-label={text.heading} className="flex flex-wrap gap-2">
        {DATA_SAVER_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={preference === value}
            onClick={() => setDataSaverPreference(value)}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              preference === value ? "border-accent bg-accent/10 text-accent" : "border-line hover:border-accent/50",
            )}
          >
            {text.options[value]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-foreground-soft">{text.hints[preference]}</p>
      <p role="status" className="mt-1 text-xs text-foreground-soft">
        {text.status[quality]} {text.device}
      </p>
    </div>
  );
}
