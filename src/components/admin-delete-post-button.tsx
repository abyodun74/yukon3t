"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePost } from "@/app/actions/posts";

export function AdminDeletePostButton({ postId }: { postId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await deletePost(postId);
          router.refresh();
        })
      }
      className="rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
    >
      {isPending ? "Deleting..." : "Delete duplicate"}
    </button>
  );
}
