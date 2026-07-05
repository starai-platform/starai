import type { Metadata } from "next";
import LandingPageClient from "@/components/LandingPageClient";
import { getPublicSystemConfig } from "@/lib/public-config";

export async function generateMetadata(): Promise<Metadata> {
  const cfg = await getPublicSystemConfig();
  const siteName = String(cfg.site_name || "StarAI").trim();
  const title = String(cfg.home_meta_title || "").trim() || `${siteName} - AI 创作聚合平台`;
  const description =
    String(cfg.home_meta_description || "").trim() ||
    String(cfg.site_description || "").trim() ||
    "一个账号聚合多家 AI 模型，对话、生成、创作一站完成。";

  return {
    title,
    description,
  };
}

export default function Page() {
  return <LandingPageClient />;
}
