import Link from "next/link";
import { getPublicSystemConfig } from "@/lib/public-config";
import { staticT } from "@/lib/static-i18n";

export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const cfg = await getPublicSystemConfig();
  const locale = cfg.default_locale || "zh-CN";
  const siteName = cfg.site_name || "StarAI";
  const title = cfg.privacy_title || staticT(locale, "legal.privacy");
  const content = String(cfg.privacy_content || "").trim();

  return (
    <main className="min-h-screen bg-[#071316] px-4 py-10 text-white">
      <div className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/20 md:p-10">
        <Link href="/" className="text-sm text-primary hover:underline">← {staticT(locale, "common.backHome")}</Link>
        <div className="mt-6 text-sm text-white/45">{siteName}</div>
        <h1 className="mt-2 text-3xl font-bold">{title}</h1>
        <article className="mt-8 whitespace-pre-wrap break-words text-sm leading-8 text-white/75">
          {content || staticT(locale, "legal.privacyEmpty")}
        </article>
      </div>
    </main>
  );
}
