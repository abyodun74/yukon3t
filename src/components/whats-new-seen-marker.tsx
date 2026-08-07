"use client";

import { useEffect } from "react";
import { markAnnouncementsSeen } from "@/app/actions/announcements";

/** Fires once on mount so visiting /whats-new clears the WhatsNewBell's unread dot. */
export function WhatsNewSeenMarker() {
  useEffect(() => {
    markAnnouncementsSeen();
  }, []);

  return null;
}
