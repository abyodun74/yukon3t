import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YuKon3t",
    short_name: "YuKon3t",
    description:
      "Connect across cultures, interests, and borders — verified communities, cross-cultural friendship, and cross-country collaboration.",
    start_url: "/",
    // Pins the installed app's identity to the root path explicitly,
    // rather than leaving it to default from start_url — keeps future
    // manifest edits (like the background_color change below) from ever
    // being mistaken for a different app requiring reinstall.
    id: "/",
    scope: "/",
    display: "standalone",
    // Reuses the single installed app window and navigates it in place for
    // any in-scope link, the same "one app, no browser chrome" behavior as
    // a Play Store app — rather than the default, which can hand a link
    // back to an ordinary browser tab instead of the installed app.
    launch_handler: { client_mode: "navigate-existing" },
    // The OS paints this solid color behind the icon for the brief moment
    // between tapping the home-screen icon and the app's own first paint —
    // it can't be animated or theme-conditional, so it's set to the dark
    // palette (the app's primary, most-branded look) rather than the
    // near-white light-theme background, so launch never flashes white.
    background_color: "#14181a",
    theme_color: "#14181a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
