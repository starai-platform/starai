"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SystemConfig } from "@starai/shared-types";
import { clsx } from "clsx";
import { useI18n } from "@/i18n/I18nProvider";

type BrandData = Pick<
  SystemConfig,
  | "site_name"
  | "site_logo"
  | "site_favicon"
  | "site_description"
  | "admin_site_description"
  | "site_api_tagline"
  | "site_copyright"
  | "terms_title"
  | "terms_content"
  | "privacy_title"
  | "privacy_content"
  | "image_captcha_enabled"
  | "customer_service_enabled"
  | "customer_service_title"
  | "customer_service_name"
  | "customer_service_subtitle"
  | "customer_service_floating_image"
  | "customer_service_avatar"
  | "customer_service_qr_url"
  | "customer_service_qr_tip"
  | "customer_service_phone"
  | "customer_service_wechat"
  | "customer_service_hours"
>;

const DEFAULT_BRANDING: BrandData = {
  site_name: "StarAI",
  site_logo: "",
  site_favicon: "",
  site_description: "AI 大模型聚合平台",
  site_api_tagline: "Open API Documentation",
  terms_title: "服务协议",
  terms_content: "",
  privacy_title: "隐私政策",
  privacy_content: "",
};

let brandingCache: BrandData | null = null;
let brandingPromise: Promise<BrandData> | null = null;

async function fetchBranding() {
  if (brandingCache) return brandingCache;
  if (!brandingPromise) {
    brandingPromise = api<BrandData>("/api/system-configs/public")
      .then((data) => {
        brandingCache = data;
        return data;
      })
      .catch(() => DEFAULT_BRANDING);
  }
  return brandingPromise;
}

export function useSiteBranding() {
  const [branding, setBranding] = useState<BrandData>(brandingCache || DEFAULT_BRANDING);

  useEffect(() => {
    let alive = true;
    fetchBranding().then((data) => {
      if (alive) setBranding(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  return branding;
}

export function SiteBrand({
  href = "/app",
  showName = true,
  className,
  nameClassName,
  subtitle,
  subtitleClassName,
  badgeClassName,
}: {
  href?: string;
  showName?: boolean;
  className?: string;
  nameClassName?: string;
  subtitle?: string;
  subtitleClassName?: string;
  badgeClassName?: string;
}) {
  const { ts } = useI18n();
  const { site_name, site_logo, site_description } = useSiteBranding();
  const siteName = site_name || DEFAULT_BRANDING.site_name || "StarAI";
  const siteSubtitle = ts(subtitle ?? site_description ?? "");

  return (
    <Link href={href} className={clsx("flex min-w-0 items-center gap-2.5", className)}>
      <div
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary text-sm font-bold text-dark",
          badgeClassName
        )}
      >
        {site_logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={site_logo} alt={siteName} className="h-full w-full object-cover" />
        ) : (
          siteName.slice(0, 1).toUpperCase()
        )}
      </div>
      {showName ? (
        <div className="min-w-0">
          <div className={clsx("truncate font-bold", nameClassName)}>{siteName}</div>
          {siteSubtitle ? <div className={clsx("truncate", subtitleClassName)}>{siteSubtitle}</div> : null}
        </div>
      ) : null}
    </Link>
  );
}
