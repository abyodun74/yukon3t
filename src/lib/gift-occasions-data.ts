import { prisma } from "@/lib/prisma";
import { captureError } from "@/lib/error-tracking";
import { eligibleBirthdayRecipients } from "@/lib/birthdays-data";
import { profileBirthdayToday, type BirthdayAudience } from "@/lib/birthdays";
import { holidaysTodayForGifts } from "@/lib/holidays-data";
import { loadCircleEventAccess } from "@/lib/circle-events-data";
import {
  EVENT_OCCASION_WINDOW_MS,
  SELF_OCCASION_COOLDOWN_MS,
  SELF_OCCASION_KINDS,
  SELF_OCCASION_WINDOW_MS,
  occasionsFor,
  selfOccasionActive,
  selfOccasionRefusal,
  type Occasion,
  type OccasionRecipient,
  type OccasionViewer,
  type SelfOccasionKind,
} from "@/lib/gift-occasions";

// The server half of the gift occasion engine (rules: src/lib/gift-occasions.ts): reads the facts each occasion kind
// needs, for one recipient and one viewer, and hands them to the pure occasionsFor. SERVER-ONLY (it reaches the holiday
// dataset through holidays-data.ts). Runs on request only (the gift picker, the chat chip); nothing is stored and
// nobody is notified. Never throws: any failure reads as "no occasions" (reported to Sentry), so a gift can always be
// sent the ordinary way.

/** At most this many Circles / events are looked at for one recipient. */
const MAX_SHARED_CIRCLES = 50;
const MAX_EVENTS = 5;

type Viewer = { id: string; isAdmin: boolean };

export async function loadGiftOccasions(recipientId: string, viewer: Viewer, now = new Date()): Promise<Occasion[]> {
  if (recipientId === viewer.id) return [];
  try {
    const [recipient, viewerRow] = await Promise.all([
      prisma.user.findUnique({
        where: { id: recipientId },
        select: {
          id: true,
          status: true,
          isAdmin: true,
          isGuestPreview: true,
          birthDate: true,
          birthdayAudience: true,
          timeZone: true,
          onboardedAt: true,
          createdAt: true,
          country: true,
          holidayReminders: true,
          giftCultureOccasions: true,
          giftAnniversaryOptIn: true,
        },
      }),
      prisma.user.findUnique({ where: { id: viewer.id }, select: { giftAnniversaryOptIn: true } }),
    ]);
    if (!recipient || recipient.status !== "ACTIVE" || recipient.isGuestPreview) return [];

    const birthdayOwner = {
      id: recipient.id,
      status: recipient.status,
      isGuestPreview: recipient.isGuestPreview,
      birthDate: recipient.birthDate,
      birthdayAudience: recipient.birthdayAudience as BirthdayAudience,
      isAdmin: recipient.isAdmin,
      timeZone: recipient.timeZone,
    };

    const [birthdayEligible, connection, sharedCircles, events, selfRows] = await Promise.all([
      // The card's own rule first (no query on any other day), then the same audience check the card uses.
      profileBirthdayToday(birthdayOwner, now)
        ? eligibleBirthdayRecipients(birthdayOwner, now, [viewer.id]).then((rows) => rows.some((r) => r.id === viewer.id))
        : false,
      prisma.connection.findFirst({
        where: {
          status: "ACCEPTED",
          OR: [
            { requesterId: viewer.id, targetId: recipient.id },
            { requesterId: recipient.id, targetId: viewer.id },
          ],
        },
        select: { respondedAt: true },
      }),
      prisma.circleMembership.findMany({
        where: { userId: recipient.id, circle: { members: { some: { userId: viewer.id } } } },
        select: { joinedAt: true },
        take: MAX_SHARED_CIRCLES,
      }),
      prisma.post.findMany({
        where: {
          authorId: recipient.id,
          circleId: { not: null },
          moderationStatus: "PUBLISHED",
          eventCancelledAt: null,
          eventAt: {
            gte: new Date(now.getTime() - EVENT_OCCASION_WINDOW_MS),
            lte: new Date(now.getTime() + EVENT_OCCASION_WINDOW_MS),
          },
        },
        select: { id: true, eventAt: true },
        orderBy: { eventAt: "asc" },
        take: MAX_EVENTS,
      }),
      prisma.giftSelfOccasion.findMany({
        where: { userId: recipient.id, removedAt: null, declaredAt: { gte: new Date(now.getTime() - SELF_OCCASION_WINDOW_MS) } },
        select: { kind: true, declaredAt: true },
      }),
    ]);

    // An event counts only if the viewer may open it (canViewPost plus a private channel's allow-list).
    const visibleEventStarts: Date[] = [];
    for (const event of events) {
      if (event.eventAt && (await loadCircleEventAccess(event.id, viewer))) visibleEventStarts.push(event.eventAt);
    }

    const occasionRecipient: OccasionRecipient = {
      id: recipient.id,
      timeZone: recipient.timeZone,
      joinedAt: recipient.onboardedAt ?? recipient.createdAt,
      birthday: birthdayOwner,
      cultureOccasions: recipient.giftCultureOccasions,
      holidayReminders: recipient.holidayReminders,
      holidaysToday:
        recipient.holidayReminders && recipient.giftCultureOccasions
          ? holidaysTodayForGifts(recipient.country, recipient.timeZone, now)
          : 0,
      selfDeclared: selfRows.map((row) => ({ kind: row.kind as SelfOccasionKind, declaredAt: row.declaredAt })),
    };
    const occasionViewer: OccasionViewer = {
      id: viewer.id,
      birthdayEligible,
      connection: connection
        ? {
            respondedAt: connection.respondedAt,
            bothOptedIn: Boolean(viewerRow?.giftAnniversaryOptIn && recipient.giftAnniversaryOptIn),
          }
        : null,
      sharedCircleJoins: sharedCircles.map((row) => row.joinedAt),
      visibleEventStarts,
    };
    return occasionsFor(occasionRecipient, occasionViewer, now);
  } catch (err) {
    console.error("[gifts] occasions failed; showing none", err);
    await captureError(err, { where: "loadGiftOccasions" });
    return [];
  }
}

/**
 * Settings -> Gifts -> My occasions: which kinds the person has showing now (removable) and which they may declare
 * (none of that kind in the last SELF_OCCASION_COOLDOWN_MS). Kinds only: the page never shows when.
 */
export async function loadMySelfOccasions(
  userId: string,
  now = new Date(),
): Promise<{ showing: SelfOccasionKind[]; available: SelfOccasionKind[] }> {
  const rows = await prisma.giftSelfOccasion.findMany({
    where: { userId, declaredAt: { gte: new Date(now.getTime() - SELF_OCCASION_COOLDOWN_MS) } },
    select: { kind: true, declaredAt: true, removedAt: true },
  });
  const typed = rows.map((row) => ({ ...row, kind: row.kind as SelfOccasionKind }));
  return {
    showing: SELF_OCCASION_KINDS.filter((kind) => typed.some((row) => row.kind === kind && selfOccasionActive(row, now))),
    available: SELF_OCCASION_KINDS.filter((kind) => selfOccasionRefusal(typed, kind, now) === null),
  };
}
