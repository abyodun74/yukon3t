"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { captureError } from "@/lib/error-tracking";
import { ATTEST_FALLBACK_COOKIE, appAttestMode } from "@/lib/app-attest-shared";

// Client half of device attestation (docs/plans/app-attestation.md). Every
// native call is gated on isNativePlatform() + isPluginAvailable(), so in a
// browser — or in an app build without the plugin — nothing native is called.
//
// The plugin is @capacitor-firebase/app-check, patched to add
// getLimitedUseToken (Phase 1). It is reached through registerPlugin with only
// the methods used here, so this file needs no npm dependency until then.

const PLUGIN_NAME = "FirebaseAppCheck";
const TOKEN_TIMEOUT_MS = 8000;

interface FirebaseAppCheckPlugin {
  initialize(options: { isTokenAutoRefreshEnabled: boolean }): Promise<void>;
  getLimitedUseToken(): Promise<{ token: string }>;
}

let plugin: FirebaseAppCheckPlugin | null = null;
let initPromise: Promise<boolean> | null = null;
let metaPromise: Promise<string> | null = null;

function pluginAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(PLUGIN_NAME);
}

function getPlugin(): FirebaseAppCheckPlugin {
  plugin ??= registerPlugin<FirebaseAppCheckPlugin>(PLUGIN_NAME);
  return plugin;
}

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

function hasFallbackCookie(): boolean {
  return document.cookie.split(";").some((part) => part.trim().startsWith(`${ATTEST_FALLBACK_COOKIE}=`));
}

/** True when this page can send an attestation token instead of (enforce) or alongside (observe) Turnstile. */
export function canAttest(): boolean {
  return appAttestMode() !== "off" && pluginAvailable() && !hasFallbackCookie();
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function initialize(): Promise<boolean> {
  if (!initPromise) {
    // Never passes a debug token: a debug provider would make the device's
    // own tokens worthless as evidence.
    initPromise = getPlugin()
      .initialize({ isTokenAutoRefreshEnabled: false })
      .then(() => true)
      .catch((err: unknown) => {
        if (/already/i.test(errorText(err))) return true;
        initPromise = null;
        void captureError(err, { where: "app-attest-client.initialize" });
        return false;
      });
  }
  return initPromise;
}

/**
 * A single-use App Check token, or null (no plugin, error or 8s timeout) —
 * the caller then shows the Turnstile button. Integrity failures on rooted or
 * emulated devices are expected and not reported.
 */
export async function getAttestationToken(): Promise<string | null> {
  if (!canAttest()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TOKEN_TIMEOUT_MS);
    });
    const fetchToken = async () => {
      if (!(await initialize())) return null;
      const { token } = await getPlugin().getLimitedUseToken();
      return typeof token === "string" && token !== "" ? token : null;
    };
    return await Promise.race([fetchToken(), timeout]);
  } catch (err) {
    // An unpatched plugin lacks the method entirely — a build problem, not a device one.
    if (err && typeof err === "object" && "code" in err && err.code === "UNIMPLEMENTED") {
      void captureError(err, { where: "app-attest-client.getLimitedUseToken" });
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Untrusted telemetry for `yk-app-meta`: platform, build number, whether the
 * attestation plugin is present. Native only (null in a browser).
 */
export function getAppMeta(): Promise<string> | null {
  if (!Capacitor.isNativePlatform()) return null;
  metaPromise ??= (async () => {
    const meta: { p: string; b?: string; plugin: boolean } = {
      p: Capacitor.getPlatform(),
      plugin: Capacitor.isPluginAvailable(PLUGIN_NAME),
    };
    try {
      const { App } = await import("@capacitor/app");
      meta.b = (await App.getInfo()).build;
    } catch {
      // Build number is optional.
    }
    return JSON.stringify(meta);
  })();
  return metaPromise;
}

/** The part of the meta known synchronously, for a submit that beats getAppMeta(). */
export function basicAppMeta(): string | null {
  if (!Capacitor.isNativePlatform()) return null;
  return JSON.stringify({ p: Capacitor.getPlatform(), plugin: Capacitor.isPluginAvailable(PLUGIN_NAME) });
}
