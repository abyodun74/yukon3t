"use client";

import { createAreaText } from "@/components/ui-text";
import { liveEn } from "@/lib/i18n/en/live";

const live = createAreaText(liveEn);

/** live/layout.tsx: the live stream room (joining, the stage, recording, the chat strip, reactions). */
export const LiveTextProvider = live.Provider;
export const useLiveText = live.useText;
