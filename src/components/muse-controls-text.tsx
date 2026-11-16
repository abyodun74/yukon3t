"use client";

import { createAreaText } from "@/components/ui-text";
import { museControlsEn } from "@/lib/i18n/en/museControls";

const museControls = createAreaText(museControlsEn);

/** muse/layout.tsx and home/layout.tsx (Home opens the Muse viewer): the Muse card's heart and progress bar. */
export const MuseControlsTextProvider = museControls.Provider;
export const useMuseControlsText = museControls.useText;
