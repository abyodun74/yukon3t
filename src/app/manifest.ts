import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YuKon3t",
    short_name: "YuKon3t",
    description:
      "Connect across cultures, interests, and borders — verified communities, cross-cultural friendship, and cross-country collaboration.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f6f2",
    theme_color: "#b5651d",
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
