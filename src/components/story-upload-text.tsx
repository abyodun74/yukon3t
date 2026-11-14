"use client";

import { createAreaText } from "@/components/ui-text";
import { storyUploadEn } from "@/lib/i18n/en/storyUpload";

const storyUpload = createAreaText(storyUploadEn);

/** Root layout: the Story composer's photo/video errors (it opens from Home, a profile and the share-in sheet). */
export const StoryUploadTextProvider = storyUpload.Provider;
export const useStoryUploadText = storyUpload.useText;
