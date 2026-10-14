"use client";

import { createAreaText } from "@/components/ui-text";
import { museEn } from "@/lib/i18n/en/muse";

const muse = createAreaText(museEn);

/** muse/layout.tsx and u/layout.tsx: the Muse feed, a Muse's comments and share sheet, and the Muse composer. */
export const MuseTextProvider = muse.Provider;
export const useMuseText = muse.useText;
