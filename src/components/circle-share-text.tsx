"use client";

import { createAreaText } from "@/components/ui-text";
import { circleShareEn } from "@/lib/i18n/en/circleShare";

const circleShare = createAreaText(circleShareEn);

/** Mounted by the layouts whose pages list Circles (/circles, /search): the Circle share sheet and its Share button. */
export const CircleShareTextProvider = circleShare.Provider;
export const useCircleShareText = circleShare.useText;
