// Server Actions are identified by a content hash baked into the JS bundle
// at build time. A tab that's been open since before a deploy still holds
// the old hash — the next server action it calls fails with this exact
// message (confirmed live via Netlify function logs: this was the entire
// cause of a burst of "couldn't reach the server" reports during a run of
// back-to-back deploys). Retrying is pointless here — the old action id
// will never be found — so this is checked separately from ordinary
// network flakiness, which retrying does help with.
//
// "Failed to find Server Action" is the server's wording; what the client
// actually throws in this Next version is UnrecognizedActionError, 'Server
// Action "<id>" was not found on the server.' Both are matched.
const MARKERS = ["Failed to find Server Action", "was not found on the server"];

export function isStaleDeploymentError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "UnrecognizedActionError" || MARKERS.some((m) => err.message.includes(m)))
  );
}

export const STALE_DEPLOYMENT_MESSAGE =
  "A new version of the app is available — refresh the page to continue.";
