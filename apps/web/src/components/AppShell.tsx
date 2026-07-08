"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ChevronLeft, Compass, FileText, Home, LayoutGrid, Menu, Search, Settings, WalletCards, X } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { RechargeModal } from "./RechargeModal";
import { api } from "@/lib/api";
import type { Model, Wallet } from "@starai/shared-types";
import { clsx } from "clsx";
import { AGENT_CATEGORIES, AGENT_CATEGORY_TAG, CATEGORIES, CATEGORY_TAG, MODEL_ICONS } from "./workbench/categoryMeta";
import { ModelWorkspace } from "./workbench/ModelWorkspace";
import { AgentWorkspace } from "./workbench/AgentWorkspace";
import { GalleryPanel } from "./workbench/GalleryPanel";
import { SiteBrand, useSiteBranding } from "./SiteBrand";
import { ReferralShareButton } from "./ReferralShareButton";
import { useI18n } from "@/i18n/I18nProvider";
import { WorkbenchTopActions } from "./WorkbenchTopActions";

const PRIMARY_NAV = [
  { id: "models", label: "大模型", icon: LayoutGrid },
  { id: "agents", label: "智能体", icon: Bot },
  { id: "gallery", label: "灵感广场", icon: Compass },
] as const;

const SUBPAGE_LINKS = [
  { href: "/app", label: "工作台", shortLabel: "工作", icon: Home },
  { href: "/app/works", label: "我的作品", shortLabel: "作品", icon: LayoutGrid },
  { href: "/app/wallet", label: "钱包", shortLabel: "钱包", icon: WalletCards },
  { href: "/app/gallery", label: "灵感广场", shortLabel: "灵感", icon: Compass },
  { href: "/app/settings", label: "设置", shortLabel: "设置", icon: Settings },
  { href: "/app/pricing", label: "价格查询", shortLabel: "价格", icon: Bot },
  { href: "/app/api-docs", label: "API 文档", shortLabel: "API", icon: FileText },
] as const;

type Section = "models" | "agents" | "gallery";

const MOBILE_SUBPAGE_LINKS = [
  { href: "/app", label: "工作台", icon: Home },
  { href: "/app/works", label: "我的作品", icon: LayoutGrid },
  { href: "/app/wallet", label: "钱包", icon: WalletCards },
  { href: "/app/gallery", label: "灵感广场", icon: Compass },
  { href: "/app/settings", label: "设置", icon: Settings },
  { href: "/app/pricing", label: "价格查询", icon: Bot },
  { href: "/app/api-docs", label: "API 文档", icon: FileText },
] as const;

interface AgentItem {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  category?: string;
  nodes: { id: string; name: string }[];
}

interface GalleryTag {
  name: string;
  slug: string;
}

interface ModelCategory {
  code: string;
  label?: string;
}

interface AppShellProps {
  children: React.ReactNode;
  selectedModelCode?: string;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

export function AppShell({ children, selectedModelCode }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, td } = useI18n();
  const { site_name, site_description } = useSiteBranding();
  const { user, hydrate } = useAuthStore();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [showRecharge, setShowRecharge] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useIsMobile();

  const [section, setSection] = useState<Section>("models");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [modelCategoryCodes, setModelCategoryCodes] = useState<string[]>([]);
  const [activeModelCode, setActiveModelCode] = useState<string | undefined>(selectedModelCode);
  const [activeModel, setActiveModel] = useState<Model | null>(null);
  const [modelPrompt, setModelPrompt] = useState("");
  const [promptNonce, setPromptNonce] = useState(0);

  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [agentSearch, setAgentSearch] = useState("");
  const [agentCategory, setAgentCategory] = useState("all");
  const [activeAgentCode, setActiveAgentCode] = useState<string | undefined>();

  const [galleryTags, setGalleryTags] = useState<GalleryTag[]>([]);
  const [activeTag, setActiveTag] = useState("all");

  const isWorkbench = pathname === "/app" || pathname.startsWith("/app/models/");

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const primaryNavLabel = useCallback(
    (id: string) =>
      id === "models" ? t("nav.models") : id === "agents" ? t("nav.agents") : id === "gallery" ? t("nav.gallery") : id,
    [t]
  );

  const subpageLabel = useCallback(
    (href: string, mode: "full" | "short" = "full") => {
      const full: Record<string, string> = {
        "/app": t("nav.workspace"),
        "/app/works": t("nav.works"),
        "/app/wallet": t("nav.wallet"),
        "/app/gallery": t("nav.gallery"),
        "/app/settings": t("nav.settings"),
        "/app/pricing": t("nav.pricing"),
        "/app/api-docs": t("nav.apiDocs"),
      };
      const short: Record<string, string> = {
        "/app": t("nav.short.workspace"),
        "/app/works": t("nav.short.works"),
        "/app/wallet": t("nav.short.wallet"),
        "/app/gallery": t("nav.short.gallery"),
        "/app/settings": t("nav.short.settings"),
        "/app/pricing": t("nav.short.pricing"),
        "/app/api-docs": "API",
      };
      return (mode === "short" ? short[href] : full[href]) || href;
    },
    [t]
  );

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (user) api<Wallet>("/api/wallet").then(setWallet).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (selectedModelCode) setActiveModelCode(selectedModelCode);
  }, [selectedModelCode]);

  useEffect(() => {
    if (!isWorkbench || section !== "models") return;
    api<ModelCategory[]>("/api/model-categories")
      .then((items) => setModelCategoryCodes((items || []).map((item) => item.code).filter(Boolean)))
      .catch(() => setModelCategoryCodes([]));
  }, [isWorkbench, section]);

  const visibleModelCategories = useMemo(() => {
    const enabled = new Set(modelCategoryCodes);
    const hasModels = enabled.size > 0;
    const hasChatLike = enabled.has("chat") || enabled.has("multi_collab");
    return CATEGORIES.filter((cat) => {
      if (cat.code === "mine") return false;
      if (cat.code === "all") return true;
      if (!hasModels) return false;
      if (cat.code === "chat") return hasChatLike;
      return enabled.has(cat.code);
    });
  }, [modelCategoryCodes]);

  useEffect(() => {
    if (category === "all") return;
    if (!visibleModelCategories.some((cat) => cat.code === category)) {
      setCategory("all");
      setActiveModelCode(undefined);
      setActiveModel(null);
    }
  }, [category, visibleModelCategories]);

  useEffect(() => {
    if (!isWorkbench || section !== "models") return;
    const q =
      category === "all"
        ? ""
        : category === "chat"
          ? `?category=chat`
          : `?category=${category}`;
    api<Model[]>(`/api/models${q}`).then(setModels).catch(() => setModels([]));
  }, [category, isWorkbench, section]);

  useEffect(() => {
    if (section !== "models" || activeModelCode || isMobile) return;
    if (models.length > 0) setActiveModelCode(models[0].code);
  }, [models, activeModelCode, section, isMobile]);

  useEffect(() => {
    if (!activeModelCode) {
      setActiveModel(null);
      return;
    }
    api<Model>(`/api/models/${activeModelCode}`).then(setActiveModel).catch(() => setActiveModel(null));
  }, [activeModelCode]);

  useEffect(() => {
    if (!isWorkbench || section !== "agents") return;
    api<{ items: AgentItem[] }>("/api/agents").then((r) => {
      setAgents(r.items || []);
      if (!isMobile) setActiveAgentCode((prev) => prev || r.items?.[0]?.code);
    });
  }, [isWorkbench, section, isMobile]);

  useEffect(() => {
    if (!isWorkbench || section !== "gallery") return;
    api<{ items: GalleryTag[] }>("/api/gallery/tags").then((r) => setGalleryTags(r.items || []));
  }, [isWorkbench, section]);

  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) =>
        m.display_name.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [models, search]);

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    return agents.filter((a) => {
      if (agentCategory !== "all" && (a.category || "workflow") !== agentCategory) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.description?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [agents, agentSearch, agentCategory]);

  const showApiDocEntry = useMemo(() => {
    if (agentCategory !== "all" && agentCategory !== "api") return false;
    const q = agentSearch.trim().toLowerCase();
    if (!q) return true;
    return "开放api文档 api文档 open api documentation 开发者接口".includes(q);
  }, [agentCategory, agentSearch]);

  const useGalleryTemplate = (code: string | undefined, prompt: string) => {
    setSection("models");
    setModelPrompt(prompt);
    setPromptNonce((n) => n + 1);
    if (code) setActiveModelCode(code);
    closeDrawer();
  };

  const galleryNavTags = useMemo(() => {
    const seen = new Set<string>(["all"]);
    return [
      { name: t("nav.all"), slug: "all" },
      ...galleryTags.filter((tag) => {
        const slug = (tag.slug || "").trim();
        if (!slug || seen.has(slug)) return false;
        seen.add(slug);
        return true;
      }),
    ];
  }, [galleryTags, t]);

  const sectionTitle =
    section === "models"
      ? (activeModel ? td(`model.${activeModel.code}.name`, activeModel.display_name) : t("nav.models"))
      : section === "agents"
        ? (() => {
            const agent = agents.find((a) => a.code === activeAgentCode);
            return agent ? td(`agent.${agent.code}.name`, agent.name) : t("nav.agents");
          })()
        : t("nav.gallery");

  const renderSidebarBody = (opts?: { compact?: boolean; showFooter?: boolean }) => {
    const showFooter = opts?.showFooter !== false;
    const compact = opts?.compact;
    return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2.5 py-3.5 grid grid-cols-3 gap-1 shrink-0">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const active = item.id === section;
          return (
            <button
              key={item.id}
              onClick={() => {
                setSection(item.id as Section);
                if (item.id !== "models") setActiveModelCode(undefined);
              }}
              className={clsx(
                "flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs transition",
                active ? "bg-primary/10 text-primary font-medium" : "text-gray-400 hover:bg-gray-50"
              )}
            >
              <Icon size={20} />
              {!compact && primaryNavLabel(item.id)}
            </button>
          );
        })}
      </div>

      {section === "models" && (
        <>
          <div className="px-2.5 pb-1">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleModelCategories.length)}, minmax(0, 1fr))` }}
            >
              {visibleModelCategories.map((cat) => (
                <button
                  key={cat.code}
                  onClick={() => {
                    if (cat.code === "mine") {
                      router.push("/app/works");
                      closeDrawer();
                      return;
                    }
                    setActiveModelCode(undefined);
                    setActiveModel(null);
                    setCategory(cat.code);
                  }}
                  className={clsx(
                    "px-1 py-1.5 rounded-full text-[11px] leading-none text-center truncate transition",
                    category === cat.code ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                  )}
                  title={t(cat.labelKey)}
                >
                  {t(cat.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div className="px-2.5 py-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-gray-100">
              <Search size={14} className="text-gray-400 shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("common.searchModels")}
                className="flex-1 bg-transparent text-xs focus:outline-none placeholder:text-gray-400"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2.5 space-y-2 min-h-0">
            {filteredModels.map((model) => {
              const tag = CATEGORY_TAG[model.category] || {
                label: model.category,
                labelKey: `modelCategory.${model.category}`,
                className: "bg-gray-100 text-gray-500",
              };
              const modelName = td(`model.${model.code}.name`, model.display_name);
              const modelDesc = td(`model.${model.code}.description`, model.description || "");
              const tagLabel = td(`modelCategory.${model.category}`, t(tag.labelKey), { category: model.category });
              const selected = model.code === activeModelCode;
              return (
                <button
                  key={model.code}
                  data-active={selected ? "true" : "false"}
                  onClick={() => {
                    setModelPrompt("");
                    setActiveModelCode(model.code);
                    closeDrawer();
                  }}
                  className={clsx(
                    "tech-list-card w-full text-left p-3 rounded-2xl transition duration-200 group",
                    selected
                      ? "bg-white border-2 border-primary shadow-sm dark:bg-gray-900 dark:border-primary"
                      : "bg-gray-50/80 border-2 border-transparent hover:bg-white hover:border-gray-100 dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10 dark:hover:border-white/20"
                  )}
                >
                  <div className="flex gap-3">
                    <div className="tech-icon w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center text-lg shrink-0 shadow-sm overflow-hidden dark:bg-white/10 dark:border-white/10">
                      {model.icon_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={model.icon_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        MODEL_ICONS[model.category] || "✦"
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="tech-title font-semibold text-sm text-gray-900 truncate dark:text-gray-100">{modelName}</span>
                        <span className={clsx("text-[10px] px-1.5 py-0.5 rounded-full shrink-0", tag.className)}>
                          {tagLabel}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1 line-clamp-2 leading-relaxed">{modelDesc}</p>
                    </div>
                  </div>
                </button>
              );
            })}
            {filteredModels.length === 0 && <div className="text-center text-xs text-gray-400 py-8">{t("common.noModels")}</div>}
          </div>
        </>
      )}

      {section === "agents" && (
        <>
          <div className="px-2.5 pb-1">
            <div className="grid grid-cols-5 gap-1">
              {AGENT_CATEGORIES.map((cat) => (
                <button
                  key={cat.code}
                  onClick={() => {
                    if (cat.code === "mine") {
                      router.push("/app/works");
                      closeDrawer();
                      return;
                    }
                    setAgentCategory(cat.code);
                  }}
                  className={clsx(
                    "px-1 py-1.5 rounded-full text-[11px] leading-none text-center truncate transition",
                    agentCategory === cat.code
                      ? "bg-gray-900 text-white"
                      : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                  )}
                  title={t(cat.labelKey)}
                >
                  {t(cat.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div className="px-2.5 py-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-gray-100">
              <Search size={14} className="text-gray-400 shrink-0" />
              <input
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                placeholder={t("common.searchAgents")}
                className="flex-1 bg-transparent text-xs focus:outline-none placeholder:text-gray-400"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2.5 space-y-2 min-h-0">
            {showApiDocEntry && (
              <button
                key="api-doc-entry"
                data-active="false"
                onClick={() => {
                  router.push("/app/api-docs");
                  closeDrawer();
                }}
                className="tech-list-card w-full text-left p-3 rounded-2xl transition duration-200 bg-sky-50/80 border-2 border-sky-100 hover:bg-white hover:border-sky-200 dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10 dark:hover:border-white/20"
              >
                <div className="flex gap-3">
                  <div className="tech-icon w-10 h-10 rounded-xl bg-sky-900 text-white flex items-center justify-center text-xs font-bold shrink-0 dark:bg-sky-500/20 dark:text-sky-200">
                    API
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-sm text-gray-900 truncate dark:text-gray-100">{t("nav.openApiDocs")}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-sky-100 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
                        API
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                      {t("nav.openApiDocsDesc")}
                    </p>
                  </div>
                </div>
              </button>
            )}
            {filteredAgents.map((a) => {
              const selected = a.code === activeAgentCode;
              const agentName = td(`agent.${a.code}.name`, a.name);
              const agentDesc = td(`agent.${a.code}.description`, a.description || "");
              return (
                <button
                  key={a.code}
                  data-active={selected ? "true" : "false"}
                  onClick={() => {
                    setActiveAgentCode(a.code);
                    closeDrawer();
                  }}
                  className={clsx(
                    "tech-list-card w-full text-left p-3 rounded-2xl transition duration-200",
                    selected
                      ? "bg-white border-2 border-primary shadow-sm dark:bg-gray-900 dark:border-primary"
                      : "bg-gray-50/80 border-2 border-transparent hover:bg-white hover:border-gray-100 dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10 dark:hover:border-white/20"
                  )}
                >
                  <div className="flex gap-3">
                    <div className="tech-icon w-10 h-10 rounded-xl bg-gray-900 text-white flex items-center justify-center text-lg shrink-0">
                      {a.icon || "🤖"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="tech-title font-semibold text-sm text-gray-900 truncate dark:text-gray-100">{agentName}</span>
                        {(() => {
                          const tag = AGENT_CATEGORY_TAG[a.category || "workflow"];
                          return tag ? (
                            <span className={clsx("text-[10px] px-1.5 py-0.5 rounded-full shrink-0", tag.className)}>
                              {td(`agentCategory.${a.category || "workflow"}`, t(tag.labelKey))}
                            </span>
                          ) : null;
                        })()}
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1 line-clamp-2 leading-relaxed">{agentDesc}</p>
                    </div>
                  </div>
                </button>
              );
            })}
            {filteredAgents.length === 0 && !showApiDocEntry && (
              <div className="text-center text-xs text-gray-400 py-8">{t("common.noAgents")}</div>
            )}
          </div>
        </>
      )}

      {section === "gallery" && (
        <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1.5 min-h-0">
          {galleryNavTags.map((t) => (
            <button
              key={t.slug}
              onClick={() => {
                setActiveTag(t.slug);
                closeDrawer();
              }}
              className={clsx(
                "w-full text-left px-3 py-2 rounded-xl text-sm transition",
                activeTag === t.slug
                  ? "bg-white border border-primary text-gray-900 dark:bg-gray-900 dark:text-gray-100"
                  : "bg-gray-50/80 border border-transparent text-gray-600 hover:bg-gray-100 dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"
              )}
            >
              {t.slug === "all" ? t.name : td(`gallery.tag.${t.slug}`, t.name)}
            </button>
          ))}
        </div>
      )}

      {showFooter ? (
        <div className="px-2.5 py-3 border-t border-gray-50 mt-auto shrink-0">
          <div className="flex items-center gap-3">
            <Link href="/app/wallet" onClick={closeDrawer} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl transition hover:bg-gray-50 dark:hover:bg-white/5">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white text-sm font-bold shrink-0">
                {user?.nickname?.[0] || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user?.nickname || t("common.notLoggedIn")}</div>
                <div className="flex items-center gap-1 text-[10px] text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {t("common.online")} · {wallet?.compute_balance?.toFixed(1) ?? "0"} {t("common.compute")}
                </div>
              </div>
            </Link>
            <button
              onClick={() => setShowRecharge(true)}
              className="px-2.5 py-1.5 rounded-xl bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/15 transition shrink-0"
            >
              {t("common.recharge")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
    );
  };

  const MobileTopBar = ({ title }: { title: string }) => (
    <div className="lg:hidden shrink-0 flex items-center gap-2 px-3 py-2.5 bg-white border-b border-gray-100 dark:bg-gray-900 dark:border-white/10">
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-gray-600 dark:bg-white/10 dark:text-gray-200"
        aria-label="打开菜单"
      >
        <Menu size={18} />
      </button>
      <div className="flex-1 min-w-0 font-semibold text-sm text-gray-900 truncate dark:text-gray-100">{title}</div>
      <Link href="/app/wallet" className="text-xs text-primary font-medium shrink-0 tabular-nums">
        {wallet?.compute_balance?.toFixed(0) ?? "0"}
      </Link>
      <WorkbenchTopActions onRecharge={() => setShowRecharge(true)} />
    </div>
  );

  const DesktopQuickActions = () => (
    <div className="pointer-events-none absolute right-5 top-4 z-20 hidden items-center gap-2 lg:flex">
      <div className="pointer-events-auto">
        <WorkbenchTopActions onRecharge={() => setShowRecharge(true)} />
      </div>
    </div>
  );

  const SubpageDrawerBody = ({ showHeading = true }: { showHeading?: boolean }) => (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      {showHeading ? <div className="mb-2 px-2 text-[11px] font-semibold text-gray-400">{t("nav.pageNav")}</div> : null}
      <div className="grid grid-cols-3 gap-2">
        {MOBILE_SUBPAGE_LINKS.map((l) => {
          const active = l.href === "/app" ? pathname === "/app" : pathname.startsWith(l.href);
          const Icon = l.icon;
          return (
            <button
              key={l.href}
              type="button"
              onClick={() => {
                router.push(l.href);
                closeDrawer();
              }}
              className={clsx(
                "flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-center text-xs transition dark:hover:bg-white/10",
                active
                  ? "border-primary bg-primary/10 text-primary shadow-sm"
                  : "border-gray-100 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
              )}
            >
              <Icon size={18} className="shrink-0" />
              <span className="leading-tight">{subpageLabel(l.href)}</span>
            </button>
          );
        })}
        <ReferralShareButton variant="tile" />
      </div>
    </div>
  );

  const WorkbenchDrawerBody = () => (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">{renderSidebarBody({ showFooter: false })}</div>
      <div className="shrink-0 border-t border-gray-100 dark:border-white/10">
        <SubpageDrawerBody showHeading={false} />
      </div>
    </div>
  );
  const Drawer = () =>
    drawerOpen ? (
      <div className="lg:hidden fixed inset-0 z-50 flex">
        <button type="button" className="flex-1 bg-black/40" aria-label="关闭菜单" onClick={closeDrawer} />
        <aside className="w-[min(320px,88vw)] bg-white flex flex-col shadow-xl h-full dark:bg-gray-900 dark:border-l dark:border-white/10">
          <div className="px-3.5 py-4 flex items-center justify-between border-b border-gray-50 dark:border-white/10">
            <SiteBrand
              href="/app"
              subtitle={site_description || "AI 大模型聚合平台"}
              nameClassName="font-bold text-gray-900 truncate"
              subtitleClassName="text-[10px] text-gray-400 truncate"
            />
            <button
              type="button"
              onClick={closeDrawer}
              className="w-7 h-7 rounded-lg hover:bg-gray-50 flex items-center justify-center text-gray-400 dark:hover:bg-white/10"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {isWorkbench ? <WorkbenchDrawerBody /> : <SubpageDrawerBody />}
          </div>
        </aside>
      </div>
    ) : null;

  if (!isWorkbench) {
    const hideSubpageRail = pathname === "/app/api-docs";
    return (
      <div className="flex flex-col h-screen bg-[#EEF1F6] dark:bg-gray-950">
        <MobileTopBar
          title={
            subpageLabel(SUBPAGE_LINKS.find((l) => pathname.startsWith(l.href) && l.href !== "/app")?.href || "/app") ||
            site_name ||
            "StarAI"
          }
        />
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {!hideSubpageRail && (
            <aside className="hidden lg:flex w-[92px] bg-white border-r border-gray-100 flex-col items-center py-4 px-2 shrink-0 dark:bg-gray-900 dark:border-white/10">
              <SiteBrand href="/app" showName={false} className="mb-4" badgeClassName="rounded-2xl shadow-sm" />
              <div className="flex w-full flex-col gap-2">
                {SUBPAGE_LINKS.map((l) => {
                  const active = l.href === "/app" ? pathname === "/app" : pathname.startsWith(l.href);
                  const Icon = l.icon;
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      title={subpageLabel(l.href)}
                      className={clsx(
                        "flex w-full flex-col items-center justify-center gap-1 rounded-2xl border px-1 py-2 text-center transition",
                        active
                          ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                          : "border-transparent text-gray-500 hover:border-gray-200 hover:bg-gray-50 dark:text-gray-400 dark:hover:border-white/10 dark:hover:bg-white/5"
                      )}
                    >
                      <Icon size={18} className="shrink-0" />
                      <span className="text-[10px] font-medium leading-tight">{subpageLabel(l.href, "short")}</span>
                    </Link>
                  );
                })}
              </div>
            </aside>
          )}
          <main className={clsx("relative flex-1 min-w-0 dark:bg-gray-950", hideSubpageRail ? "overflow-hidden" : "overflow-auto")}>
            {!hideSubpageRail && (
              <div className="pointer-events-none fixed right-5 top-4 z-20 hidden items-center gap-2 lg:flex">
                <div className="pointer-events-auto">
                  <WorkbenchTopActions onRecharge={() => setShowRecharge(true)} />
                </div>
              </div>
            )}
            {children}
          </main>
        </div>
        <Drawer />
        <RechargeModal
          open={showRecharge}
          onClose={() => setShowRecharge(false)}
          onSuccess={() => api<Wallet>("/api/wallet").then(setWallet)}
        />
      </div>
    );
  }

  const showMobileModelPicker = isMobile && section === "models" && !activeModelCode;
  const hideMobileTopBar = section === "models" && !!activeModelCode;
  const showDesktopHeader = section === "models" && !activeModelCode;

  return (
    <div className="flex h-screen bg-[#EEF1F6] overflow-hidden dark:bg-gray-950">
      <aside
        className={clsx(
          "hidden lg:flex bg-white border-r border-gray-100 flex-col shrink-0 transition-all duration-300 shadow-[2px_0_12px_rgba(0,0,0,0.04)] dark:bg-gray-900 dark:border-white/10 dark:shadow-none",
          collapsed ? "w-[64px]" : "w-[248px]"
        )}
      >
        <div className="px-3.5 py-4 flex items-center justify-between border-b border-gray-50 dark:border-white/10">
          {!collapsed && (
            <SiteBrand
              href="/app"
              subtitle={site_description || "AI 大模型聚合平台"}
              nameClassName="font-bold text-gray-900 truncate dark:text-gray-100"
              subtitleClassName="text-[10px] text-gray-400 truncate"
            />
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-7 h-7 rounded-lg hover:bg-gray-50 flex items-center justify-center text-gray-400 shrink-0 dark:hover:bg-white/10"
          >
            <ChevronLeft size={16} className={clsx(collapsed && "rotate-180")} />
          </button>
        </div>
        {!collapsed && <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{renderSidebarBody()}</div>}
      </aside>

      <Drawer />

      <main className="workspace-surface relative flex-1 min-w-0 flex flex-col overflow-hidden">
        {!hideMobileTopBar && <MobileTopBar title={sectionTitle} />}
        {showDesktopHeader && (
          <div className="hidden lg:flex shrink-0 items-center justify-end gap-2 px-5 py-3 bg-white border-b border-gray-100 dark:bg-gray-900 dark:border-white/10">
            <WorkbenchTopActions onRecharge={() => setShowRecharge(true)} />
          </div>
        )}
        {(section === "agents" || section === "gallery") && <DesktopQuickActions />}

        {showMobileModelPicker ? (
          <div className="lg:hidden flex-1 flex flex-col min-h-0 bg-[#EEF1F6] dark:bg-gray-950">
            <div className="flex-1 overflow-y-auto min-h-0">{renderSidebarBody({ showFooter: false })}</div>
          </div>
        ) : (
          <>
            {section === "models" &&
              (activeModel ? (
                <ModelWorkspace
                  key={`${activeModel.code}:${promptNonce}`}
                  model={activeModel}
                  initialPrompt={modelPrompt}
                  onOpenModelPicker={isMobile ? () => setActiveModelCode(undefined) : undefined}
                  onOpenNav={isMobile ? () => setDrawerOpen(true) : undefined}
                  onRecharge={() => setShowRecharge(true)}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">{t("common.selectModel")}</div>
              ))}

            {section === "agents" &&
              (activeAgentCode ? (
                <AgentWorkspace key={activeAgentCode} code={activeAgentCode} />
              ) : (
                <div className="lg:hidden flex-1 flex flex-col min-h-0 bg-[#EEF1F6] overflow-y-auto dark:bg-gray-950">
                  {renderSidebarBody({ showFooter: false })}
                </div>
              ))}

            {section === "gallery" && <GalleryPanel activeTag={activeTag} onUseTemplate={useGalleryTemplate} />}
          </>
        )}
      </main>

      <RechargeModal
        open={showRecharge}
        onClose={() => setShowRecharge(false)}
        onSuccess={() => api<Wallet>("/api/wallet").then(setWallet)}
      />
    </div>
  );
}
