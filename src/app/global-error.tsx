"use client";

import { useEffect, useSyncExternalStore } from "react";
import { captureError } from "@/lib/error-tracking";
import { useStaleBuildRecovery } from "@/lib/stale-build-client";
import { LOCALE_COOKIE, localeDirection, resolveLocale, type Locale } from "@/lib/i18n/locales";
import "./globals.css";

// This screen's own wording, in every language: what normally supplies it (the root layout's providers) is part of
// what just failed. Four short strings, so they are simply all here.
const TEXT: Record<Locale, { title: string; body: string; retry: string; home: string }> = {
  en: {
    title: "YuKon3t hit a snag",
    body: "Something broke loading the app itself. Try again — if it keeps happening, reopening the app usually clears it.",
    retry: "Try again",
    home: "Go home",
  },
  es: {
    title: "YuKon3t tuvo un problema",
    body: "Algo falló al cargar la aplicación. Inténtalo de nuevo; si sigue pasando, cerrar la aplicación y volver a abrirla suele resolverlo.",
    retry: "Reintentar",
    home: "Ir al inicio",
  },
  fr: {
    title: "YuKon3t a rencontré un problème",
    body: "Une erreur s'est produite lors du chargement de l'application. Réessayez\u00A0; si le problème persiste, fermer puis rouvrir l'application le résout généralement.",
    retry: "Réessayer",
    home: "Revenir à l'accueil",
  },
  pt: {
    title: "O YuKon3t encontrou um problema",
    body: "Algo deu errado ao carregar o aplicativo. Tente novamente; se continuar acontecendo, fechar e reabrir o aplicativo costuma resolver.",
    retry: "Tentar novamente",
    home: "Ir para o início",
  },
  ar: {
    title: "واجه YuKon3t مشكلة",
    body: "حدث خلل أثناء تحميل التطبيق نفسه. حاول مرة أخرى، وإذا تكرر ذلك فإعادة فتح التطبيق تحل المشكلة غالبًا.",
    retry: "إعادة المحاولة",
    home: "العودة إلى الرئيسية",
  },
};

const noSubscription = () => () => {};

/** The reader's language, from the same cookie and browser preference the server uses. */
function readLocale(): Locale {
  const cookie = document.cookie
    .split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${LOCALE_COOKIE}=`));
  return resolveLocale(cookie?.slice(LOCALE_COOKIE.length + 1), navigator.languages?.join(","));
}
const serverLocale = (): Locale => "en";

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
  retry: recover,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    captureError(error, { digest: error.digest, boundary: "global-error" });
  }, [error]);

  // Same as error.tsx: a client a build behind reloads itself instead.
  const { checking, retry } = useStaleBuildRecovery(recover, error);
  const locale = useSyncExternalStore(noSubscription, readLocale, serverLocale);
  const t = TEXT[locale];
  if (checking) {
    return (
      <html lang={locale} dir={localeDirection(locale)}>
        <body style={{ margin: 0, minHeight: "100vh", background: "var(--color-background, #14181a)" }} aria-busy="true" />
      </html>
    );
  }

  return (
    <html lang={locale} dir={localeDirection(locale)}>
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
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>{t.title}</h1>
        <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", opacity: 0.7, maxWidth: "24rem" }}>
          {t.body}
        </p>
        <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={retry}
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
            {t.retry}
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
            {t.home}
          </a>
        </div>
      </body>
    </html>
  );
}
