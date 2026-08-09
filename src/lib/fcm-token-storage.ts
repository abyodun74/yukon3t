// Shared between fcm-token-bridge.tsx (writes it once, on native-app launch)
// and nav.tsx's sign-out handler (reads it to unregister this device) — a
// plain constant so the key string can't drift between the two call sites.
export const FCM_TOKEN_STORAGE_KEY = "yukon3t:fcmToken";
