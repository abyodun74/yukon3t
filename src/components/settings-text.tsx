"use client";

import { createAreaText } from "@/components/ui-text";
import { settingsEn } from "@/lib/i18n/en/settings";

const settings = createAreaText(settingsEn);

/** settings/layout.tsx: the client components of Settings and of the Ambient page. */
export const SettingsTextProvider = settings.Provider;
export const useSettingsText = settings.useText;
