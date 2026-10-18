"use client";

import { Fragment, useEffect, useState } from "react";
import { CollabCountriesField } from "@/components/collab-countries-field";
import { CollabFieldError, CollabFormErrorsProvider, collabInvalidProps } from "@/components/collab-form-errors";
import { CollabScheduleField } from "@/components/collab-schedule-field";
import { CollabSubmitButton } from "@/components/collab-submit-button";
import { useCollabText } from "@/components/collab-text";
import { CollabVisibilityField } from "@/components/collab-visibility-field";
import { MultiSelect } from "@/components/multi-select";
import {
  COLLAB_FORM_FIELDS,
  parseCollabDraft,
  validateCollabFormValues,
  type CollabDraft,
  type CollabFormField,
} from "@/lib/collab-form-errors";
import { byCode, format } from "@/lib/i18n/locales";

const DRAFT_KEY = "yukon3t.collab-new-draft";

/** Inputs to try, in order, when taking the person to a failed field; the wrapper div is the last resort (it can only be scrolled to). */
const FOCUS_IDS: Record<CollabFormField, string[]> = {
  title: ["collab-title"],
  type: ["collab-type"],
  countries: ["collab-countries", "collab-worldwide"],
  inviteeIds: ["collab-invitees", "collab-circles", "collab-visibility-private"],
  scheduleDays: ["collab-schedule-days"],
  scheduleTime: ["collab-schedule-time"],
  description: ["collab-description"],
};

/** Editing one of these native inputs clears the matching field's flag until the next submit. */
const FIELD_OF_INPUT: Record<string, CollabFormField> = {
  title: "title",
  description: "description",
  worldwide: "countries",
  visibility: "inviteeIds",
  scheduleDays: "scheduleDays",
  scheduleTime: "scheduleTime",
};

function readDraft(form: HTMLFormElement): CollabDraft {
  const data = new FormData(form);
  const text = (name: string) => (typeof data.get(name) === "string" ? (data.get(name) as string) : "");
  const list = (name: string) => data.getAll(name).filter((v): v is string => typeof v === "string");
  return {
    title: text("title"),
    description: text("description"),
    type: text("type"),
    worldwide: data.get("worldwide") === "on",
    countries: list("countries"),
    visibility: text("visibility") === "PRIVATE" ? "PRIVATE" : "PUBLIC",
    inviteeIds: list("inviteeIds"),
    circleIds: list("circleIds"),
    scheduleDays: list("scheduleDays").map(Number),
    scheduleTime: text("scheduleTime"),
  };
}

/**
 * The create form for /collab/new. A failed submit is shown three ways: a banner naming the fields, a message under
 * each one (aria-invalid + error border) and focus on the first. The list comes from the server (`?fields=` on the
 * error redirect, so the server stays the source of truth) or from the same rules run here before submitting. Fields
 * are native uncontrolled inputs, so what was typed is parked in sessionStorage on submit and put back if the server
 * sends the person back with an error.
 */
export function CollabCreateForm({
  action,
  errorCode,
  initialFields,
  typeOptions,
  inviteeCandidates,
  circleCandidates,
}: {
  action: (formData: FormData) => void | Promise<void>;
  errorCode: string | null;
  initialFields: CollabFormField[];
  typeOptions: { value: string; label: string }[];
  inviteeCandidates: { value: string; label: string }[];
  circleCandidates: { value: string; label: string }[];
}) {
  const { locale, t: collab } = useCollabText();
  const t = collab.form;
  const [invalid, setInvalid] = useState<CollabFormField[]>(initialFields);
  const [draft, setDraft] = useState<CollabDraft | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ field: CollabFormField; n: number } | null>(
    initialFields.length > 0 ? { field: initialFields[0], n: 0 } : null,
  );

  // Put back what was typed before the server sent the person back; a visit without an error discards it.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(DRAFT_KEY);
      window.sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // Storage blocked: the form just starts empty.
    }
    const restored = errorCode ? parseCollabDraft(stored) : null;
    if (restored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage only exists after mount; remounting the fields is how the defaults get applied
      setDraft(restored);
      setDraftVersion(1);
    }
  }, [errorCode]);

  // After a failed submit: scroll to the first failing input and focus it. The effect runs after the flags render,
  // so aria-invalid and the message are already in place when a screen reader lands on it.
  useEffect(() => {
    if (!focusRequest) return;
    const ids = FOCUS_IDS[focusRequest.field];
    const target =
      ids.map((id) => document.getElementById(id)).find((el) => el !== null) ??
      document.getElementById(`collab-field-${focusRequest.field}`);
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  }, [focusRequest, draftVersion]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const values = readDraft(e.currentTarget);
    const bad = validateCollabFormValues(values);
    if (bad.length > 0) {
      // Stay on the page; the server action never runs, so nothing is double-submitted.
      e.preventDefault();
      setInvalid(bad);
      setFocusRequest((prev) => ({ field: bad[0], n: (prev?.n ?? 0) + 1 }));
      return;
    }
    setInvalid([]);
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(values));
    } catch {
      // Storage blocked: an error redirect will come back with an empty form.
    }
  }

  function onFieldChange(e: React.FormEvent<HTMLFormElement>) {
    const name = (e.target as HTMLInputElement).name;
    const field = Object.hasOwn(FIELD_OF_INPUT, name) ? FIELD_OF_INPUT[name] : undefined;
    if (field && invalid.includes(field)) setInvalid((prev) => prev.filter((f) => f !== field));
  }

  const flagged = new Set(invalid);
  const names = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
    COLLAB_FORM_FIELDS.filter((f) => flagged.has(f)).map((f) => t.fieldLabels[f]),
  );
  // A server "invalid" that named fields is fully described by the field list; once those are fixed there is nothing to say.
  const bannerText =
    invalid.length > 0
      ? format(t.fixFields, { fields: names })
      : errorCode && !(errorCode === "invalid" && initialFields.length > 0)
        ? byCode(t.errors, errorCode)
        : null;

  const inputClass = (field: CollabFormField) =>
    `mt-1 w-full rounded-lg border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent ${
      flagged.has(field) ? "border-danger" : "border-line"
    }`;

  return (
    <CollabFormErrorsProvider value={flagged}>
      {bannerText && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {bannerText}
        </p>
      )}

      {/* noValidate: the checks above replace the browser's bubbles so every failure looks and reads the same. */}
      <form
        action={action}
        noValidate
        onSubmit={onSubmit}
        onChange={onFieldChange}
        className="mt-6 space-y-4"
      >
        <Fragment key={draftVersion}>
          <div id="collab-field-title">
            <label htmlFor="collab-title" className="block text-sm font-medium">
              {t.title}
            </label>
            <input
              id="collab-title"
              name="title"
              dir="auto"
              maxLength={100}
              defaultValue={draft?.title}
              {...collabInvalidProps(flagged.has("title"), "title")}
              className={inputClass("title")}
            />
            <CollabFieldError field="title" />
          </div>
          <div id="collab-field-type">
            <label htmlFor="collab-type" className="block text-sm font-medium">
              {t.type}
            </label>
            <p className="mt-0.5 text-xs text-foreground-soft">{t.typeHint}</p>
            <div className="mt-1">
              <MultiSelect
                name="type"
                id="collab-type"
                options={typeOptions}
                defaultValues={draft?.type ? [draft.type] : undefined}
                placeholder={t.typePlaceholder}
                max={1}
                labels={collab.controls.multiSelect}
                invalid={flagged.has("type")}
                describedBy={flagged.has("type") ? "collab-error-type" : undefined}
              />
            </div>
            <CollabFieldError field="type" />
          </div>
          <CollabCountriesField defaultWorldwide={draft?.worldwide} defaultCountries={draft?.countries} />
          <CollabVisibilityField
            candidates={inviteeCandidates}
            circleCandidates={circleCandidates}
            defaultVisibility={draft?.visibility}
            defaultInviteeIds={draft?.inviteeIds}
            defaultCircleIds={draft?.circleIds}
          />
          <CollabScheduleField
            defaultDays={draft?.scheduleDays}
            defaultTime={draft?.scheduleTime || null}
            defaultEnabled={draft ? draft.scheduleDays.length > 0 || draft.scheduleTime !== "" : undefined}
          />
          <div id="collab-field-description">
            <label htmlFor="collab-description" className="block text-sm font-medium">
              {t.description}
            </label>
            <p className="mt-0.5 text-xs text-foreground-soft">{t.descriptionHint}</p>
            <textarea
              id="collab-description"
              name="description"
              dir="auto"
              maxLength={2000}
              rows={5}
              placeholder={t.descriptionPlaceholder}
              defaultValue={draft?.description}
              {...collabInvalidProps(flagged.has("description"), "description")}
              className={inputClass("description")}
            />
            <CollabFieldError field="description" />
          </div>
        </Fragment>
        <CollabSubmitButton label={t.submit} pendingLabel={t.submitting} />
      </form>
    </CollabFormErrorsProvider>
  );
}
