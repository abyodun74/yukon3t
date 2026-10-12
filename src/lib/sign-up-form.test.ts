import { describe, it, expect } from "vitest";
import { MIN_AGE } from "@/lib/validations";
import { en } from "@/lib/i18n/en";
import {
  SIGN_UP_FIELDS,
  signUpFieldsToShow,
  signUpFormErrorMessage,
  signUpReasonMessage,
  validateSignUp,
  withTakenErrors,
  type SignUpRaw,
} from "@/lib/sign-up-form";

function isoYearsAgo(years: number, extraDays = 0) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() + extraDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const valid: SignUpRaw = {
  username: "Bola_99",
  email: " Bola@Example.com ",
  password: "longenough1",
  birthDate: "1990-05-05",
  verificationMethod: "EMAIL",
  phone: undefined,
};

describe("validateSignUp", () => {
  it("returns the parsed data and no errors for a good submission", () => {
    const r = validateSignUp(valid);
    expect(r.fieldErrors).toEqual({});
    expect(r.formError).toBeNull();
    expect(r.data).toMatchObject({ username: "Bola_99", email: "bola@example.com", verificationMethod: "EMAIL" });
    expect(r.checkable).toEqual({ username: "Bola_99", email: "bola@example.com", phone: null });
  });

  it("reports every failing field at once, not just the first", () => {
    const r = validateSignUp({
      username: "a",
      email: "nope",
      password: "short",
      birthDate: "",
      verificationMethod: "PHONE",
      phone: "",
    });
    expect(r.data).toBeNull();
    expect(r.fieldErrors).toEqual({
      username: "username_length",
      email: "email_invalid",
      password: "password_too_short",
      birthDate: "birth_date_required",
      phone: "phone_required",
    });
    expect(r.checkable).toEqual({ username: null, email: null, phone: null });
  });

  it("names the username rule that failed", () => {
    const reason = (username: unknown) => validateSignUp({ ...valid, username }).fieldErrors.username;
    expect(reason("")).toBe("username_required");
    expect(reason("   ")).toBe("username_required");
    expect(reason(null)).toBe("username_required");
    expect(reason("ab")).toBe("username_length");
    expect(reason("a".repeat(21))).toBe("username_length");
    expect(reason("bad-dash")).toBe("username_characters");
    expect(reason("has space")).toBe("username_characters");
    expect(reason("way-too-long-and-with-dashes")).toBe("username_characters");
    expect(reason("admin")).toBe("username_reserved");
    expect(reason("YuKon3t")).toBe("username_reserved");
    expect(reason("Bola_99")).toBeUndefined();
  });

  it("tells a missing email from a malformed one", () => {
    expect(validateSignUp({ ...valid, email: "" }).fieldErrors.email).toBe("email_required");
    expect(validateSignUp({ ...valid, email: null }).fieldErrors.email).toBe("email_required");
    expect(validateSignUp({ ...valid, email: "bola@" }).fieldErrors.email).toBe("email_invalid");
  });

  it("names the password rule that failed", () => {
    expect(validateSignUp({ ...valid, password: "" }).fieldErrors.password).toBe("password_required");
    expect(validateSignUp({ ...valid, password: "1234567" }).fieldErrors.password).toBe("password_too_short");
    expect(validateSignUp({ ...valid, password: "x".repeat(73) }).fieldErrors.password).toBe("password_too_long");
    expect(validateSignUp({ ...valid, password: "x".repeat(72) }).fieldErrors.password).toBeUndefined();
  });

  it("tells a missing or impossible birth date from being under MIN_AGE", () => {
    const reason = (birthDate: unknown) => validateSignUp({ ...valid, birthDate }).fieldErrors.birthDate;
    expect(reason("")).toBe("birth_date_required");
    expect(reason(null)).toBe("birth_date_required");
    expect(reason("not-a-date")).toBe("birth_date_required");
    expect(reason(isoYearsAgo(MIN_AGE - 1))).toBe("birth_date_underage");
    expect(reason(isoYearsAgo(MIN_AGE, 2))).toBe("birth_date_underage");
    expect(reason(isoYearsAgo(MIN_AGE, -2))).toBeUndefined();
  });

  it("checks the phone number only when verifying by phone", () => {
    const byPhone = (phone: unknown) => validateSignUp({ ...valid, verificationMethod: "PHONE", phone });
    expect(byPhone(undefined).fieldErrors.phone).toBe("phone_required");
    expect(byPhone("").fieldErrors.phone).toBe("phone_required");
    expect(byPhone("4155551234").fieldErrors.phone).toBe("phone_invalid");
    // E.164-shaped, but not a number any country has
    expect(byPhone("+11234567890").fieldErrors.phone).toBe("phone_invalid");
    const ok = byPhone(" +14155551234 ");
    expect(ok.fieldErrors).toEqual({});
    expect(ok.data?.phone).toBe("+14155551234");
    expect(ok.checkable.phone).toBe("+14155551234");
    // a stray phone value is ignored for email verification
    expect(validateSignUp({ ...valid, phone: "garbage" }).fieldErrors).toEqual({});
  });

  it("still reports a bad phone number when another field fails too", () => {
    const r = validateSignUp({ ...valid, username: "ab", verificationMethod: "PHONE", phone: "+11234567890" });
    expect(r.fieldErrors).toEqual({ username: "username_length", phone: "phone_invalid" });
  });

  it("keeps the fields that passed available for the taken checks", () => {
    const r = validateSignUp({ ...valid, password: "short", verificationMethod: "PHONE", phone: "+14155551234" });
    expect(r.data).toBeNull();
    expect(r.fieldErrors).toEqual({ password: "password_too_short" });
    expect(r.checkable).toEqual({ username: "Bola_99", email: "bola@example.com", phone: "+14155551234" });
  });

  it("treats an unknown verification method as a form-level failure", () => {
    const r = validateSignUp({ ...valid, verificationMethod: "FAX" });
    expect(r.data).toBeNull();
    expect(r.fieldErrors).toEqual({});
    expect(r.formError).toBe("invalid");
  });
});

describe("withTakenErrors", () => {
  it("adds a taken reason for each field found in use and leaves the rest", () => {
    expect(withTakenErrors({ password: "password_too_short" }, { username: true, email: false, phone: true })).toEqual({
      password: "password_too_short",
      username: "username_taken",
      phone: "phone_taken",
    });
    expect(withTakenErrors({}, { email: true })).toEqual({ email: "email_taken" });
    expect(withTakenErrors({}, {})).toEqual({});
  });
});

describe("signUpFieldsToShow", () => {
  it("shows every field when no field failed", () => {
    expect(signUpFieldsToShow({}, false)).toEqual([...SIGN_UP_FIELDS]);
  });

  it("shows only the failing fields, in form order", () => {
    expect(signUpFieldsToShow({ phone: "phone_taken", username: "username_taken" }, false)).toEqual(["username", "phone"]);
    expect(signUpFieldsToShow({ birthDate: "birth_date_underage" }, false)).toEqual(["birthDate"]);
  });

  it("shows every field again once the person asks to edit all details", () => {
    expect(signUpFieldsToShow({ email: "email_taken" }, true)).toEqual([...SIGN_UP_FIELDS]);
  });
});

describe("messages", () => {
  const { reasons, formErrors } = en.signUp.form;

  it("state the actual limits and MIN_AGE", () => {
    expect(signUpReasonMessage("username_length", reasons)).toBe("Usernames are 3–20 characters long.");
    expect(signUpReasonMessage("password_too_short", reasons)).toBe("Passwords need at least 8 characters.");
    expect(signUpReasonMessage("password_too_long", reasons)).toBe("Passwords can be at most 72 characters.");
    expect(signUpReasonMessage("birth_date_underage", reasons)).toContain(`at least ${MIN_AGE} years old`);
    expect(signUpFormErrorMessage("captcha", formErrors)).toContain("security check");
  });
});
