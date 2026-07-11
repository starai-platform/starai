import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@starai/shared-types"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  async headers() {
    const noStoreHeaders = [
      { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
      { key: "CDN-Cache-Control", value: "no-store" },
      { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
      { key: "Surrogate-Control", value: "no-store" },
      { key: "Pragma", value: "no-cache" },
      { key: "Expires", value: "0" },
      { key: "Vary", value: "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Url, Accept-Encoding" },
    ];

    return [
      { source: "/", headers: noStoreHeaders },
      { source: "/app/:path*", headers: noStoreHeaders },
      { source: "/auth/:path*", headers: noStoreHeaders },
    ];
  },
};

export default nextConfig;
