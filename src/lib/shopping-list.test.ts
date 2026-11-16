import { describe, expect, it } from "vitest";
import {
  SHOPPING_LIST_ITEM_MAX,
  SHOPPING_LIST_MAX_ITEMS,
  SHOPPING_LIST_TITLE_MAX,
  canAddChecklistItem,
  checklistFallbackText,
  checklistModerationText,
  checklistProgress,
  clampText,
  cleanChecklistTitle,
  cleanShoppingListItem,
  normalizeChecklistInput,
  formatShoppingList,
  shoppingListItems,
} from "./shopping-list";

describe("formatShoppingList", () => {
  it("formats a title and one boxed line per item", () => {
    expect(formatShoppingList("Saturday", ["Milk", "Eggs"], "Shopping list")).toBe("🛒 Saturday\n☐ Milk\n☐ Eggs");
  });

  it("falls back to the default title when the title is blank", () => {
    expect(formatShoppingList("   ", ["Milk"], "Shopping list")).toBe("🛒 Shopping list\n☐ Milk");
  });

  it("trims rows and skips empty ones", () => {
    expect(formatShoppingList("", ["  Milk  ", "", "   ", "Bread"], "List")).toBe("🛒 List\n☐ Milk\n☐ Bread");
  });

  it("returns an empty string when there is nothing to send", () => {
    expect(formatShoppingList("Title", ["", "  "], "List")).toBe("");
    expect(formatShoppingList("Title", [], "List")).toBe("");
  });

  it("keeps each row on one line", () => {
    expect(formatShoppingList("A\nB", ["Milk\nand\tcookies"], "List")).toBe("🛒 A B\n☐ Milk and cookies");
  });

  it("caps the title, each item and the number of items", () => {
    const longTitle = "t".repeat(100);
    const items = Array.from({ length: 50 }, (_, i) => `${i}`.padEnd(200, "x"));
    const text = formatShoppingList(longTitle, items, "List");
    const lines = text.split("\n");
    expect(lines).toHaveLength(1 + SHOPPING_LIST_MAX_ITEMS);
    expect(lines[0]).toBe(`🛒 ${"t".repeat(SHOPPING_LIST_TITLE_MAX)}`);
    for (const line of lines.slice(1)) expect(line.length).toBe(2 + SHOPPING_LIST_ITEM_MAX);
  });

  it("stays within the 4,000-character message limit at the largest size, even with emoji", () => {
    const items = Array.from({ length: SHOPPING_LIST_MAX_ITEMS }, () => "🍎".repeat(100));
    const text = formatShoppingList("🥑".repeat(100), items, "List");
    expect(text.length).toBeLessThanOrEqual(4000);
    // No broken surrogate pair anywhere.
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("works with right-to-left text", () => {
    expect(formatShoppingList("", ["حليب", "بيض"], "قائمة التسوق")).toBe("🛒 قائمة التسوق\n☐ حليب\n☐ بيض");
  });
});

describe("helpers", () => {
  it("clampText never splits a surrogate pair", () => {
    expect(clampText("ab🍎", 3)).toBe("ab");
    expect(clampText("ab🍎", 4)).toBe("ab🍎");
    expect(clampText("abc", 10)).toBe("abc");
  });

  it("cleanShoppingListItem trims after cutting", () => {
    expect(cleanShoppingListItem(`${"a".repeat(SHOPPING_LIST_ITEM_MAX - 1)} b`)).toBe("a".repeat(SHOPPING_LIST_ITEM_MAX - 1));
  });

  it("shoppingListItems drops blanks before applying the item cap", () => {
    const items = [...Array.from({ length: 10 }, () => ""), ...Array.from({ length: SHOPPING_LIST_MAX_ITEMS }, (_, i) => `i${i}`)];
    expect(shoppingListItems(items)).toHaveLength(SHOPPING_LIST_MAX_ITEMS);
  });
});

describe("checklist helpers", () => {
  it("normalizeChecklistInput cleans the title and rows and drops blanks", () => {
    expect(normalizeChecklistInput({ title: "  Week\n1 ", items: [" Milk ", "", "Eggs"] })).toEqual({ title: "Week 1", items: ["Milk", "Eggs"] });
  });

  it("normalizeChecklistInput refuses a list with no title or no item", () => {
    expect(normalizeChecklistInput({ title: " ", items: ["Milk"] })).toBeNull();
    expect(normalizeChecklistInput({ title: "List", items: ["  "] })).toBeNull();
  });

  it("caps the title", () => {
    expect(cleanChecklistTitle("t".repeat(100))).toBe("t".repeat(SHOPPING_LIST_TITLE_MAX));
    expect(cleanChecklistTitle("   ")).toBeNull();
  });

  it("builds the content stand-in and the moderation text", () => {
    expect(checklistFallbackText("Groceries")).toBe("🛒 Groceries");
    expect(checklistModerationText("Groceries", ["Milk", "Eggs"])).toBe("Groceries\nMilk\nEggs");
  });

  it("counts ticked rows", () => {
    expect(checklistProgress([{ checkedAt: new Date() }, { checkedAt: null }, { checkedAt: "2026-01-01" }])).toEqual({ done: 2, total: 3 });
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
  });

  it("allows rows up to the cap", () => {
    expect(canAddChecklistItem(SHOPPING_LIST_MAX_ITEMS - 1)).toBe(true);
    expect(canAddChecklistItem(SHOPPING_LIST_MAX_ITEMS)).toBe(false);
  });
});
