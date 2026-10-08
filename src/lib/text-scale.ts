/**
 * iOS Dynamic Type ("Larger Text") support for the web layer.
 *
 * A WKWebView does not apply the system text size to web content on its
 * own, so without this the app ignored Settings > Accessibility > Display &
 * Text Size > Larger Text entirely. TEXT_SCALE_SCRIPT (inlined by
 * TextScaleScript, first thing in <body>) measures the system body text
 * style and sets the root font size from it; since Tailwind's type and
 * spacing scales are rem-based, everything sized in rem then follows.
 *
 * How the root size is derived:
 *
 * - Measure a throwaway probe element styled `font: -apple-system-body`.
 *   iOS resolves that to the body text style at the user's current setting:
 *   17px at the default, 14px at the smallest, 53px at the largest
 *   accessibility size.
 * - scale = measured / 17, so the DEFAULT setting is scale 1 and the root
 *   stays at exactly the 16px every other platform uses — an iPhone at the
 *   default text size renders the same app it did before this existed. (A
 *   plain `html { font: -apple-system-body }` would have made the root
 *   17px, i.e. everything ~6% larger for every iPhone user.)
 * - The scale is clamped to [TEXT_SCALE_MIN, TEXT_SCALE_MAX]. The cap is
 *   the third accessibility step (40px measured, 235%): past that a phone
 *   screen is under ~8rem wide and the two largest steps were unusable,
 *   while 235% still clears the 200% the "Larger Text" label asks for. The
 *   floor keeps the smallest labels legible.
 * - It is written as a percentage on <html>'s inline style, and the
 *   property is removed again (not set to 100%) at scale 1.
 *
 * iOS only, a strict no-op everywhere else: both CSS.supports() checks must
 * pass. `font: -apple-system-body` alone also matches desktop Safari on
 * macOS, where the body style is 13px and would shrink the whole site;
 * `-webkit-touch-callout` only exists in iOS/iPadOS WebKit. Chromium and
 * Firefox support neither, so Android and desktop never get past the first
 * line. Everything is wrapped in try/catch and nothing else depends on it
 * having run: if the script throws or is blocked, the root simply stays at
 * the browser default 16px.
 *
 * Re-measuring: the setting can change while the app is in the background
 * (Settings, or Control Center's text size control), so it measures again
 * when the page becomes visible/focused/shown and on Capacitor's document
 * "resume" event, plus two delayed re-checks in case WebKit picks up the
 * new system size slightly after the app returns. The probe's size comes
 * from the system, not from the root font size this sets, and the root is
 * only written when the result actually changes — so there is no feedback
 * loop to thrash on.
 *
 * Kept as a plain ES5 string (no imports, no build step) because it has to
 * run before first paint, before any bundle has loaded.
 */

/** Dynamic Type body size, in px, at the default ("Large") setting. */
export const TEXT_SCALE_BASE_PX = 17;
/** Smallest root scale: 87.5%, a 14px root. Only the xSmall setting (14px measured, 82%) is clamped by it. */
export const TEXT_SCALE_MIN = 0.875;
/** Largest root scale: the third accessibility step, 40px measured — 235.29%, a 37.6px root. */
export const TEXT_SCALE_MAX = 40 / TEXT_SCALE_BASE_PX;

export const TEXT_SCALE_SCRIPT = `(function(){try{
var d=document,r=d.documentElement,w=window;
if(!(w.CSS&&CSS.supports&&CSS.supports("-webkit-touch-callout","none")&&CSS.supports("font","-apple-system-body")))return;
var last="";
function apply(){try{
var h=d.body||r,p=d.createElement("div");
p.style.cssText="font:-apple-system-body;position:absolute;visibility:hidden;pointer-events:none";
h.appendChild(p);
var px=parseFloat(w.getComputedStyle(p).fontSize);
h.removeChild(p);
if(!(px>0))return;
var s=Math.min(${TEXT_SCALE_MAX},Math.max(${TEXT_SCALE_MIN},px/${TEXT_SCALE_BASE_PX}));
var v=Math.abs(s-1)<0.005?"":(Math.round(s*10000)/100)+"%";
if(v===last)return;
last=v;
if(v)r.style.fontSize=v;else r.style.removeProperty("font-size");
}catch(e){}}
apply();
function again(){apply();w.setTimeout(apply,300);w.setTimeout(apply,1500);}
d.addEventListener("visibilitychange",function(){if(!d.hidden)again();});
d.addEventListener("resume",again);
w.addEventListener("pageshow",again);
w.addEventListener("focus",again);
}catch(e){}})();`;
