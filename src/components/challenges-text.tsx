"use client";

import { createAreaText } from "@/components/ui-text";
import { challengesEn } from "@/lib/i18n/en/challenges";

const challenges = createAreaText(challengesEn);

/** Mounted by the layouts whose pages can show challenges (Circles, live): the Challenges section, panel and moment. */
export const ChallengesTextProvider = challenges.Provider;
export const useChallengesText = challenges.useText;
