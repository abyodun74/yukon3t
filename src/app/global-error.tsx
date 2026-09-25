"use client";

import { useEffect } from "react";
import { captureError } from "@/lib/error-tracking";
import "./globals.css";

/**
 * The one error boundary error.tsx CANNOT cover: error.tsx only catches a
 * crash inside a route segment, never the root layout itself (its own
 * providers, Nav, the aurora background, etc.) — a throw there previously
 * fell straight through to Next.js's own generic, unbranded error screen
 * ("Application error: a client-side exception has occurred"), with no
 * report to Sentry and no way back into the app for the user beyond a raw
 * browser reload. This file is what Next.js renders instead whenever THAT
 * specific case happens (see https://nextjs.org/docs/app/api-reference/file-conventions/error#global-error).
 *
 * Deliberately minimal and self-contained — it has to render its own
 * complete <html>/<body> (it fully replaces the root layout when active, not
 * nest inside it, since the root layout is exactly what just failed), so it
 * can't lean on anything layout.tsx normally provides (session-derived
 * theme, next/font, Nav, providers). Reuses globals.css directly (a plain
 * stylesheet import, not tied to any of the JS that broke) so the design
 * tokens/colors still look like this app, not a bare unstyled page — but
 * intentionally skips the font-loading/cookie-reading machinery layout.tsx
 * does, since depending on more of that same machinery here is exactly the
 * kind of thing that could make this boundary itself fail to render.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, { digest: error.digest, boundary: "global-error" });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "24px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "var(--color-background, #14181a)",
          color: "var(--color-foreground, #e9ece7)",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>YuKon3t hit a snag</h1>
        <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", opacity: 0.7, maxWidth: "24rem" }}>
          Something broke loading the app itself. Try again — if it keeps happening, reopening the
          app usually clears it.
        </p>
        <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              borderRadius: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              background: "var(--color-accent, #e08a3e)",
              color: "var(--color-accent-ink, #14181a)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {/* Plain anchor, not next/link — same reasoning as error.tsx's own
              "Go home" link: the router itself can't be trusted here, this
              needs a real full navigation. */}
          <a
            href="/home"
            style={{
              borderRadius: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              border: "1px solid var(--color-line, #313834)",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            Go home
          </a>
        </div>
      </body>
    </html>
  );
}
