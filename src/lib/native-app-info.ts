import { Capacitor } from "@capacitor/core";
import { parseBuild, parseMarketingVersion, parsePlatform, type AppPlatform } from "@/lib/app-version";

export type NativeAppInfo = { platform: AppPlatform; build: number | null; version: string | null };

/**
 * The installed native app's platform, store build number and marketing version, from @capacitor/app's
 * App.getInfo() (already in every shipped build). Null in a browser, or if the plugin call fails. Read fresh each
 * time: an app updated from the store while backgrounded reports its new build on the next foreground.
 */
export async function getNativeAppInfo(): Promise<NativeAppInfo | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const platform = parsePlatform(Capacitor.getPlatform());
  if (!platform) return null;
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    return { platform, build: parseBuild(info.build), version: parseMarketingVersion(info.version) };
  } catch {
    return null;
  }
}
