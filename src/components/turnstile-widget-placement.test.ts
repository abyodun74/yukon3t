import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OVERLAY_LAYERS } from "@/lib/overlay-layers";

// Source guards for where and how the Turnstile widget renders. The widget (and Cloudflare's checkbox iframe inside
// it) sits in normal page content (OVERLAY_LAYERS.content): it must never be portalled into the overlay root or put
// inside a Sheet / overlay, where a sheet, viewer or the call UI could cover the checkbox the person has to tap.

const ROOT = join(process.cwd(), "src");
const WIDGET = join(ROOT, "components", "turnstile-widget.tsx");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("Turnstile widget placement", () => {
  const widget = readFileSync(WIDGET, "utf8");

  it("renders inline in page content: no portal, no z-index of its own", () => {
    expect(OVERLAY_LAYERS.content).toBe(0);
    expect(widget).not.toMatch(/createPortal|OverlayPortal|useOverlayZ/);
    expect(widget).not.toMatch(/\bz-(\d|\[)/);
    expect(widget).not.toMatch(/position:\s*["']?fixed|\bfixed\b/);
  });

  it("is never mounted from inside a Sheet or an overlay", () => {
    const mounters = walk(ROOT).filter((f) => {
      const src = readFileSync(f, "utf8");
      return f !== WIDGET && /TurnstileWidget|useTurnstileGate/.test(src) && /from "@\/components\/(turnstile-widget|use-turnstile-gate)"/.test(src);
    });
    expect(mounters.length).toBeGreaterThan(5);
    for (const f of mounters) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from "@\/components\/sheet"|OverlayPortal|createPortal/);
    }
  });

  it("stays tap-gated and never re-runs an expired token by itself (privacy policy: runs only when you tap)", () => {
    expect(widget).toMatch(/execution: "execute"/);
    expect(widget).toMatch(/"refresh-expired": "never"/);
    expect(widget).toMatch(/retry: "never"/);
  });
});
