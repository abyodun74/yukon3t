"use client";

import { useEffect } from "react";
import { markAnnouncementsSeen } from "@/app/actions/announcements";
import { useGuestPreview } from "@/components/guest-preview";

/** Fires once on mount so visiting /whats-new clears the WhatsNewBell's unread dot. Not for a guest preview session (read-only). */
export function WhatsNewSeenMarker() {
  const { isGuest } = useGuestPreview();
  useEffect(() => {
    if (!isGuest) markAnnouncementsSeen();
  }, [isGuest]);

  return null;
}
