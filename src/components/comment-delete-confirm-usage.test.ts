import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Owner, 2026-11-13: deleting a comment or reply always asks first ("Delete this comment?"). Every browser call of a
// comment-delete Server Action must sit inside the action given to useConfirmAction (confirm-dialog.tsx), which only
// runs from the dialog's Delete button, never straight from a tap. A new surface that calls one directly fails here.

const DELETE_ACTIONS = ["deleteComment", "deleteMuseComment", "deleteStoryComment"];

const SRC = join(__dirname, "..");
const clientFiles = (readdirSync(SRC, { recursive: true }) as string[])
  .map((f) => join(SRC, f))
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .filter((f) => !f.includes(`${sep}generated${sep}`) && !f.includes(`${sep}app${sep}actions${sep}`))
  .map((f) => ({ file: relative(SRC, f).split(sep).join("/"), source: readFileSync(f, "utf8") }))
  .filter(({ source }) => /^\s*["']use client["']/.test(source));

/** [start, end) of every `useConfirmAction(...)` call's argument list, by matching parentheses. */
function confirmRanges(source: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const m of source.matchAll(/\buseConfirmAction\s*(?:<[^>]*>)?\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) {
        ranges.push([open, i]);
        break;
      }
    }
  }
  return ranges;
}

function deleteCalls(source: string) {
  const calls: { action: string; index: number }[] = [];
  for (const action of DELETE_ACTIONS) {
    for (const m of source.matchAll(new RegExp(`\\b${action}\\s*\\(`, "g"))) {
      // Skip the action's own definition or an import line.
      const lineStart = source.lastIndexOf("\n", m.index!) + 1;
      const line = source.slice(lineStart, source.indexOf("\n", m.index!));
      if (/\bfunction\b|\bimport\b/.test(line)) continue;
      calls.push({ action, index: m.index! });
    }
  }
  return calls;
}

describe("comment deletes go through the confirmation", () => {
  const callers = clientFiles.filter(({ source }) => deleteCalls(source).length > 0);

  it("finds the known delete surfaces (so the scan itself is still looking at the right code)", () => {
    expect(callers.map((c) => c.file).sort()).toEqual(
      ["components/comment-card.tsx", "components/muse-comments-sheet.tsx", "components/story-viewer.tsx"].sort(),
    );
  });

  it.each(callers.map((c) => [c.file, c.source] as const))("%s only deletes from inside useConfirmAction", (file, source) => {
    const ranges = confirmRanges(source);
    for (const call of deleteCalls(source)) {
      const inside = ranges.some(([start, end]) => call.index > start && call.index < end);
      expect(inside, `${file}: ${call.action}( outside useConfirmAction`).toBe(true);
    }
    // ...and renders the dialog that is the only way to confirm.
    expect(source, file).toMatch(/<CommentDeleteDialog\b/);
  });

  it("the dialog focuses Cancel, and its Delete is disabled while the delete runs", () => {
    const dialog = readFileSync(join(__dirname, "confirm-dialog.tsx"), "utf8");
    expect(dialog).toMatch(/ref=\{cancelRef\}/);
    expect(dialog).toMatch(/cancelRef\.current\?\.focus\(/);
    expect(dialog).toMatch(/disabled=\{pending\}[\s\S]*?onClick=\{onConfirm\}/);
    expect(dialog).toMatch(/useBackDismiss\(open, onCancel\)/);
    expect(dialog).not.toMatch(/window\.confirm|\bconfirm\(\s*["'`]/);
  });

  it("nothing in the app deletes a comment through window.confirm", () => {
    for (const { file, source } of clientFiles) {
      if (deleteCalls(source).length === 0) continue;
      expect(source, file).not.toMatch(/window\.confirm\(/);
    }
  });
});
