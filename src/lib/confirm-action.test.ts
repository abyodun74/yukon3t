import { describe, expect, it, vi } from "vitest";
import { countDescendants, createConfirmAction, deleteCommentMessage } from "@/lib/confirm-action";
import { commentToolsEn } from "@/lib/i18n/en/commentTools";
import { commentTools as commentToolsAr } from "@/lib/i18n/ar/commentTools";
import { commentTools as commentToolsFr } from "@/lib/i18n/fr/commentTools";

function deferred() {
  let resolve!: (v: boolean | void) => void;
  const promise = new Promise<boolean | void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createConfirmAction (delete confirmation)", () => {
  it("never runs the action on a request alone", async () => {
    const run = vi.fn(async () => {});
    const flow = createConfirmAction<string>();
    flow.request("c1");
    flow.request("c2");
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    expect(flow.state).toEqual({ target: "c2", pending: false, failed: false });
  });

  it("cancel closes without running anything, and confirm after cancel does nothing", async () => {
    const run = vi.fn(async () => {});
    const onChange = vi.fn();
    const flow = createConfirmAction<string>(onChange);
    flow.request("c1");
    expect(flow.cancel()).toBe(true);
    expect(flow.state.target).toBeNull();
    expect(await flow.confirm(run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it("confirm runs once for the requested target, and a doubled confirm while pending is dropped", async () => {
    const gate = deferred();
    const run = vi.fn(() => gate.promise);
    const flow = createConfirmAction<string>();
    flow.request("c1");
    const first = flow.confirm(run);
    const second = flow.confirm(run);
    const third = flow.confirm(run);
    expect(flow.state.pending).toBe(true);
    // Neither cancel nor a new request can interrupt a delete half way.
    expect(flow.cancel()).toBe(false);
    expect(flow.request("c2")).toBe(false);
    gate.resolve();
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(await third).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("c1");
    expect(flow.state).toEqual({ target: null, pending: false, failed: false });
    // Closed: another confirm runs nothing.
    expect(await flow.confirm(run)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open with an error when the action fails (answer false or a throw), and can retry", async () => {
    let attempt = 0;
    const run = vi.fn(async () => {
      attempt++;
      if (attempt === 1) return false;
      if (attempt === 2) throw new Error("network");
    });
    const flow = createConfirmAction<string>();
    flow.request("c1");
    expect(await flow.confirm(run)).toBe(false);
    expect(flow.state).toEqual({ target: "c1", pending: false, failed: true });
    expect(await flow.confirm(run)).toBe(false);
    expect(flow.state.failed).toBe(true);
    expect(await flow.confirm(run)).toBe(true);
    expect(flow.state).toEqual({ target: null, pending: false, failed: false });
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe("the delete message", () => {
  it("names the replies that go with a comment, in the reader's language", () => {
    expect(deleteCommentMessage(commentToolsEn.confirmDelete, "en", 0)).toBe(commentToolsEn.confirmDelete.body);
    expect(deleteCommentMessage(commentToolsEn.confirmDelete, "en", 1)).toBe(
      "Its reply will be deleted too. This can't be undone.",
    );
    expect(deleteCommentMessage(commentToolsEn.confirmDelete, "en", 3)).toBe(
      "Its 3 replies will be deleted too. This can't be undone.",
    );
    expect(deleteCommentMessage(commentToolsFr.confirmDelete, "fr", 2)).toContain("2 réponses");
    expect(deleteCommentMessage(commentToolsAr.confirmDelete, "ar", 2)).toContain("ردّاه");
  });

  it("counts every reply under a post comment, at any depth", () => {
    expect(countDescendants({ replies: [] })).toBe(0);
    expect(
      countDescendants({ replies: [{ replies: [{ replies: [] }, { replies: [{ replies: [] }] }] }, { replies: [] }] }),
    ).toBe(5);
  });
});
