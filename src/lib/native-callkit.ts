"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { nativePluginHasMethod, type CallKitRingEndReason, type CallKitRingPort } from "@/lib/callkit-ring-sync";

type CallKitCallEvent = { callId: string };

export interface NativeCallKitPlugin {
  addListener(
    eventName: "voipTokenReceived",
    listenerFunc: (data: { token: string }) => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    eventName: "callAnswered" | "callDeclined",
    listenerFunc: (data: CallKitCallEvent) => void,
  ): Promise<{ remove: () => void }>;
  /**
   * The real delivery path for a token that arrived before this app's JS
   * ever attached a listener (the common case — PushKit fires within
   * milliseconds of native launch, well before the page finishes loading).
   * Capacitor's own notifyListeners(..., retainUntilConsumed: true) is
   * *supposed* to replay a pre-attachment event automatically, but
   * real-device testing found it doesn't reliably do that in this
   * Capacitor version — call this once, right after addListener, instead
   * of relying on that. See NativeCallKitPlugin.swift.
   */
  getPendingToken(): Promise<{ token: string | null }>;
  /** Same idea as getPendingToken(), for a call answered/declined via
   * CallKit's system UI while the page wasn't listening (not loaded yet, or
   * suspended in the background / behind the lock screen). Destructive: each
   * call returns what was queued since the last one. IncomingCallListener
   * drains it before every ring check. */
  getPendingCallEvents(): Promise<{ answered: string[]; declined: string[] }>;
  /** The call was answered in the app on this device: CallKit's ring becomes its active call. Not in builds before
   * this method existed, see createNativeCallKitRingPort. */
  reportCallAnswered(options: { callId: string }): Promise<void>;
  /** Stops CallKit ringing for a call declined here or resolved elsewhere. Same build caveat. */
  endRingingCall(options: { callId: string; reason: CallKitRingEndReason }): Promise<void>;
  /** Calls CallKit is ringing (reported, not answered here). Same build caveat. */
  getRingingCalls(): Promise<{ callIds: string[] }>;
}

/**
 * iOS-only native plugin (see ios/App/App/NativeCallKitPlugin.swift) —
 * PushKit VoIP-token registration plus CallKit's system-level incoming-call
 * UI, whose Accept/Decline actions get reported back to JS as these two
 * events. This is what lets a call ring and be answered even while the app
 * is fully terminated, matching what CallMessagingService.java already does
 * natively on Android via a notification's own action buttons. There is no
 * Android build of this plugin — registerPlugin resolves to a no-op stub
 * there, which is fine since every call site below also gates on
 * Capacitor.getPlatform() === "ios" before touching it.
 */
export const NativeCallKit = registerPlugin<NativeCallKitPlugin>("NativeCallKit");

const PLUGIN_NAME = "NativeCallKit";

function hasMethod(method: keyof NativeCallKitPlugin) {
  const headers = (Capacitor as unknown as { PluginHeaders?: Parameters<typeof nativePluginHasMethod>[0] })
    .PluginHeaders;
  return nativePluginHasMethod(headers, PLUGIN_NAME, method);
}

const noop: CallKitRingPort = {
  answered: async () => {},
  end: async () => {},
  ringing: async () => [],
};

/**
 * CallKit's side of callkit-ring-sync.ts. iOS only; each method is feature-detected because builds installed before
 * these methods were added don't have them (the web layer is shared with every installed build).
 */
export function createNativeCallKitRingPort(): CallKitRingPort {
  if (Capacitor.getPlatform() !== "ios") return noop;
  return {
    answered: async (callId) => {
      if (hasMethod("reportCallAnswered")) await NativeCallKit.reportCallAnswered({ callId });
    },
    end: async (callId, reason) => {
      if (hasMethod("endRingingCall")) await NativeCallKit.endRingingCall({ callId, reason });
    },
    ringing: async () => {
      if (!hasMethod("getRingingCalls")) return [];
      return (await NativeCallKit.getRingingCalls()).callIds;
    },
  };
}
