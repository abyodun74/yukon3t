"use client";

import { useState, useTransition } from "react";
import { generateAmbientWidgetToken, revokeAmbientWidgetToken } from "@/app/actions/ambient";
import { useSettingsText } from "@/components/settings-text";
import { useUiText } from "@/components/ui-text";
import { formatTimeAgo } from "@/lib/format-date";
import { format } from "@/lib/i18n/locales";

type Status = { active: true; createdAt: Date; lastUsedAt: Date | null } | { active: false };

/**
 * Lets a user generate the bearer token GET /api/ambient/feed expects (see
 * that route and AmbientWidgetToken's schema doc comment) — there's no
 * native widget to actually put it into yet, so this is explicitly framed
 * as "for when one exists," not a working feature today.
 */
export function AmbientWidgetTokenPanel({ initialStatus }: { initialStatus: Status }) {
  const [status, setStatus] = useState(initialStatus);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const { locale, t: settings } = useSettingsText();
  const t = settings.ambient.token;
  const justNow = useUiText().t.time.justNow;

  function handleGenerate() {
    setRevealedToken(null);
    startTransition(async () => {
      const result = await generateAmbientWidgetToken();
      if (result.error || !result.token) return;
      setRevealedToken(result.token);
      setStatus({ active: true, createdAt: new Date(), lastUsedAt: null });
    });
  }

  function handleRevoke() {
    setRevealedToken(null);
    startTransition(async () => {
      await revokeAmbientWidgetToken();
      setStatus({ active: false });
    });
  }

  async function handleCopy() {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the
      // token is still shown on screen either way, nothing more to do.
    }
  }

  return (
    <div className="rounded-xl border border-line p-4">
      <h3 className="text-sm font-semibold">{t.heading}</h3>
      <p className="mt-1 text-xs text-foreground-soft">{t.intro}</p>

      {status.active && (
        <p className="mt-2 text-xs text-foreground-soft">
          {format(t.activeSince, { when: formatTimeAgo(status.createdAt, locale, justNow) })}
          {status.lastUsedAt && (
            <> · {format(t.lastUsed, { when: formatTimeAgo(status.lastUsedAt, locale, justNow) })}</>
          )}
        </p>
      )}

      {revealedToken && (
        <div className="mt-3 rounded-lg bg-background p-3">
          <p className="text-xs text-foreground-soft">{t.copyNow}</p>
          <code dir="ltr" className="mt-2 block break-all text-start text-xs">{revealedToken}</code>
          <button
            type="button"
            onClick={handleCopy}
            className="mt-2 rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:border-accent hover:text-accent"
          >
            {copied ? t.copied : t.copy}
          </button>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={handleGenerate}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          {status.active ? t.generateNew : t.generate}
        </button>
        {status.active && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleRevoke}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-danger hover:text-danger disabled:opacity-50"
          >
            {t.revoke}
          </button>
        )}
      </div>
    </div>
  );
}
