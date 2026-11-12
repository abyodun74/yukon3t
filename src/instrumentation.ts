export async function register() {
  if (process.env.SENTRY_DSN) {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("../sentry.server.config");
    }
    if (process.env.NEXT_RUNTIME === "edge") {
      await import("../sentry.edge.config");
    }
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Refuse to start a production server with a missing, placeholder or too-short AUTH_SECRET (a no-op in dev, tests
    // and during `next build`; see assertSessionSecretUsable in src/lib/auth-cookie.ts).
    const { assertSessionSecretUsable } = await import("@/lib/auth-cookie");
    assertSessionSecretUsable();
  }
}
