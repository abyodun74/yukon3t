import { Capacitor } from "@capacitor/core";
import { VOIP_TOKEN_STORAGE_KEY } from "@/lib/voip-token-storage";
import type { CallDevice } from "@/lib/voip-ring-targets";

/**
 * This device, as respondToCall/endCall need it to pick which iPhones get a VoIP cancel (voip-ring-targets.ts). The
 * iOS app names itself by the PushKit token capacitor-bridge.tsx keeps in localStorage; a page without one is matched
 * to nothing on the server, which then sends no VoIP cancel at all rather than risk ending this device's call.
 */
export function currentCallDevice(options?: { callKitEnded?: boolean }): CallDevice {
  if (Capacitor.getPlatform() !== "ios") return { platform: "other" };
  let voipToken: string | null = null;
  try {
    voipToken = localStorage.getItem(VOIP_TOKEN_STORAGE_KEY);
  } catch {
    voipToken = null;
  }
  return { platform: "ios", voipToken, callKitEnded: options?.callKitEnded ?? false };
}
