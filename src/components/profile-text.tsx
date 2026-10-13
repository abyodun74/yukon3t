"use client";

import { createAreaText } from "@/components/ui-text";
import { profileEn } from "@/lib/i18n/en/profile";

const profile = createAreaText(profileEn);

/** u/layout.tsx: the edit form, the photo upload, the story ring and the subscriber lists of a profile. */
export const ProfileTextProvider = profile.Provider;
export const useProfileText = profile.useText;
