import { describe, expect, it } from "vitest";
import {
  collabHiddenByBlock,
  collabNotBlockedWhere,
  collabNotificationVisibleWhere,
  keepCollabViewers,
  notBlockedWithAuthorUserWhere,
} from "@/lib/collab-visibility";

const AUTHOR = "cau00000000001";
const ME = "cme00000000001";
const OTHER = "cot00000000001";

describe("collabHiddenByBlock", () => {
  it("hides a collab from someone blocked either way with its author", () => {
    expect(collabHiddenByBlock({ authorId: AUTHOR }, ME, true)).toBe(true);
  });

  it("changes nothing without a block", () => {
    expect(collabHiddenByBlock({ authorId: AUTHOR }, ME, false)).toBe(false);
  });

  it("never hides a collab from its own author", () => {
    expect(collabHiddenByBlock({ authorId: AUTHOR }, AUTHOR, true)).toBe(false);
  });
});

describe("collabNotBlockedWhere", () => {
  it("drops collabs whose author blocked the viewer or was blocked by them, in the same query", () => {
    expect(collabNotBlockedWhere(ME)).toEqual({
      NOT: {
        author: {
          OR: [{ blocksMade: { some: { blockedId: ME } } }, { blocksReceived: { some: { blockerId: ME } } }],
        },
      },
    });
  });
});

describe("collabNotificationVisibleWhere", () => {
  it("drops rows about a collab, or tied to a collab's group chat, whose author is blocked either way with the reader", () => {
    const blocked = {
      OR: [{ blocksMade: { some: { blockedId: ME } } }, { blocksReceived: { some: { blockerId: ME } } }],
    };
    expect(collabNotificationVisibleWhere(ME)).toEqual({
      AND: [
        { NOT: { collab: { author: blocked } } },
        { NOT: { conversation: { collabBoardPost: { is: { authorId: { not: ME }, author: blocked } } } } },
      ],
    });
  });
});

describe("notBlockedWithAuthorUserWhere", () => {
  it("matches people with no block either way with the author", () => {
    expect(notBlockedWithAuthorUserWhere(AUTHOR)).toEqual({
      NOT: {
        OR: [{ blocksMade: { some: { blockedId: AUTHOR } } }, { blocksReceived: { some: { blockerId: AUTHOR } } }],
      },
    });
  });
});

describe("keepCollabViewers", () => {
  it("keeps everyone but those blocked either way with the author, and always the author", () => {
    expect(keepCollabViewers({ authorId: AUTHOR }, [AUTHOR, ME, OTHER], new Set([ME]))).toEqual([AUTHOR, OTHER]);
    expect(keepCollabViewers({ authorId: AUTHOR }, [ME, OTHER], new Set())).toEqual([ME, OTHER]);
  });
});
