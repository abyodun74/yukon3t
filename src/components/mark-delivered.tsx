"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markMessagesDelivered } from "@/app/actions/messages";

// Client-only, like ChatThread's read-marking: Next.js prefetches <Link>
// targets merely visible in the nav, which would otherwise mark messages
// "delivered" before the user ever actually opened /messages.
export function MarkDelivered() {
  const router = useRouter();

  useEffect(() => {
    markMessagesDelivered().then(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
