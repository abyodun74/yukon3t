import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// A collab's group chat must not exist for someone blocked either way with the collab's author (lib/collab-visibility.ts,
// collab-chat-visibility-server.ts). These guard that from the source, in the style of collab-visibility-exposure.test.ts
// and the hidden-chat guards: every query that lists conversations applies collabChatVisibleWhere in the query itself;
// every page / action / helper that reads one chat or message for a viewer goes through the decision (collabChatHiddenFor,
// collabChatVisibleWhere in its where, or collabChatRecipientsOnly for a fan-out), unless it is on an explicit list of
// reviewed exceptions; and the decision comes before the hidden-chat (PIN) lock, which would otherwise tell the two apart.

const SRC = "src";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return entry === "generated" ? [] : files(p);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [p] : [];
  });
}

const rel = (p: string) => relative(SRC, p).split(sep).join("/");
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");

/** The argument text of the call whose opening parenthesis is at `open`, up to its matching close. */
function callArgs(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

/** Each top-level function of `source` (exported or not) with its body (up to the next one), by name. */
function topLevelFunctions(source: string): { name: string; body: string }[] {
  const starts = [...source.matchAll(/^(?:export )?(?:default )?(?:async )?function (\w+)|^export const (\w+) = cache\(/gm)];
  return starts.map((m, i) => ({
    name: m[1] ?? m[2],
    body: source.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index : source.length),
  }));
}

/** The body of one top-level function of `source`, up to its closing brace at column 0. */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, signature).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start);
  return rest.slice(0, rest.indexOf("\n}\n"));
}

const LIST_FILTER = /\bcollabChat(Visible|Hidden)Where\(/;

// Conversation lists that deliberately don't take the filter, with the reason. Keyed by file, the count.
const UNFILTERED_CONVERSATION_LISTS: Record<string, number> = {
  // (The "DM with each of these people" maps all go through findDirectConversationIds, lib/direct-conversation.ts,
  // which applies collabChatVisibleWhere; direct-conversation-lookup-guard.test.ts keeps them there.)
  // Site-admin views (/admin/groups, the moderation Duplicates tool): moderation, no member-facing shortcut.
  "app/admin/groups/page.tsx": 1,
  "lib/moderation-duplicates-data.ts": 2,
  // The group directory: both queries spread `baseWhere`, which carries collabChatVisibleWhere (checked below).
  "app/messages/discover/page.tsx": 2,
};

const READS_ONE_CHAT =
  /\.(conversationMember\.(findUnique|findFirst|updateMany)|conversation\.(findUnique|findFirst)|message\.(findUnique|findFirst)|groupJoinRequest\.findUnique)\(/;
const DECISION = /\b(collabChatHiddenFor|collabChatsHiddenFor|collabChatVisibleWhere|collabChatRecipientsOnly)\(/;

// Functions that read one chat or message without the collab-chat decision, with the reason ("file#function").
const UNCHECKED_CHAT_READS = new Set([
  // Not gated server-side, like leaveCollab: it only removes the caller's own membership. (No UI entry point for a
  // hidden viewer: the thread page 404s.)
  "app/actions/messages.ts#leaveGroup",
  // Site-admin moderation (the Duplicates tool, reports, content removal), not a member-facing surface.
  "app/actions/messages.ts#deleteConversation",
  "lib/content-moderation.ts#removeModeratedContent",
  "lib/report-target.ts#accusedUserIdOf",
  // 1:1 chats only (`isGroup: false`, or refuses a group before anything else): a collab chat is always a group.
  "app/actions/stories.ts#replyToStory",
  "lib/birthday-wish-server.ts#sendBirthdayWishAs",
  "app/actions/gifts.ts#chatPlaceRefusal",
  // Gift cards only ever go into a 1:1 (chatPlaceRefusal), so a gift's chat is never a collab chat.
  "app/actions/gifts.ts#getGiftChatCard",
  // View-once messages exist only in 1:1 chats (requestViewOnceUpload refuses groups); the send itself goes through
  // loadDirectConversation, which applies the decision (checked below).
  "app/actions/view-once.ts#loadForRecipient",
  "app/actions/view-once.ts#sendViewOnceMessage",
  // The caller's own e2ee flags on every membership (key reset): their own rows, nothing read from a chat.
  "app/actions/e2ee.ts#resetEncryptionKeys",
  // The hidden-chat lock primitive: every caller asks collabChatHiddenFor first (ordering checked below).
  "lib/hidden-chats.ts#isConversationLocked",
  // "Has this person ever sent a message" for the review prompt: their own activity, no chat is read.
  "app/actions/review-prompt.ts#hasMeaningfulActivity",
  // The collab page reads its own chat only after its own block 404 (collab-visibility-exposure.test.ts).
  "app/collab/[id]/page.tsx#CollabDetailPage",
]);

describe("queries that list conversations", () => {
  it("apply collabChatVisibleWhere in the query, except a reviewed list of 1:1-only and admin paths", () => {
    const unfiltered: Record<string, number> = {};
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\.conversation\.findMany\(/g)) {
        const args = callArgs(source, match.index! + match[0].length - 1);
        if (!LIST_FILTER.test(args)) unfiltered[rel(file)] = (unfiltered[rel(file)] ?? 0) + 1;
      }
    }
    expect(unfiltered).toEqual(UNFILTERED_CONVERSATION_LISTS);
  });

  it("the group directory's shared where carries the filter", () => {
    const page = read("app", "messages", "discover", "page.tsx");
    const base = page.slice(page.indexOf("const baseWhere"), page.indexOf("};", page.indexOf("const baseWhere")));
    expect(base).toMatch(/collabChatVisibleWhere\(me\.id\)/);
  });

  it("the inbox / hidden list, the badge count and the membership-wide writes apply it too", () => {
    expect(read("lib", "inbox-items.ts")).toMatch(/\.\.\.collabChatVisibleWhere\(userId\)/);
    const unread = functionBody(read("lib", "latest-messages.ts"), "export async function countConversationsWithUnread");
    expect(unread).toMatch(/AND NOT \$\{collabChatHiddenSql\(userId, /);
    expect(read("app", "api", "badge-counts", "route.ts")).toMatch(/countConversationsWithUnread\(user\.id\)/);
    const messages = read("app", "actions", "messages.ts");
    expect(functionBody(messages, "export async function markMessagesDelivered")).toMatch(
      /conversation: collabChatVisibleWhere\(user\.id\)/,
    );
    const hidden = read("app", "actions", "hidden-chats.ts");
    for (const fn of ["export async function hideConversation", "export async function unhideConversation"]) {
      expect(functionBody(hidden, fn), fn).toMatch(/conversation: collabChatVisibleWhere\(user\.id\)/);
    }
    expect(read("lib", "translation-access.ts")).toMatch(/\.\.\.collabChatVisibleWhere\(viewerId\)/);
  });
});

describe("pages, actions and helpers that read one chat or message", () => {
  it("go through the collab-chat decision, except reviewed paths", () => {
    const unchecked: string[] = [];
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      if (!READS_ONE_CHAT.test(source)) continue;
      for (const fn of topLevelFunctions(source)) {
        if (READS_ONE_CHAT.test(fn.body) && !DECISION.test(fn.body)) unchecked.push(`${rel(file)}#${fn.name}`);
      }
    }
    expect(unchecked.sort()).toEqual([...UNCHECKED_CHAT_READS].sort());
  });

  it("decide before the hidden-chat lock, so a PIN-hidden collab chat answers like any chat you are not in", () => {
    const LOCK = /\b(isMembershipLocked|isConversationLocked|redirect\(hiddenUnlockPath)\(?/;
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const fn of topLevelFunctions(source)) {
        const decision = fn.body.search(/\bcollabChatHiddenFor\(/);
        const lock = fn.body.search(LOCK);
        if (decision >= 0 && lock >= 0 && lock < decision) offenders.push(`${rel(file)}#${fn.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the thread page 404s before the join-request page and before the PIN redirect", () => {
    const page = read("app", "messages", "[id]", "page.tsx");
    const gate = page.indexOf("if (conversation.isGroup && (await collabChatHiddenFor(me.id, id))) notFound();");
    expect(gate).toBeGreaterThan(page.indexOf("if (!conversation) notFound();"));
    expect(page.indexOf("if (!membership) {")).toBeGreaterThan(gate);
    expect(page.indexOf("isMembershipLocked(membership, me.id)")).toBeGreaterThan(gate);
  });

  it("the 1:1-only helpers apply it too where a group could reach them (view-once, secret chat)", () => {
    expect(functionBody(read("app", "actions", "view-once.ts"), "async function loadDirectConversation")).toMatch(
      /collabChatHiddenFor\(userId, conversationId\)/,
    );
    expect(functionBody(read("app", "actions", "e2ee.ts"), "async function conversationForMember")).toMatch(
      /collabChatHiddenFor\(userId, conversationId\)/,
    );
  });

  it("decide in one place: the helpers are built on collabChatHiddenWhere", () => {
    const server = read("lib", "collab-chat-visibility-server.ts");
    expect(functionBody(server, "export async function collabChatsHiddenFor")).toMatch(/\.\.\.collabChatHiddenWhere\(viewerId\)/);
    expect(functionBody(server, "export async function collabChatHiddenFor")).toMatch(/collabChatsHiddenFor\(viewerId, \[conversationId\]\)/);
    expect(functionBody(server, "export async function collabChatRecipientsOnly")).toMatch(/collabViewersOnly\(collab, ids\)/);
    const pure = read("lib", "collab-visibility.ts");
    expect(functionBody(pure, "export function collabChatVisibleWhere")).toMatch(/NOT: collabChatHiddenWhere\(viewerId\)/);
    expect(functionBody(pure, "export function collabNotificationVisibleWhere")).toMatch(
      /NOT: \{ conversation: collabChatHiddenWhere\(recipientId\) \}/,
    );
  });
});

describe("fan-outs about a chat", () => {
  it("skip people a collab chat is hidden from (collabChatRecipientsOnly)", () => {
    const after = functionBody(read("lib", "after-message-sent.ts"), "export async function afterMessageSent");
    const recipients = after.indexOf("collabChatRecipientsOnly(conversationId, recipientIds)");
    expect(recipients).toBeGreaterThan(0);
    // Before anything is sent: pushes, FCM, bell rows and badge signals all use the filtered list.
    for (const step of ["sendPushToUsers(", "sendFcmActivityToUsers(", "prisma.notification.createMany(", "publishEvents("]) {
      expect(after.indexOf(step), step).toBeGreaterThan(recipients);
    }
    const screenshot = read("app", "actions", "screenshot.ts");
    expect(screenshot).toMatch(/collabChatRecipientsOnly\(\s*target\.id,/);
  });
});
