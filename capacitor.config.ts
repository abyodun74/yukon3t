import type { CapacitorConfig } from "@capacitor/cli";

// yukon3t is server-rendered (Server Actions, Prisma, auth cookies) and
// can't be shipped as a static bundle the way most Capacitor apps are —
// server.url points the native WebView at the real deployed app instead of
// bundling a local copy, so every page still goes through Next.js on the
// server exactly as it does in a browser. webDir below is required by the
// CLI's schema but unused at runtime once server.url is set.
//
// appId is a placeholder reverse-DNS bundle identifier — it must exactly
// match whatever App ID you register in the Apple Developer portal and
// App Store Connect. Change it here (and re-run `npx cap sync ios`) before
// registering the app if you want something else.
const config: CapacitorConfig = {
  appId: "com.yukon3t.app",
  appName: "YuKon3t",
  webDir: "public",
  server: {
    url: "https://yukon3t.com",
    // The deployed site is HTTPS-only already — cleartext (plain HTTP) is
    // never needed and would otherwise require an App Transport Security
    // exception to pass App Review.
    cleartext: false,
  },
  ios: {
    // Lets page content flow under the status bar/notch like a native app
    // (matches contentInsetAdjustmentBehavior "automatic" in UIKit) rather
    // than leaving a hard white gap above the page — StatusBar plugin
    // still controls the bar's own style/color on top of this.
    contentInset: "automatic",
  },
  plugins: {
    SplashScreen: {
      // capacitor-bridge.tsx calls SplashScreen.hide() itself once the page
      // has hydrated and AppSplash's own overlay is already painted — auto
      // -hiding on a timer instead would race that handoff and could reveal
      // a flash of unstyled content in between.
      launchAutoHide: false,
      backgroundColor: "#14181a",
    },
  },
};

export default config;
