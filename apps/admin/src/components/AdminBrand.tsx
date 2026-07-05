"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { clsx } from "clsx";

interface BrandData {
  site_name?: string;
  site_logo?: string;
  site_description?: string;
  admin_site_description?: string;
}

let brandCache: BrandData | null = null;
let brandPromise: Promise<BrandData> | null = null;

async function fetchBranding() {
  if (brandCache) return brandCache;
  if (!brandPromise) {
    brandPromise = fetch(`${API_URL}/api/system-configs/public`)
      .then(async (res) => {
        const json = await res.json();
        return (json?.data || {}) as BrandData;
      })
      .then((data) => {
        brandCache = data;
        return data;
      })
      .catch(() => ({ site_name: "StarAI", site_logo: "", site_description: "AI 大模型聚合平台", admin_site_description: "管理后台" }));
  }
  return brandPromise;
}

export function useAdminBranding() {
  const [branding, setBranding] = useState<BrandData>(
    brandCache || { site_name: "StarAI", site_logo: "", site_description: "AI 大模型聚合平台", admin_site_description: "管理后台" }
  );

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

export function AdminBrand({
  className,
  titleClassName,
  subtitleClassName,
  badgeClassName,
  subtitle,
}: {
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  badgeClassName?: string;
  subtitle?: string;
}) {
  const { site_name, site_logo, admin_site_description } = useAdminBranding();
  const name = site_name || "StarAI";
  return (
    <div className={clsx("flex items-center gap-3 min-w-0", className)}>
      <div className={clsx("flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-gray-950 text-white shrink-0", badgeClassName)}>
        {site_logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={site_logo} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-base font-bold">{name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className="min-w-0">
        <div className={clsx("font-bold truncate", titleClassName)}>{name} Admin</div>
        <div className={clsx("truncate", subtitleClassName)}>{subtitle || admin_site_description || "管理后台"}</div>
      </div>
    </div>
  );
}
