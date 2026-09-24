// Mirrors fcm-token-storage.ts's own single-constant shape — see nav.tsx's
// handleSignOut for why this needs to be cached client-side at all: the
// native side hands over a VoIP token via an event/pending-pull (see
// capacitor-bridge.tsx), not something re-queryable on demand later, so the
// value has to be remembered somewhere JS can read it back from at sign-out
// time to actually unregister it.
export const VOIP_TOKEN_STORAGE_KEY = "yukon3t:voipToken";
