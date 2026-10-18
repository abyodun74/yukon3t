import { describe, expect, it, vi } from "vitest";
import { blockImageSave, PROTECTED_IMAGE_CLASS, protectedImageProps } from "./protected-image";

describe("protectedImageProps", () => {
  it("disables native drag and adds the protected class", () => {
    const props = protectedImageProps();
    expect(props.draggable).toBe(false);
    expect(props.className).toBe(PROTECTED_IMAGE_CLASS);
  });

  it("keeps the caller's own classes", () => {
    expect(protectedImageProps("h-full w-full object-cover").className).toBe(
      `${PROTECTED_IMAGE_CLASS} h-full w-full object-cover`,
    );
  });

  it("blocks the context menu and drag start", () => {
    const props = protectedImageProps();
    const contextMenu = { preventDefault: vi.fn() };
    const dragStart = { preventDefault: vi.fn() };
    props.onContextMenu(contextMenu);
    props.onDragStart(dragStart);
    expect(contextMenu.preventDefault).toHaveBeenCalledOnce();
    expect(dragStart.preventDefault).toHaveBeenCalledOnce();
  });
});

describe("blockImageSave", () => {
  it("prevents the default action", () => {
    const e = { preventDefault: vi.fn() };
    blockImageSave(e);
    expect(e.preventDefault).toHaveBeenCalledOnce();
  });
});
