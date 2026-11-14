"use client";

import { createAreaText } from "@/components/ui-text";
import { museCommentsEn } from "@/lib/i18n/en/museComments";

const museComments = createAreaText(museCommentsEn);

/** muse/layout.tsx and home/layout.tsx (Home opens the Muse viewer): a Muse's comments sheet. */
export const MuseCommentsTextProvider = museComments.Provider;
export const useMuseCommentsText = museComments.useText;
