"use client";

import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

/**
 * Thin wrapper around Capacitor's Haptics plugin — same semantic taxonomy
 * (impact/notification/selection) as Apple's own
 * UIImpactFeedbackGenerator/UINotificationFeedbackGenerator/
 * UISelectionFeedbackGenerator, since that's exactly what the plugin's iOS
 * side calls through to. On the web (a browser tab, or a platform the
 * plugin's own web fallback can't vibrate on) every call here fails
 * silently rather than throwing — haptics are a "nice if it happens" layer
 * (the apple-design skill's Utility principle: earn their place, never
 * block the interaction), never load-bearing for the action they
 * accompany.
 *
 * Deliberately NOT gated on Capacitor.isNativePlatform() the way most
 * native-plugin wrappers in this app are (e.g. in-app-review.ts) — unlike
 * a store review prompt, a browser tab on a touchscreen (installed PWA,
 * desktop Chrome DevTools device mode aside) can genuinely vibrate via the
 * plugin's own web fallback (navigator.vibrate), so skipping that case
 * would throw away a real improvement for no reason.
 *
 * Used sparingly, at meaningful moments only — see call sites — not on
 * every tap. Overusing haptics trains people to tune them all out.
 */
export async function hapticImpact(style: "light" | "medium" | "heavy" = "medium") {
  try {
    await Haptics.impact({
      style: style === "light" ? ImpactStyle.Light : style === "heavy" ? ImpactStyle.Heavy : ImpactStyle.Medium,
    });
  } catch {
    // No-op — see file comment.
  }
}

export async function hapticNotification(type: "success" | "warning" | "error") {
  try {
    await Haptics.notification({
      type: type === "success" ? NotificationType.Success : type === "warning" ? NotificationType.Warning : NotificationType.Error,
    });
  } catch {
    // No-op — see file comment.
  }
}

/**
 * The "tick" feeling of a value changing under your finger — a toggle
 * flipping, a picker wheel landing on a new value, a drag crossing a
 * threshold. Apple's UISelectionFeedbackGenerator equivalent. Doesn't need
 * a matching selectionStart()/selectionEnd() bracket for this app's use —
 * those exist to let multiple selectionChanged() calls in one continuous
 * gesture feel distinct from a single one-off change, which none of this
 * app's call sites are (each is a single discrete flip), so a bare
 * selectionChanged() alone already does the right thing.
 */
export async function hapticSelection() {
  try {
    await Haptics.selectionChanged();
  } catch {
    // No-op — see file comment.
  }
}
