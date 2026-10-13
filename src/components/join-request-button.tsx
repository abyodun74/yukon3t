"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestToJoinGroup } from "@/app/actions/messages";
import { useMessagesText } from "@/components/ui-text";

export function JoinRequestButton({
  conversationId,
  status,
}: {
  conversationId: string;
  status: "NONE" | "PENDING" | "DECLINED";
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const t = useMessagesText().t.group;

  function submit() {
    startTransition(async () => {
      await requestToJoinGroup(conversationId);
      router.refresh();
    });
  }

  if (status === "PENDING") {
    return <p className="text-sm text-foreground-soft">{t.requestSent}</p>;
  }

  return (
    <div className="space-y-2">
      {status === "DECLINED" && (
        <p className="text-sm text-foreground-soft">{t.requestDeclined}</p>
      )}
      <button
        type="button"
        disabled={isPending}
        onClick={submit}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
      >
        {status === "DECLINED" ? t.requestAgain : t.request}
      </button>
    </div>
  );
}
