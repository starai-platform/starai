import { NextResponse } from "next/server";
import { API_URL } from "@/lib/api";

export const dynamic = "force-dynamic";

function svgFallback(siteName: string) {
  const letter = ((siteName || "S").trim().slice(0, 1).toUpperCase() || "S")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#12d6a3"/><text x="32" y="42" text-anchor="middle" font-size="34" font-family="Arial, sans-serif" font-weight="700" fill="#071316">${letter}</text></svg>`;
}

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/api/system-configs/public`, { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      const cfg = json?.data || {};
      const favicon = String(cfg.site_favicon || cfg.site_logo || "").trim();
      if (favicon) return NextResponse.redirect(favicon);
      return new NextResponse(svgFallback(cfg.site_name || "StarAI"), {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
  } catch {
    /* fallback below */
  }
  return new NextResponse(svgFallback("StarAI"), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
