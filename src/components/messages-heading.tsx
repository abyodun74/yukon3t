"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { HIDDEN_CHATS_PATH } from "@/lib/hidden-chats-rules";
import { useMessagesText } from "@/components/messages-text";

const LONG_PRESS_MS = 600;

/**
 * The "Messages" title. Pressing and holding it opens the hidden-chats area. It looks and behaves the same for
 * everyone, whether or not they have ever hidden a chat, so it gives nothing away; the always-present "Hidden chats"
 * row in Settings is the same door for keyboard and screen-reader users.
 */
export function MessagesHeading() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useMessagesText();

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  return (
    <h1
      className="select-none text-2xl font-semibold"
      style={{ WebkitTouchCallout: "none" }}
      onPointerDown={() => {
        cancel();
        timer.current = setTimeout(() => router.push(HIDDEN_CHATS_PATH), LONG_PRESS_MS);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {t.inbox.title}
    </h1>
  );
}
