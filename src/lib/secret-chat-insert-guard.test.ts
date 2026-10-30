import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Nothing but the chat thread's own composer may write a message straight into a conversation: every other insert
// (a share of a post/link, Muse, Story or a photo/video from another app, a forward, a story reply, any future
// "send to a friend") is built by the server and can't be end-to-end encrypted, so it must go through
// createNonE2eeMessage (src/lib/non-e2ee-message.ts), which refuses a secret chat. This scans the source in the style of
// circle-visibility-exposure.test.ts: a new direct insert fails here until it is either routed through the chokepoint
// or reviewed and added below (a new direct insert is a decision, not an accident).

const SRC = "src";
const EXTRA_DIRS = ["netlify", "scripts"]; // crons and one-off scripts write with the same client

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return entry === "generated" || entry === "node_modules" ? [] : files(p);
    return /\.(ts|tsx|mts|mjs|js)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [p] : [];
  });
}

const rel = (p: string) => relative(".", p).split(sep).join("/");

/** The nearest exported function declared before `index` (which action or helper an insert is in). */
function enclosingFunction(source: string, index: number): string {
  const before = source.slice(0, index);
  const names = [...before.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*[<(]/g)];
  return names.length ? names[names.length - 1][1] : "<top level>";
}

// Any way of inserting a Message row: the model's create/createMany/createManyAndReturn/upsert (on prisma or a tx),
// a nested `messages: { create… }` under a conversation write, or raw SQL.
const INSERT = [
  /\.message\.(create|createMany|createManyAndReturn|upsert)\s*\(/g,
  /\bmessages\s*:\s*\{\s*(create|createMany|connectOrCreate|upsert)\b/g,
  /INSERT\s+INTO\s+"Message"/gi,
];

// The only direct inserts allowed, "file#function". Each with the reason it may write into a secret chat itself.
const ALLOWED_DIRECT_INSERTS = [
  // The chokepoint: re-reads the destination under a lock and refuses a secret chat before this insert.
  "src/lib/non-e2ee-message.ts#createNonE2eeMessage",
  // The chat thread's composer: in a secret chat its text is ciphertext encrypted on the sender's device, enforced
  // by checkSecretSend (plaintext refused in a secret chat, ciphertext refused anywhere else).
  "src/app/actions/messages.ts#sendMessage",
  // The chat thread's composer, "View once" photo/video: no text at all, sent from inside the 1:1 itself.
  "src/app/actions/view-once.ts#sendViewOnceMessage",
];

function directInserts(): string[] {
  const found: string[] = [];
  for (const file of [...files(SRC), ...EXTRA_DIRS.flatMap(files)]) {
    const source = readFileSync(file, "utf8");
    for (const pattern of INSERT) {
      for (const match of source.matchAll(pattern)) {
        found.push(`${rel(file)}#${enclosingFunction(source, match.index!)}`);
      }
    }
  }
  return found.sort();
}

describe("inserts of chat messages", () => {
  it("go through createNonE2eeMessage, except the chokepoint itself and the chat composer", () => {
    expect(directInserts()).toEqual([...ALLOWED_DIRECT_INSERTS].sort());
  });

  it("the chokepoint refuses a secret chat, re-read under a lock in the insert's transaction", () => {
    const source = readFileSync("src/lib/non-e2ee-message.ts", "utf8");
    expect(source).toMatch(/\$transaction\(/);
    expect(source).toMatch(/FOR SHARE/);
    expect(source).toMatch(/isSecretChat\(/);
    expect(source).toMatch(/error: "secret_chat"/);
  });

  it("the composer keeps its own end-to-end gate (ciphertext only in a secret chat)", () => {
    const source = readFileSync("src/app/actions/messages.ts", "utf8");
    const start = source.indexOf("export async function sendMessage(");
    const end = source.indexOf("\nexport ", start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, end)).toMatch(/checkSecretSend\(/);
  });

  it("every caller of the chokepoint looks at its answer (a refusal must not be counted as sent)", () => {
    const unchecked: string[] = [];
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?<!function\s)createNonE2eeMessage\(/g)) {
        const lead = source.slice(Math.max(0, match.index! - 60), match.index!);
        if (!/const\s+\w+\s*=\s*await\s+$/.test(lead)) unchecked.push(`${rel(file)}#${enclosingFunction(source, match.index!)}`);
      }
    }
    expect(unchecked).toEqual([]);
  });

  it("no share or forward path still opts a secret chat in", () => {
    for (const file of ["src/lib/share-to-chats.ts", "src/lib/share-to-chats-server.ts", "src/app/actions/share-to-chats.ts", "src/app/actions/stories.ts"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/allowSecret/);
    }
  });
});
