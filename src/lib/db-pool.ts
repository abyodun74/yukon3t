/**
 * Per-instance size of the pg pool behind Prisma (src/lib/prisma.ts), from `DATABASE_POOL_MAX`.
 *
 * Why 10 by default (was 5):
 * - One page render already wants more than 5 connections at once: attachViewerState fires 7 queries in parallel,
 *   the pages' Promise.all groups run several loaders side by side, and Prisma runs sibling includes concurrently
 *   (up to 5 in flight for one feed query). With 5, those queued inside the instance's own pool.
 * - Production DATABASE_URL is Neon's pooled endpoint (`-pooler`, PgBouncer in transaction mode): it accepts up to
 *   10,000 client connections and multiplexes them onto at most default_pool_size = 90% of max_connections real
 *   Postgres connections (93 at 0.25 CU, 188 at 0.5 CU, 377 at 1 CU). A client connection that has nothing to run
 *   costs no Postgres backend, so the client-side limit is what matters: 10 per instance leaves room for ~1,000
 *   concurrent function instances (Netlify's Lambda-style instances serve one request each; a Vercel Fluid instance
 *   serves several requests over the same pool, which is where the headroom helps most).
 * - The direct (unpooled) endpoint has only max_connections (104 at 0.25 CU, 7 reserved); it is used by
 *   `prisma migrate deploy` (DIRECT_DATABASE_URL), never by this pool. Pointing DATABASE_URL at it would make every
 *   instance's pool count against those directly, at any pool size; set DATABASE_POOL_MAX low there.
 *
 * An empty, non-numeric, zero or negative value falls back to the default (an empty `DATABASE_POOL_MAX=""`, as in
 * .env.example, used to become `Number("") = 0`).
 */
export const DEFAULT_DATABASE_POOL_MAX = 10;
const DATABASE_POOL_MAX_CEILING = 50;

export function resolveDatabasePoolMax(raw: string | undefined): number {
  const value = Number.parseInt(raw?.trim() ?? "", 10);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_DATABASE_POOL_MAX;
  return Math.min(value, DATABASE_POOL_MAX_CEILING);
}
