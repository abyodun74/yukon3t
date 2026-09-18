"use client";

import { registerPlugin } from "@capacitor/core";

export type CallKitCallEvent = { callId: string };

export interface NativeCallKitPlugin {
  addListener(
    eventName: "voipTokenReceived",
    listenerFunc: (data: { token: string }) => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    eventName: "callAnswered" | "callDeclined",
    listenerFunc: (data: CallKitCallEvent) => void,
  ): Promise<{ remove: () => void }>;
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
