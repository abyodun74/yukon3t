import { initializeApp, cert, getApps, type App } from "firebase-admin/app";

// The one firebase-admin app for this server, shared by FCM (fcm.ts) and
// App Check verification (app-attest.ts). Built from the Firebase project's
// service account; inert (undefined) until all three env vars are set.

export function isFirebaseAdminConfigured(): boolean {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
}

let app: App | undefined;

export function getFirebaseAdminApp(): App | undefined {
  if (app) return app;
  if (!isFirebaseAdminConfigured()) return undefined;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Env vars can't hold a literal newline, so the key is stored with escaped
  // "\n" sequences and unescaped here — the standard Firebase-on-serverless
  // pattern.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  app = getApps()[0] ?? initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return app;
}
