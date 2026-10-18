/**
 * Which inputs of the "post a collaboration" form failed, as a short list of field names that travels in the
 * `?fields=` query of the error redirect and is also produced by the browser's own pre-submit check. Pure and
 * client-safe. The names are an allowlist, in the order the inputs appear on the page (that order decides which
 * one gets focus first); anything else in a query string is dropped.
 */
export const COLLAB_FORM_FIELDS = [
  "title",
  "type",
  "countries",
  "inviteeIds",
  "scheduleDays",
  "scheduleTime",
  "description",
] as const;

export type CollabFormField = (typeof COLLAB_FORM_FIELDS)[number];

const FIELD_SET: ReadonlySet<string> = new Set(COLLAB_FORM_FIELDS);

/** Zod paths that belong to a visible input other than the one with the same name (a bad Circle id is the invite pickers' problem). */
const PATH_ALIASES: Record<string, CollabFormField> = {
  circleIds: "inviteeIds",
  visibility: "inviteeIds",
  worldwide: "countries",
};

function sortByFormOrder(fields: Iterable<CollabFormField>): CollabFormField[] {
  const found = new Set(fields);
  return COLLAB_FORM_FIELDS.filter((f) => found.has(f));
}

/** Maps zod issues to the allowlisted field names, deduplicated and in form order. */
export function collabFieldsFromIssues(issues: readonly { path: readonly PropertyKey[] }[]): CollabFormField[] {
  const found = new Set<CollabFormField>();
  for (const issue of issues) {
    const head = issue.path[0];
    if (typeof head !== "string") continue;
    if (FIELD_SET.has(head)) found.add(head as CollabFormField);
    else if (Object.hasOwn(PATH_ALIASES, head)) found.add(PATH_ALIASES[head]);
  }
  return sortByFormOrder(found);
}

/** Reads the `fields` query value back: unknown names and repeats are dropped, order follows the form. */
export function parseCollabFields(raw: string | string[] | null | undefined): CollabFormField[] {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text) return [];
  return sortByFormOrder(text.split(",").filter((f): f is CollabFormField => FIELD_SET.has(f)));
}

/** The error redirect for a failed validation, naming the inputs to send the person back to. */
export function collabInvalidPath(fields: readonly CollabFormField[]): string {
  const list = sortByFormOrder(fields).join(",");
  return list ? `/collab/new?error=invalid&fields=${list}` : "/collab/new?error=invalid";
}

export type CollabFormValues = {
  title: string;
  description: string;
  type: string;
  worldwide: boolean;
  countries: readonly string[];
  visibility: string;
  inviteeIds: readonly string[];
  circleIds: readonly string[];
  scheduleDays: readonly unknown[];
  scheduleTime: string;
};

/** The browser-side pre-check: the same rules as collabPostSchema (validations.ts), which stays the source of truth. */
export function validateCollabFormValues(v: CollabFormValues): CollabFormField[] {
  const bad = new Set<CollabFormField>();
  const title = v.title.trim();
  const description = v.description.trim();
  if (title.length < 5 || title.length > 100) bad.add("title");
  if (v.type.trim().length < 2) bad.add("type");
  if (!v.worldwide && v.countries.length === 0) bad.add("countries");
  if (v.visibility === "PRIVATE" && v.inviteeIds.length === 0 && v.circleIds.length === 0) bad.add("inviteeIds");
  const hasDays = v.scheduleDays.length > 0;
  const hasTime = v.scheduleTime !== "";
  if (hasDays && !hasTime) bad.add("scheduleTime");
  if (hasTime && !hasDays) bad.add("scheduleDays");
  if (description.length < 20 || description.length > 2000) bad.add("description");
  return sortByFormOrder(bad);
}

/** What the create form keeps in sessionStorage across a failed-submit redirect so the person does not retype everything. */
export type CollabDraft = {
  title: string;
  description: string;
  type: string;
  worldwide: boolean;
  countries: string[];
  visibility: "PUBLIC" | "PRIVATE";
  inviteeIds: string[];
  circleIds: string[];
  scheduleDays: number[];
  scheduleTime: string;
};

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length <= 100).slice(0, max) : [];
}

/** Parses a stored draft defensively (it is only ever a convenience, so anything odd is dropped or ignored). */
export function parseCollabDraft(json: string | null): CollabDraft | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return {
    title: typeof r.title === "string" ? r.title.slice(0, 100) : "",
    description: typeof r.description === "string" ? r.description.slice(0, 2000) : "",
    type: typeof r.type === "string" ? r.type.slice(0, 60) : "",
    worldwide: r.worldwide === true,
    countries: strings(r.countries, 20),
    visibility: r.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC",
    inviteeIds: strings(r.inviteeIds, 50),
    circleIds: strings(r.circleIds, 5),
    scheduleDays: Array.isArray(r.scheduleDays)
      ? r.scheduleDays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6).slice(0, 7)
      : [],
    scheduleTime: typeof r.scheduleTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.scheduleTime) ? r.scheduleTime : "",
  };
}
