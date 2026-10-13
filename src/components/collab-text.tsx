"use client";

import { createAreaText } from "@/components/ui-text";
import { collabEn } from "@/lib/i18n/en/collab";

const collab = createAreaText(collabEn);

/** collab/layout.tsx: the create and edit form fields and a collaboration's own controls (session room, invites, participants). */
export const CollabTextProvider = collab.Provider;
export const useCollabText = collab.useText;
