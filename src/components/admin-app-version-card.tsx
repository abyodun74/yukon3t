"use client";

import { useRef, useState, useTransition } from "react";
import { previewAppUpdateNotice, saveAppVersionPolicy, sendAppUpdateNotice } from "@/app/actions/app-version";
import { MESSAGE_MAX_LENGTH, type AppPlatform } from "@/lib/app-version";

export type AdminAppVersionPolicy = {
  enabled: boolean;
  latestBuild: number | null;
  minBuild: number | null;
  latestVersion: string | null;
  message: string | null;
  storeUrl: string | null;
  appStoreId: string | null;
  iosAutoDetect: boolean;
  lastNotifiedAt: string | null;
};

const PLATFORM_NAMES: Record<AppPlatform, string> = { android: "Android", ios: "iOS" };

const SAVE_ERRORS: Record<string, string> = {
  invalid: "Something in the form isn't valid.",
  invalid_latest_build: "Latest build must be a whole number.",
  invalid_min_build: "Minimum build must be a whole number.",
  min_build_needs_latest: "Set the latest build before a minimum build.",
  min_build_above_latest: "Minimum build can't be above the latest build — that would block the current release.",
  invalid_version: "Latest version must look like 1.26 or 2.0.1.",
  invalid_store_url: "Store URL must be an https link to play.google.com or apps.apple.com.",
  invalid_app_store_id: "App Store id is the numeric id from the App Store link (id123456789 → 123456789).",
  confirm_force: "The confirmation didn't match the minimum build — nothing was saved.",
};

const NOTICE_ERRORS: Record<string, string> = {
  invalid: "Couldn't send — invalid request.",
  no_latest_build: "Set and save a latest build first.",
  no_recipients: "No devices are on an older build.",
  cooldown: "A notice was already sent for this platform in the last hour.",
  fcm_not_configured: "Push isn't configured (Firebase env vars missing).",
};

const inputClass =
  "mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";

/** One platform's update policy and its "Notify users on older builds" push. English only, like the rest of admin. */
export function AdminAppVersionCard({
  platform,
  policy,
}: {
  platform: AppPlatform;
  policy: AdminAppVersionPolicy | null;
}) {
  const name = PLATFORM_NAMES[platform];
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Set while a new or changed minBuild waits for its typed confirmation.
  const [pendingMinBuild, setPendingMinBuild] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  function submit(confirmMinBuild: string) {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    fd.set("platform", platform);
    fd.set("confirmMinBuild", confirmMinBuild);
    setSaveError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await saveAppVersionPolicy(fd);
        if (result.error) {
          setSaveError(SAVE_ERRORS[result.error] ?? SAVE_ERRORS.invalid);
          return;
        }
        setPendingMinBuild(null);
        setConfirmText("");
        setSaved(true);
      } catch {
        setSaveError("Couldn't save — try again.");
      }
    });
  }

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const minBuild = String(new FormData(e.currentTarget).get("minBuild") ?? "").trim();
    // Setting or changing a force update always goes through the confirmation step first.
    if (minBuild && minBuild !== String(policy?.minBuild ?? "")) {
      setPendingMinBuild(minBuild);
      setConfirmText("");
      return;
    }
    submit("");
  }

  return (
    <div className="mt-4 rounded-xl border border-line p-5">
      <h3 className="text-sm font-semibold">{name}</h3>
      <form ref={formRef} onSubmit={onSave} className="mt-3 space-y-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={policy?.enabled ?? false} className="mt-1" />
          <span>
            Enabled — master switch. While off, no {name} user is prompted at all (neither the banner nor a force
            update).
          </span>
        </label>

        <label className="block text-sm">
          Latest build
          <input
            name="latestBuild"
            inputMode="numeric"
            defaultValue={policy?.latestBuild ?? ""}
            placeholder={platform === "android" ? "versionCode, e.g. 29" : "CFBundleVersion, e.g. 29"}
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-foreground-soft">
            Builds below this see a dismissible &ldquo;Update available&rdquo; banner. Set it to the current store
            build once its rollout reaches 100%.
          </span>
        </label>

        <label className="block text-sm">
          Minimum build (force update)
          <input name="minBuild" inputMode="numeric" defaultValue={policy?.minBuild ?? ""} className={inputClass} />
          <span className="mt-1 block rounded-lg bg-danger/10 px-2 py-1 text-xs text-danger">
            Force update — blocks older builds; leave empty to disable. Builds below this get a full-screen
            &ldquo;Update required&rdquo; screen until they update.
          </span>
        </label>

        <label className="block text-sm">
          Latest version {platform === "ios" ? "(marketing version, e.g. 1.26)" : "(optional, e.g. 1.26)"}
          <input name="latestVersion" defaultValue={policy?.latestVersion ?? ""} className={inputClass} />
        </label>

        {platform === "ios" && (
          <>
            <label className="block text-sm">
              App Store id
              <input
                name="appStoreId"
                inputMode="numeric"
                defaultValue={policy?.appStoreId ?? ""}
                placeholder="numeric id from apps.apple.com/app/id…"
                className={inputClass}
              />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="iosAutoDetect"
                defaultChecked={policy?.iosAutoDetect ?? true}
                className="mt-1"
              />
              <span>
                Auto-detect: also show the banner when the App Store&apos;s live version is newer than the
                app&apos;s (checked hourly). Never forces.
              </span>
            </label>
          </>
        )}
        {platform === "android" && <input type="hidden" name="iosAutoDetect" value="on" />}

        <label className="block text-sm">
          Store URL override (optional)
          <input name="storeUrl" defaultValue={policy?.storeUrl ?? ""} placeholder="https://…" className={inputClass} />
        </label>

        <label className="block text-sm">
          Message (optional)
          <textarea
            name="message"
            rows={2}
            maxLength={MESSAGE_MAX_LENGTH}
            defaultValue={policy?.message ?? ""}
            className={`${inputClass} resize-none`}
          />
          <span className="mt-1 block text-xs text-foreground-soft">
            Shown to English readers only; other languages see the standard translated text.
          </span>
        </label>

        {pendingMinBuild !== null ? (
          <div role="alertdialog" aria-label="Confirm force update" className="rounded-lg border border-danger p-3">
            <p className="text-sm text-danger">
              Every {name} app below build <b>{pendingMinBuild}</b> will be blocked by a full-screen
              &ldquo;Update required&rdquo; screen until it updates. Type <b>{pendingMinBuild}</b> to confirm.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              aria-label={`Type ${pendingMinBuild} to confirm`}
              inputMode="numeric"
              className={inputClass}
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={isPending || confirmText.trim() !== pendingMinBuild}
                onClick={() => submit(confirmText.trim())}
                className="rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
              >
                Save and force update
              </button>
              <button
                type="button"
                onClick={() => setPendingMinBuild(null)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            {isPending ? "Saving…" : `Save ${name} policy`}
          </button>
        )}
        {saveError && <p role="alert" className="text-xs text-danger">{saveError}</p>}
        {saved && <p role="status" className="text-xs text-success">Saved.</p>}
      </form>

      <UpdateNotice platform={platform} name={name} />
    </div>
  );
}

function UpdateNotice({ platform, name }: { platform: AppPlatform; name: string }) {
  const [includeUnknownBuild, setIncludeUnknownBuild] = useState(false);
  const [preview, setPreview] = useState<{ count: number; latestBuild: number } | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function ask() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await previewAppUpdateNotice({ platform, includeUnknownBuild });
        if (result.error) {
          setMessage({ tone: "error", text: NOTICE_ERRORS[result.error] ?? NOTICE_ERRORS.invalid });
          return;
        }
        if (!result.fcmConfigured) {
          setMessage({ tone: "error", text: NOTICE_ERRORS.fcm_not_configured });
          return;
        }
        if (result.nextAllowedAt) {
          setMessage({
            tone: "error",
            text: `${NOTICE_ERRORS.cooldown} Next allowed at ${new Date(result.nextAllowedAt).toLocaleTimeString()}.`,
          });
          return;
        }
        if (result.count === 0) {
          setMessage({ tone: "error", text: NOTICE_ERRORS.no_recipients });
          return;
        }
        setPreview({ count: result.count, latestBuild: result.latestBuild });
      } catch {
        setMessage({ tone: "error", text: "Couldn't count recipients — try again." });
      }
    });
  }

  function send() {
    startTransition(async () => {
      try {
        const result = await sendAppUpdateNotice({ platform, includeUnknownBuild });
        setPreview(null);
        setMessage(
          result.error
            ? { tone: "error", text: NOTICE_ERRORS[result.error] ?? NOTICE_ERRORS.invalid }
            : { tone: "ok", text: `Sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.` },
        );
      } catch {
        setPreview(null);
        setMessage({ tone: "error", text: "Couldn't send — try again." });
      }
    });
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-sm font-medium">Notify users on older builds</p>
      <p className="mt-1 text-xs text-foreground-soft">
        Pushes &ldquo;Update available&rdquo; (in each person&apos;s language) to {name} devices below the saved latest
        build. Never sent automatically; at most once an hour.
      </p>
      <label className="mt-2 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={includeUnknownBuild}
          onChange={(e) => {
            setIncludeUnknownBuild(e.target.checked);
            setPreview(null);
          }}
        />
        Also include {name} devices whose build is unknown
      </label>
      {preview ? (
        <div role="alertdialog" aria-label="Confirm update notice" className="mt-3 rounded-lg border border-line p-3">
          <p className="text-sm">
            Send an &ldquo;Update available&rdquo; push to <b>{preview.count}</b> {name} device
            {preview.count === 1 ? "" : "s"} on builds below {preview.latestBuild}
            {includeUnknownBuild ? " (plus unknown builds)" : ""}?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={send}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
            >
              {isPending ? "Sending…" : "Send push"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setPreview(null)}
              className="rounded-lg border border-line px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={isPending}
          onClick={ask}
          className="mt-3 rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
        >
          Notify users on older builds
        </button>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-2 text-xs ${message.tone === "error" ? "text-danger" : "text-success"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
