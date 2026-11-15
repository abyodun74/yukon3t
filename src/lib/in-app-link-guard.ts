// Pure rule for InAppLinkGuard (src/components/in-app-link-guard.tsx): would the native shell send this tap on a link to
// a YuKon3t page out of the app? Capacitor keeps a navigation in the WebView only when it is a same-window load of the
// app's own host (server.url, https://yukon3t.com); a new-window target or another host (www.yukon3t.com, which
// Netlify only redirects) is handed to the OS browser on iOS, and a new-window yukon3t.com link reloads the app on
// Android. Those taps are taken over and navigated in place instead.

export function shouldKeepInApp(link: { target: string | null; linkHost: string; pageHost: string }): boolean {
  const target = (link.target ?? "").trim().toLowerCase();
  const opensNewWindow = target !== "" && target !== "_self" && target !== "_top" && target !== "_parent";
  return opensNewWindow || link.linkHost.toLowerCase() !== link.pageHost.toLowerCase();
}
