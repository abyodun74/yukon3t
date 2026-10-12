/**
 * Runs at most `max` of the tasks handed to it at once; the rest wait their
 * turn in the order they arrived. For a page whose independently streamed
 * sections would otherwise all query at the same moment: the Prisma pool
 * holds 5 connections per instance and a query that waits more than 5s for
 * one fails (src/lib/prisma.ts), so queueing here, where a wait costs
 * nothing, is what keeps a slow query from failing the ones behind it.
 */
export function createConcurrencyLimit(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        active -= 1;
      }
    }
  };
}

export type ConcurrencyLimit = ReturnType<typeof createConcurrencyLimit>;
