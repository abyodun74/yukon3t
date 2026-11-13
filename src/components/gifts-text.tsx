"use client";

import { createAreaText } from "@/components/ui-text";
import { giftsEn } from "@/lib/i18n/en/gifts";

const gifts = createAreaText(giftsEn);

/** Mounted by the layouts whose pages can show gifts (messages, profiles, live, collab): pickers, cards, the open overlay. */
export const GiftsTextProvider = gifts.Provider;
export const useGiftsText = gifts.useText;

