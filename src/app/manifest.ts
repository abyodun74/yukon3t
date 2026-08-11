import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YuKon3t",
    short_name: "YuKon3t",
    description:
      "Connect across cultures, interests, and borders — verified communities, cross-cultural friendship, and cross-country collaboration.",
    start_url: "/",
    display: "standalone",
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
