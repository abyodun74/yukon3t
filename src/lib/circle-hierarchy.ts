// Rules for sub-circles (Circle.parentId). Kept as pure functions so the
// createCircle action and the /circles/new page enforce exactly the same
// thing, and so it can be unit-tested without a database.
//
// The shape of the feature: a top-level "main" Circle can have sub-circles.
// A sub-circle is a full Circle of its own (own members, join requests,
// channels, posts) that anyone can join independently of the main Circle.
// Only one level of nesting — a sub-circle can't have sub-circles.

export type ParentCircle = {
  createdById: string;
  parentId: string | null;
};

export type SubCircleParentCheck = "ok" | "not_found" | "not_top_level" | "forbidden";

/**
 * Can `userId` create a sub-circle under `parent`? Only the main Circle's
 * owner can — co-admins can't, since the owner is also the owner of every
 * sub-circle under it, which is what keeps "delete the main Circle" (which
 * deletes its sub-circles too) a decision for one person.
 */
export function checkSubCircleParent(parent: ParentCircle | null, userId: string): SubCircleParentCheck {
  if (!parent) return "not_found";
  if (parent.parentId !== null) return "not_top_level";
  if (parent.createdById !== userId) return "forbidden";
  return "ok";
}

/**
 * A sub-circle can never be more open than the Circle it sits under: under a
 * PRIVATE main Circle, a PUBLIC sub-circle would let anyone bypass the main
 * Circle's join-by-request by walking in through the side door.
 */
export function subCircleVisibility(
  parentVisibility: "PUBLIC" | "PRIVATE",
  requested: "PUBLIC" | "PRIVATE",
): "PUBLIC" | "PRIVATE" {
  return parentVisibility === "PRIVATE" ? "PRIVATE" : requested;
}
