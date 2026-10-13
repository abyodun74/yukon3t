"use client";

import { createAreaText } from "@/components/ui-text";
import { circlesEn } from "@/lib/i18n/en/circles";

const circles = createAreaText(circlesEn);

/** circles/layout.tsx: the creation wizard and a Circle's own controls (membership, channels, members, voice room). */
export const CirclesTextProvider = circles.Provider;
export const useCirclesText = circles.useText;
