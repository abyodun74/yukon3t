import { z } from "zod";
import { COLLAB_CIRCLE_IDS_MAX } from "@/lib/collab-circle-invite";

/**
 * Starting a PRIVATE collab's live session with the "Start session" sheet (startCollabSession in
 * actions/collab-session.ts): its options, and when "the session is live" may be sent again. Pure, so both are
 * unit-tested.
 */

/**
 * Only the organizer (OWNER) or a co-admin (MODERATOR) can start a session from cold — a regular participant can join
 * one already underway, but can't spin one up on their own. The page's canModerate (isCollabAdmin) decides who sees
 * the button; this is what the actions enforce.
 */
export function canStartCollabSession(role: string) {
  return role === "OWNER" || role === "MODERATOR";
}

/** A session presence row older than this is treated as gone (someone whose app never sent the leave). */
export const COLLAB_SESSION_STALE_AFTER_MS = 4 * 60 * 60 * 1000;

/** At most one COLLAB_SESSION_STARTED fan-out per collab in this window, however many times a session is started. */
export const COLLAB_SESSION_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

/** Same limits as inviteToCollab (collabInviteSchema), but empty is allowed: skipping both pickers just starts. */
export const startCollabSessionSchema = z.object({
  notify: z.boolean(),
  userIds: z.array(z.string().cuid()).max(50),
  circleIds: z.array(z.string().cuid()).max(COLLAB_CIRCLE_IDS_MAX),
});

export type StartCollabSessionOptions = z.infer<typeof startCollabSessionSchema>;

/** The options as sent by the sheet, or null if they aren't valid. Duplicate ids are dropped. */
export function parseStartSessionOptions(input: unknown): StartCollabSessionOptions | null {
  const parsed = startCollabSessionSchema.safeParse(input);
  if (!parsed.success) return null;
  return {
    notify: parsed.data.notify,
    userIds: [...new Set(parsed.data.userIds)],
    circleIds: [...new Set(parsed.data.circleIds)],
  };
}

/** Whether this start includes an invite step at all. */
export function hasStartInvites(options: StartCollabSessionOptions) {
  return options.userIds.length > 0 || options.circleIds.length > 0;
}

/**
 * Whether starting now may notify. `lastSentAt` is the newest COLLAB_SESSION_STARTED row for this collab (null if
 * none); the window is measured from it, so a fan-out that is skipped doesn't extend it.
 */
export function shouldNotifySessionStarted({
  notifyRequested,
  lastSentAt,
  now,
}: {
  notifyRequested: boolean;
  lastSentAt: Date | null;
  now: Date;
}) {
  if (!notifyRequested) return false;
  return !lastSentAt || now.getTime() - lastSentAt.getTime() >= COLLAB_SESSION_NOTIFY_COOLDOWN_MS;
}

/** Who hears that the session is live: every participant except whoever started it, once each. */
export function sessionStartedRecipients(participantIds: Iterable<string>, starterId: string) {
  const recipients = new Set(participantIds);
  recipients.delete(starterId);
  return [...recipients];
}
