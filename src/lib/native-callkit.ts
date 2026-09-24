"use client";

import { registerPlugin } from "@capacitor/core";

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
   * CallKit's system UI before the page ever attached a listener. */
  getPendingCallEvents(): Promise<{ answered: string[]; declined: string[] }>;
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
