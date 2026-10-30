"use client";

import type { DailyCall } from "@daily-co/daily-js";
import { uploadFileDirect } from "@/lib/upload-client";
import { sendMessage } from "@/app/actions/messages";
import { isCollabMaterialContentType, isCollabMaterialUrl } from "@/lib/collab-material-url";

export type SharedMaterial = { url: string; name: string; contentType: string };

/** Daily's app-message payload shape for a shared-material broadcast — see shareCollabMaterial/isCollabMaterialMessage below. */
const COLLAB_MATERIAL_MESSAGE_TYPE = "collab-material-shared";

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

/**
 * A shared material from another participant's app-message, or null. Any participant can send any payload on that
 * channel, so only a file shareCollabMaterial could have produced is accepted: our own bucket's `collab-material/`
 * objects (collab-material-url.ts), an allowed content type and a sane name (audit L6).
 */
export function collabMaterialFromAppMessage(data: unknown, mediaBaseUrl: string | null): SharedMaterial | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as { type?: unknown; material?: unknown };
  if (msg.type !== COLLAB_MATERIAL_MESSAGE_TYPE || !msg.material || typeof msg.material !== "object") return null;
  const { url, name, contentType } = msg.material as Partial<SharedMaterial>;
  if (typeof url !== "string" || typeof name !== "string" || typeof contentType !== "string") return null;
  if (!isCollabMaterialUrl(url, mediaBaseUrl) || !isCollabMaterialContentType(contentType)) return null;
  if (name.length === 0 || name.length > 255) return null;
  return { url, name, contentType };
}
