"use client";

import { useState } from "react";
import { COUNTRIES } from "@/lib/countries";
import { MultiSelect } from "@/components/multi-select";

const MAX_COUNTRIES = 20;

/** Countries-involved picker for a Collab post, with a "worldwide" escape hatch instead of forcing every country to be enumerated one at a time. */
export function CollabCountriesField({
  defaultWorldwide = false,
  defaultCountries = [],
}: {
  defaultWorldwide?: boolean;
  defaultCountries?: string[];
}) {
  const [worldwide, setWorldwide] = useState(defaultWorldwide);

  return (
    <div>
      <label className="block text-sm font-medium">Countries involved</label>
      <label className="mt-2 flex items-center gap-2 text-sm text-foreground-soft">
        <input
          type="checkbox"
          name="worldwide"
          checked={worldwide}
          onChange={(e) => setWorldwide(e.target.checked)}
          className="h-4 w-4 rounded border-line accent-accent"
        />
        Open to any country (worldwide)
      </label>

      {!worldwide && (
        <div className="mt-2">
          <MultiSelect
            name="countries"
            options={COUNTRIES}
            defaultValues={defaultCountries}
            placeholder="Search countries..."
            max={MAX_COUNTRIES}
          />
        </div>
      )}
    </div>
  );
}
