import { NextResponse, type NextRequest } from "next/server";

const noStoreHeaderEntries = [
  ["Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate"],
  ["CDN-Cache-Control", "no-store"],
  ["Cloudflare-CDN-Cache-Control", "no-store"],
  ["Surrogate-Control", "no-store"],
  ["Pragma", "no-cache"],
  ["Expires", "0"],
  ["Vary", "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Url, Accept-Encoding"],
] as const;

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  for (const [key, value] of noStoreHeaderEntries) {
    response.headers.set(key, value);
  }
  response.headers.set("X-StarAI-Web-Path", request.nextUrl.pathname);
  return response;
}

export const config = {
  matcher: ["/", "/app", "/app/:path*", "/auth/:path*"],
};
