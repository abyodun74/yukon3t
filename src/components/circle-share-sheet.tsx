"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";
import { ShareLinkSheet, SHARE_SHEET_ITEM_CLASS } from "@/components/share-link-sheet";
import { useCircleShareText } from "@/components/circle-share-text";
import { shareCircleToConversations } from "@/app/actions/share-to-chats";
import { circleShareUrl, isCircleShareable } from "@/lib/circle-share";

/** What the sheet needs of a Circle: nothing a viewer of the card can't already see. */
export type ShareableCircle = {
  id: string;
  slug: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
};

/**
 * The one sheet for sharing a Circle, opened by a long press / right-click / ContextMenu key on any Circle card
 * (CircleLongPress) and by the Share button on a Circle's page (CircleShareButton). Built on the generic
 * ShareLinkSheet (share-link-sheet.tsx, shared with Collab sharing).
 *
 * PUBLIC Circle: "Share in chats" (SendToChatsPicker, up to 5 chats; the server writes the message, see
 * shareCircleToConversations), "Share via…" (the OS share sheet, or a copied link where there is none) and "Copy
 * link". PRIVATE Circle: no share action at all (invite-only, see src/lib/circle-share.ts), just that explanation and,
 * for someone who can invite, a link to the Invite section of its page. The server refuses a private Circle anyway.
 */
export function CircleShareSheet({
  circle,
  canInvite = false,
  open,
  onClose,
}: {
  circle: ShareableCircle;
  /** The viewer is the Circle's owner or co-admin (the Invite flow is theirs). Only changes the private hint. */
  canInvite?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { t, locale, dir } = useCircleShareText();
  return (
    <ShareLinkSheet
      open={open}
      onClose={onClose}
      name={circle.name}
      url={circleShareUrl(circle.slug)}
      shareable={isCircleShareable(circle)}
      text={t}
      locale={locale}
      dir={dir}
      sendToChats={(ids) => shareCircleToConversations(circle.id, ids)}
      notShareable={
        <>
          <p className="text-foreground-soft">{t.privateHint}</p>
          {canInvite && (
            <>
              <p className="text-foreground-soft">{t.privateInviteHint}</p>
              <Link
                href={`/circles/${encodeURIComponent(circle.slug)}#circle-invites`}
                onClick={onClose}
                className={SHARE_SHEET_ITEM_CLASS}
              >
                <UserPlus size={16} aria-hidden />
                {t.invite}
              </Link>
            </>
          )}
        </>
      }
    />
  );
}
