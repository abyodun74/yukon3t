"use client";

import { createAreaText } from "@/components/ui-text";
import { collabShareEn } from "@/lib/i18n/en/collabShare";

const collabShare = createAreaText(collabShareEn);

/** Mounted by the layouts whose pages list collabs (/collab, /search): the Collab share sheet and its Share button. */
export const CollabShareTextProvider = collabShare.Provider;
export const useCollabShareText = collabShare.useText;
