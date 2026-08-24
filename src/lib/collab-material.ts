"use client";

import type { DailyCall } from "@daily-co/daily-js";
import { uploadFileDirect } from "@/lib/upload-client";
import { sendMessage } from "@/app/actions/messages";

export type SharedMaterial = { url: string; name: string; contentType: string };

/** Daily's app-message payload shape for a shared-material broadcast — see shareCollabMaterial/isCollabMaterialMessage below. */
export const COLLAB_MATERIAL_MESSAGE_TYPE = "collab-material-shared";

/**
 * Uploads a file and posts it into the Collab's group chat (so it's there
 * for anyone who joins later), then — when a live call is active —
 * broadcasts it via Daily's own real-time app-message channel so everyone
 * *currently in the session* sees it appear immediately, without waiting on
 * ChatThread's 5s poll. sendAppMessage only reaches other participants, not
 * the sender, so the caller is expected to update its own shared-material
 * view directly from this function's return value rather than relying on
 * hearing its own broadcast back.
 */
export async function shareCollabMaterial({
  file,
  conversationId,
  dailyCall,
}: {
  file: File;
  conversationId: string;
  dailyCall: DailyCall | null;
}): Promise<{ ok: true; material: SharedMaterial } | { ok: false; error: string }> {
  const uploaded = await uploadFileDirect(file, "collab-material");
  if (!uploaded.ok) {
    return { ok: false, error: "upload_failed" };
  }

  const fd = new FormData();
  fd.set("conversationId", conversationId);
  fd.set("content", `📎 Shared a file: ${file.name}\n${uploaded.publicUrl}`);
  const sent = await sendMessage(fd);
  if (sent.error) {
    return { ok: false, error: "post_failed" };
  }

  const material: SharedMaterial = { url: uploaded.publicUrl, name: file.name, contentType: file.type };
  dailyCall?.sendAppMessage({ type: COLLAB_MATERIAL_MESSAGE_TYPE, material }, "*");
  return { ok: true, material };
}

export function collabMaterialFromAppMessage(data: unknown): SharedMaterial | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as { type?: unknown; material?: unknown };
  if (msg.type !== COLLAB_MATERIAL_MESSAGE_TYPE || !msg.material || typeof msg.material !== "object") return null;
  const { url, name, contentType } = msg.material as Partial<SharedMaterial>;
  if (typeof url !== "string" || typeof name !== "string" || typeof contentType !== "string") return null;
  return { url, name, contentType };
}
