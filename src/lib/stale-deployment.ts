// Server Actions are identified by a content hash baked into the JS bundle
// at build time. A tab that's been open since before a deploy still holds
// the old hash — the next server action it calls fails (confirmed live via
// Netlify function logs: this was the entire cause of a burst of "couldn't
// reach the server" reports during a run of back-to-back deploys). Retrying
// is pointless here — the old action id will never be found — so this is
// checked separately from ordinary network flakiness, which retrying does
// help with. The matching itself lives in stale-build.ts, shared with the
// stale-build reload.
export { looksLikeStaleServerActionError as isStaleDeploymentError } from "@/lib/stale-build";

export const STALE_DEPLOYMENT_MESSAGE =
  "A new version of the app is available — refresh the page to continue.";
