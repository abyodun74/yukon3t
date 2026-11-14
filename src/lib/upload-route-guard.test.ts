import { describe, expect, it } from "vitest";
import { isSameOriginUploadRequest, UPLOAD_ROUTE_HEADER } from "@/lib/upload-route-guard";

const h = (entries: Record<string, string>) => new Headers(entries);

describe("isSameOriginUploadRequest", () => {
  it("accepts the app's own fetch (guard header, matching origin)", () => {
    expect(isSameOriginUploadRequest(h({ [UPLOAD_ROUTE_HEADER]: "1", origin: "https://yukon3t.com", host: "yukon3t.com" }))).toBe(true);
    expect(
      isSameOriginUploadRequest(
        h({ [UPLOAD_ROUTE_HEADER]: "1", origin: "https://yukon3t.com", host: "internal:3000", "x-forwarded-host": "yukon3t.com" }),
      ),
    ).toBe(true);
  });

  it("accepts a same-origin request without Origin only with the guard header", () => {
    expect(isSameOriginUploadRequest(h({ [UPLOAD_ROUTE_HEADER]: "1", host: "yukon3t.com" }))).toBe(true);
    expect(isSameOriginUploadRequest(h({ host: "yukon3t.com" }))).toBe(false);
  });

  it("refuses a cross-site request, a null origin and a missing guard header", () => {
    expect(isSameOriginUploadRequest(h({ [UPLOAD_ROUTE_HEADER]: "1", origin: "https://evil.example", host: "yukon3t.com" }))).toBe(false);
    expect(isSameOriginUploadRequest(h({ [UPLOAD_ROUTE_HEADER]: "1", origin: "null", host: "yukon3t.com" }))).toBe(false);
    expect(isSameOriginUploadRequest(h({ origin: "https://yukon3t.com", host: "yukon3t.com" }))).toBe(false);
    expect(isSameOriginUploadRequest(h({ [UPLOAD_ROUTE_HEADER]: "2", origin: "https://yukon3t.com", host: "yukon3t.com" }))).toBe(false);
    expect(isSameOriginUploadRequest(h({ [UPLOAD_ROUTE_HEADER]: "1", origin: "not a url", host: "yukon3t.com" }))).toBe(false);
  });

  it("compares against the forwarded host when one is set, like the Server Action check", () => {
    expect(
      isSameOriginUploadRequest(
        h({ [UPLOAD_ROUTE_HEADER]: "1", origin: "https://yukon3t.com", host: "yukon3t.com", "x-forwarded-host": "other.example" }),
      ),
    ).toBe(false);
  });
});
