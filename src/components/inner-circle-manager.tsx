"use client";

import { useState, useTransition } from "react";
import { UserAvatar } from "@/components/user-link";
import { addToInnerCircle, removeFromInnerCircle } from "@/app/actions/ambient";

type Person = { id: string; name: string | null; username: string | null; avatarUrl: string | null };

const MAX_INNER_CIRCLE_SIZE = 8;

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Something went wrong — try again.",
  rate_limited: "Too many changes at once — wait a moment and try again.",
  not_connected: "You can only add someone you're connected with.",
  limit_reached: `Inner Circle is capped at ${MAX_INNER_CIRCLE_SIZE} people — remove someone first.`,
};

/**
 * Settings UI for InnerCircleMember (see that model's schema doc comment).
 * Picks from accepted Connections only — "a handful of people you actually
 * know," not a second, broader following list.
 */
export function InnerCircleManager({
  initialMembers,
  initialCandidates,
}: {
  initialMembers: Person[];
  initialCandidates: Person[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAdd(person: Person) {
    setError(null);
    startTransition(async () => {
      const result = await addToInnerCircle(person.id);
      if (result.error) {
        setError(ERROR_MESSAGES[result.error] ?? "Something went wrong.");
        return;
      }
      setMembers((prev) => [...prev, person]);
      setCandidates((prev) => prev.filter((c) => c.id !== person.id));
    });
  }

  function handleRemove(person: Person) {
    setError(null);
    startTransition(async () => {
      await removeFromInnerCircle(person.id);
      setMembers((prev) => prev.filter((m) => m.id !== person.id));
      setCandidates((prev) => [...prev, person]);
    });
  }

  return (
    <div>
      <p className="text-xs text-foreground-soft">
        {members.length} of {MAX_INNER_CIRCLE_SIZE} spots used.
      </p>

      {members.length > 0 && (
        <ul className="mt-3 space-y-2">
          {members.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <UserAvatar avatarUrl={person.avatarUrl} name={person.name} size={32} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{person.name ?? "Unnamed"}</p>
                  {person.username && <p className="truncate text-xs text-foreground-soft">@{person.username}</p>}
                </div>
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleRemove(person)}
                className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:border-danger hover:text-danger disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {candidates.length > 0 && members.length < MAX_INNER_CIRCLE_SIZE && (
        <div className="mt-4">
          <p className="text-xs font-medium text-foreground-soft">Add from your connections</p>
          <ul className="mt-2 space-y-2">
            {candidates.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <UserAvatar avatarUrl={person.avatarUrl} name={person.name} size={32} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{person.name ?? "Unnamed"}</p>
                    {person.username && <p className="truncate text-xs text-foreground-soft">@{person.username}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleAdd(person)}
                  className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {members.length === 0 && candidates.length === 0 && (
        <p className="mt-3 text-sm text-foreground-soft">
          Connect with a few people first — Inner Circle only works with real, accepted connections.
        </p>
      )}
    </div>
  );
}
