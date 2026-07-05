import type { NextConfig } from "next";

const adminAssetPrefix = process.env.ADMIN_ASSET_PREFIX || "";

const noStoreHeaders = [
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
  { key: "CDN-Cache-Control", value: "no-store" },
  { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
  { key: "Surrogate-Control", value: "no-store" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" },
  { key: "Vary", value: "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Url, Accept-Encoding" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@starai/shared-types"],
  ...(adminAssetPrefix ? { assetPrefix: adminAssetPrefix } : {}),
  async headers() {
    return [
      {
        source: "/admin/:path*",
        headers: noStoreHeaders,
      },
      {
        source: "/admin",
        headers: noStoreHeaders,
      },
    ];
  },
};

export default nextConfig;
