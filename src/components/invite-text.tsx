"use client";

import { createAreaText } from "@/components/ui-text";
import { inviteEn } from "@/lib/i18n/en/invite";

const invite = createAreaText(inviteEn);

/** The layouts of /invite and /settings, the two places the invite panel is mounted. */
export const InviteTextProvider = invite.Provider;
export const useInviteText = invite.useText;
