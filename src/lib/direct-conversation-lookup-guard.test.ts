import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// "The DM with this person" must only ever be a genuine 1:1 (isGroup: false, exactly the two of them), never a group or
// collab chat the two share. Every such lookup goes through findDirectConversationIds / findDirectConversationId
// (src/lib/direct-conversation.ts). These guard that from the source, in the style of collab-chat-visibility-exposure:
// no other file queries conversations by a member pair, and no other file builds a person -> conversation id map.

const SRC = "src";
const HELPER = "lib/direct-conversation.ts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return entry === "generated" ? [] : files(p);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [p] : [];
  });
}

const rel = (p: string) => relative(SRC, p).split(sep).join("/");

/** The argument text of the call whose opening parenthesis is at `open`, up to its matching close. */
function callArgs(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

const CONVERSATION_QUERY = /\.conversation\.(findMany|findFirst|findFirstOrThrow)\(/g;
const MEMBER_SOME = /members:\s*\{\s*some:/g;

/** Every conversation query in `source` that filters on two or more `members: { some: ... }` (a member pair). */
function pairQueries(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(CONVERSATION_QUERY)) {
    const args = callArgs(source, match.index! + match[0].length - 1);
    if ((args.match(MEMBER_SOME) ?? []).length >= 2) out.push(args);
  }
  return out;
}

// person id -> conversation id maps built by hand: `.set(other.userId, conv.id)`, or a `conversationIdBy...` map.
const HAND_BUILT_DM_MAP = /\.set\(\s*[\w.]*userId\s*,\s*\w+\.id\s*\)|\bconversationIdBy\w+\s*=\s*new Map/;

describe("the DM-with-this-person lookup", () => {
  it("no file other than the helper queries conversations by a member pair", () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      if (rel(file) === HELPER) continue;
      if (pairQueries(readFileSync(file, "utf8")).length > 0) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });

  it("no file other than the helper builds a person -> conversation id map by hand", () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      if (rel(file) === HELPER) continue;
      if (HAND_BUILT_DM_MAP.test(readFileSync(file, "utf8"))) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });

  it("the helper's pair query is 1:1 only: isGroup false, exactly the two members, oldest first, collab filter", () => {
    const source = readFileSync(join(SRC, HELPER), "utf8");
    const queries = pairQueries(source);
    expect(queries).toHaveLength(1);
    const [query] = queries;
    expect(query).toMatch(/isGroup:\s*false/);
    expect(query).toMatch(/members:\s*\{\s*every:\s*\{\s*userId:\s*\{\s*in:\s*\[viewerId, \.\.\.others\]/);
    expect(query).toMatch(/collabChatVisibleWhere\(viewerId\)/);
    expect(query).toMatch(/orderBy:\s*\[\{\s*createdAt:\s*"asc"\s*\},\s*\{\s*id:\s*"asc"\s*\}\]/);
    expect(source).toMatch(/if \(members\.length !== 2\) return null;/);
  });

  it("every surface that shows a person's Message button uses the helper", () => {
    const uses: Record<string, RegExp> = {
      "app/actions/discover.ts": /findDirectConversationIds\(me\.id, acceptedOtherIds\)[\s\S]*findDirectConversationIds\(me\.id, connectedIds\)/,
      "app/discover/page.tsx": /findDirectConversationIds\(me\.id, mayKnowAcceptedOtherIds\)[\s\S]*findDirectConversationIds\(me\.id, acceptedOtherIds\)/,
      "app/actions/connections.ts": /findDirectConversationIds\(userId, otherIds\)[\s\S]*findDirectConversationIds\(userId, otherIds\)/,
      "lib/engagement-status.ts": /findDirectConversationIds\(viewerId, acceptedAuthorIds\)/,
      "app/u/[userId]/page.tsx": /findDirectConversationId\(me\.id, user\.id\)/,
      "app/actions/stories.ts": /findDirectConversationId\(user\.id, story\.authorId\)/,
    };
    for (const [file, pattern] of Object.entries(uses)) {
      expect(readFileSync(join(SRC, file), "utf8"), file).toMatch(pattern);
    }
    const connections = readFileSync(join(SRC, "app/actions/connections.ts"), "utf8");
    expect(connections).toMatch(/findDirectConversationId\(updated\.requesterId, updated\.targetId\)/);
    expect(connections).toMatch(/findDirectConversationId\(user\.id, targetId\)/);
  });
});
