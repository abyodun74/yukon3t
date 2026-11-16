"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";
import { ShareLinkSheet, SHARE_SHEET_ITEM_CLASS } from "@/components/share-link-sheet";
import { useCollabShareText } from "@/components/collab-share-text";
import { shareCollabToConversations } from "@/app/actions/share-to-chats";
import { collabShareUrl, isCollabShareable } from "@/lib/collab-share";

/** What the sheet needs of a collab: nothing a viewer of its card can't already see. */
export type ShareableCollab = {
  id: string;
  title: string;
  visibility: "PUBLIC" | "PRIVATE";
  status: "OPEN" | "CLOSED";
};

/**
 * The one sheet for sharing a collab, opened by a long press / right-click / ContextMenu key on any Collab card
 * (CollabLongPress) and by the Share button on a collab's page (CollabShareButton). Built on the generic
 * ShareLinkSheet, like the Circle sheet.
 *
 * PUBLIC, OPEN collab: "Share in chats" (up to 5 chats; the server writes the message, see shareCollabToConversations),
 * "Share via…" and "Copy link" (https://yukon3t.com/collab/<id>). PRIVATE collab: no share action at all (invite-only,
 * see src/lib/collab-share.ts), just that explanation and, for someone who can invite, a link to the Invite section of
 * its page. CLOSED collab: just "closed, can't be shared". The server refuses both anyway.
 */
export function CollabShareSheet({
  collab,
  canInvite = false,
  open,
  onClose,
}: {
  collab: ShareableCollab;
  /** The viewer is the collab's author or an OWNER/MODERATOR participant (canInviteToCollab). Only changes the private hint. */
  canInvite?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { t, locale, dir } = useCollabShareText();
  return (
    <ShareLinkSheet
      open={open}
      onClose={onClose}
      name={collab.title}
      url={collabShareUrl(collab.id)}
      shareable={isCollabShareable(collab)}
      text={t}
      locale={locale}
      dir={dir}
      sendToChats={(ids) => shareCollabToConversations(collab.id, ids)}
      notShareable={
        collab.visibility === "PRIVATE" ? (
          <>
            <p className="text-foreground-soft">{t.privateHint}</p>
            {canInvite && collab.status === "OPEN" && (
              <>
                <p className="text-foreground-soft">{t.privateInviteHint}</p>
                <Link
                  href={`/collab/${encodeURIComponent(collab.id)}#collab-invites`}
                  onClick={onClose}
                  className={SHARE_SHEET_ITEM_CLASS}
                >
                  <UserPlus size={16} aria-hidden />
                  {t.invite}
                </Link>
              </>
            )}
          </>
        ) : (
          <p className="text-foreground-soft">{t.closedHint}</p>
        )
      }
    />
  );
}
