"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createChannel } from "@/app/actions/channels";
import { Sheet } from "@/components/sheet";
import { useCirclesText } from "@/components/circles-text";
import { byCode } from "@/lib/i18n/locales";

export function CreateChannelModal({ circleId }: { circleId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const t = useCirclesText().t.channels;

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createChannel(circleId, formData);
      if (result.error) {
        setError(byCode(t.errors, result.error));
        return;
      }
      setOpen(false);
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-foreground-soft hover:bg-line hover:text-accent"
      >
        <Plus size={14} /> {t.add}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t.newTitle}>
        <form ref={formRef} action={handleSubmit} className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-foreground-soft">{t.name}</label>
            <input
              aria-label={t.name}
              name="name"
              dir="auto"
              required
              minLength={2}
              maxLength={50}
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">{t.type}</label>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="type" value="TEXT" defaultChecked /> {t.typeText}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="type" value="VOICE" /> {t.typeVoice}
              </label>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">
              {t.topicLong}
            </label>
            <input
              aria-label={t.topicLong}
              name="topic"
              dir="auto"
              maxLength={200}
              placeholder={t.topicPlaceholder}
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">{t.privacy}</label>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="visibility" value="PUBLIC" defaultChecked /> {t.public}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="visibility" value="PRIVATE" /> {t.privateOption}
              </label>
            </div>
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {isPending ? t.creating : t.create}
          </button>
        </form>
      </Sheet>
    </>
  );
}
