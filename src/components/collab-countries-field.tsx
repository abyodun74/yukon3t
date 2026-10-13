"use client";

import { useMemo, useState } from "react";
import { COUNTRIES } from "@/lib/countries";
import { MultiSelect } from "@/components/multi-select";
import { useCollabText } from "@/components/collab-text";
import { countryName } from "@/lib/i18n/country-names";

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
  const { locale, t: collab } = useCollabText();
  const t = collab.form;
  // The stored value is the English name; only the label a country is shown under follows the reader's language.
  const options = useMemo(
    () => COUNTRIES.map((country) => ({ value: country, label: countryName(country, locale) })),
    [locale],
  );

  return (
    <div>
      <label className="block text-sm font-medium">{t.countries}</label>
      <label className="mt-2 flex items-center gap-2 text-sm text-foreground-soft">
        <input
          type="checkbox"
          name="worldwide"
          checked={worldwide}
          onChange={(e) => setWorldwide(e.target.checked)}
          className="h-4 w-4 rounded border-line accent-accent"
        />
        {t.worldwide}
      </label>

      {!worldwide && (
        <div className="mt-2">
          <MultiSelect
            name="countries"
            options={options}
            defaultValues={defaultCountries}
            placeholder={t.countriesPlaceholder}
            max={MAX_COUNTRIES}
            labels={collab.controls.multiSelect}
          />
        </div>
      )}
    </div>
  );
}
