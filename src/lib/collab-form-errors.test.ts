import { describe, expect, it } from "vitest";
import { collabPostSchema } from "@/lib/validations";
import {
  collabFieldsFromIssues,
  collabInvalidPath,
  parseCollabDraft,
  parseCollabFields,
  validateCollabFormValues,
  type CollabFormValues,
} from "@/lib/collab-form-errors";

const valid: CollabFormValues = {
  title: "Language exchange",
  description: "Practising conversational Japanese and English twice a week.",
  type: "Mentorship",
  worldwide: true,
  countries: [],
  visibility: "PUBLIC",
  inviteeIds: [],
  circleIds: [],
  scheduleDays: [],
  scheduleTime: "",
};

describe("collabFieldsFromIssues", () => {
  it("maps real schema failures to field names in form order, once each", () => {
    const result = collabPostSchema.safeParse({
      title: "no",
      description: "short",
      type: "",
      worldwide: false,
      countries: [],
      visibility: "PRIVATE",
      inviteeIds: [],
      circleIds: ["not-a-cuid"],
      scheduleDays: [1],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(collabFieldsFromIssues(result.error.issues)).toEqual([
      "title",
      "type",
      "countries",
      "inviteeIds",
      "scheduleTime",
      "description",
    ]);
  });

  it("ignores unknown and non-string paths", () => {
    expect(collabFieldsFromIssues([{ path: ["nope"] }, { path: [] }, { path: [0] }])).toEqual([]);
  });
});

describe("parseCollabFields", () => {
  it("keeps only allowlisted names, sorted and deduplicated", () => {
    expect(parseCollabFields("description,title,title,<script>,__proto__")).toEqual(["title", "description"]);
  });
  it("handles missing and array values", () => {
    expect(parseCollabFields(undefined)).toEqual([]);
    expect(parseCollabFields("")).toEqual([]);
    expect(parseCollabFields(["type", "title"])).toEqual(["type"]);
  });
});

describe("collabInvalidPath", () => {
  it("adds the field list, or none", () => {
    expect(collabInvalidPath(["description", "title"])).toBe("/collab/new?error=invalid&fields=title,description");
    expect(collabInvalidPath([])).toBe("/collab/new?error=invalid");
  });
});

describe("validateCollabFormValues", () => {
  it("accepts a valid form", () => {
    expect(validateCollabFormValues(valid)).toEqual([]);
  });
  it("flags each rule", () => {
    expect(
      validateCollabFormValues({
        ...valid,
        title: "  abc ",
        description: "x".repeat(19),
        type: "",
        worldwide: false,
        visibility: "PRIVATE",
        scheduleDays: [2],
      }),
    ).toEqual(["title", "type", "countries", "inviteeIds", "scheduleTime", "description"]);
    expect(validateCollabFormValues({ ...valid, scheduleTime: "10:00" })).toEqual(["scheduleDays"]);
  });
  it("agrees with the schema on a passing form", () => {
    expect(
      collabPostSchema.safeParse({ ...valid, scheduleDays: [], scheduleTime: undefined }).success,
    ).toBe(true);
  });
});

describe("parseCollabDraft", () => {
  it("round-trips a draft and normalizes junk", () => {
    const draft = parseCollabDraft(
      JSON.stringify({ title: "Hi", visibility: "PRIVATE", scheduleDays: [1, 9, "x", 3], scheduleTime: "25:00", countries: ["Peru", 4] }),
    );
    expect(draft).toMatchObject({
      title: "Hi",
      description: "",
      visibility: "PRIVATE",
      scheduleDays: [1, 3],
      scheduleTime: "",
      countries: ["Peru"],
    });
  });
  it("returns null for nothing or invalid JSON", () => {
    expect(parseCollabDraft(null)).toBeNull();
    expect(parseCollabDraft("{oops")).toBeNull();
    expect(parseCollabDraft("3")).toBeNull();
  });
});
