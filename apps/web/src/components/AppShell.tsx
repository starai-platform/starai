"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ChevronLeft, Compass, FileText, Home, LayoutGrid, Menu, Search, Settings, WalletCards, X } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { RechargeModal } from "./RechargeModal";
import { api, apiCached, apiForLocaleCached } from "@/lib/api";
import type { Model, User, Wallet } from "@starai/shared-types";
import { clsx } from "clsx";
import { agentDisplayCategory, AGENT_CATEGORIES, AGENT_CATEGORY_TAG, CATEGORIES, CATEGORY_TAG, MODEL_ICONS } from "./workbench/categoryMeta";
import { SiteBrand, useSiteBranding } from "./SiteBrand";
import { ReferralShareButton } from "./ReferralShareButton";
import { useI18n } from "@/i18n/I18nProvider";
import { WorkbenchTopActions } from "./WorkbenchTopActions";
import { AgentIcon } from "./workbench/AgentIcon";
import { galleryLanguageLabel, referenceTaxonomyLabel, type GalleryLanguage } from "./workbench/galleryReference";

function WorkspaceLoading() {
  const { t } = useI18n();
  return <div role="status" className="flex flex-1 items-center justify-center p-8 text-sm text-gray-400">{t("common.loading")}</div>;
}

const loadModelWorkspace = () => import("./workbench/ModelWorkspace");
const loadAgentWorkspace = () => import("./workbench/AgentWorkspace");
const loadInfiniteCanvasWorkspace = () => import("./workbench/InfiniteCanvasWorkspace");
const loadCreativeAgentWorkspace = () => import("./workbench/CreativeAgentWorkspace");

const ModelWorkspace = dynamic(() => loadModelWorkspace().then(module => module.ModelWorkspace), { loading: WorkspaceLoading });
const AgentWorkspace = dynamic(() => loadAgentWorkspace().then(module => module.AgentWorkspace), { loading: WorkspaceLoading });
const GalleryPanel = dynamic(() => import("./workbench/GalleryPanel").then(module => module.GalleryPanel), { loading: WorkspaceLoading });
const InfiniteCanvasWorkspace = dynamic(() => loadInfiniteCanvasWorkspace().then(module => module.InfiniteCanvasWorkspace), { loading: WorkspaceLoading });
const CreativeAgentWorkspace = dynamic(() => loadCreativeAgentWorkspace().then(module => module.CreativeAgentWorkspace), { loading: WorkspaceLoading });

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
const INFINITE_CANVAS_CODE = "infinite_canvas";
const VIRAL_REMAKE_CODE = "viral_remake";
const ONE_CLICK_VIRAL_REMAKE_CODE = "one_click_viral_remake";
const VIDEO_REMAKE_CODE = "video_remake";
const CONTENT_IMAGE_POST_CODE = "content_image_post";
const VIDEO_CREATION_CODE = "video_creation";
const VIDEO_CREATION_V2_CODE = "video_creation_v2";
const ECOMMERCE_VIDEO_CODE = "ecommerce_video";
const GENERAL_CREATIVE_AGENT_CODE = "general_creative_agent";
const CANVAS_WORKFLOW_CODES = new Set([
  INFINITE_CANVAS_CODE,
  VIRAL_REMAKE_CODE,
  ONE_CLICK_VIRAL_REMAKE_CODE,
  VIDEO_REMAKE_CODE,
  CONTENT_IMAGE_POST_CODE,
  VIDEO_CREATION_CODE,
  VIDEO_CREATION_V2_CODE,
  ECOMMERCE_VIDEO_CODE,
]);

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

function GallerySidebarFilterGroup({ label, items, value, onChange }: { label: string; items: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return (
    <section className="border-b border-gray-100 pb-4 last:border-b-0 dark:border-white/10">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">{label}</h3>
        <span className="text-[10px] tabular-nums text-gray-400">{Math.max(0, items.length - 1)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={clsx(
              "max-w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] leading-4 transition",
              value === item.value
                ? "border-primary/50 bg-primary/10 font-medium text-emerald-800 dark:text-emerald-200"
                : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}

interface ModelCategory {
  code: string;
  label?: string;
}

interface AppShellProps {
  children: React.ReactNode;
  selectedModelCode?: string;
  selectedAgentCode?: string;
  initialUser?: User | null;
  initialWallet?: Wallet | null;
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

export function AppShell({ children, selectedModelCode, selectedAgentCode, initialUser, initialWallet }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, td, locale } = useI18n();
  const { site_name, site_description, api_docs_enabled, api_docs_operations } = useSiteBranding();
  const storedUser = useAuthStore((state) => state.user);
  const [bootstrapUser, setBootstrapUser] = useState<User | null>(initialUser || null);
  const user = storedUser || bootstrapUser;
  const [wallet, setWallet] = useState<Wallet | null>(initialWallet || null);
  const [showRecharge, setShowRecharge] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useIsMobile();

  const [section, setSection] = useState<Section>(selectedAgentCode ? "agents" : "models");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [creativeAgent, setCreativeAgent] = useState<AgentItem | null>(null);
  const [creativeAgentLoaded, setCreativeAgentLoaded] = useState(false);
  const [modelCategoryCodes, setModelCategoryCodes] = useState<string[]>([]);
  const [activeModelCode, setActiveModelCode] = useState<string | undefined>(selectedModelCode);
  const [activeModel, setActiveModel] = useState<Model | null>(null);
  const [modelPrompt, setModelPrompt] = useState("");
  const [promptNonce, setPromptNonce] = useState(0);

  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");
  const [agentCategory, setAgentCategory] = useState("all");
  const [activeAgentCode, setActiveAgentCode] = useState<string | undefined>(selectedAgentCode);

  const [galleryTags, setGalleryTags] = useState<GalleryTag[]>([]);
  const [galleryMode, setGalleryMode] = useState<"reference" | "community">("reference");
  const [activeTag, setActiveTag] = useState("all");
  const [communityLanguages, setCommunityLanguages] = useState<GalleryLanguage[]>([]);
  const [activeCommunityLanguage, setActiveCommunityLanguage] = useState<GalleryLanguage | "all">("all");
  const [referenceTaxonomy, setReferenceTaxonomy] = useState<{ categories: string[]; styles: string[]; scenes: string[]; languages: GalleryLanguage[] }>({ categories: [], styles: [], scenes: [], languages: [] });
  const [activeReferenceCategory, setActiveReferenceCategory] = useState("all");
  const [activeReferenceStyle, setActiveReferenceStyle] = useState("all");
  const [activeReferenceScene, setActiveReferenceScene] = useState("all");
  const [activeReferenceLanguage, setActiveReferenceLanguage] = useState<GalleryLanguage | "all">("all");

  const isWorkbench = pathname === "/app" || pathname.startsWith("/app/models/") || pathname.startsWith("/app/agents/");
  const apiDocsVisible = api_docs_enabled !== false && (!api_docs_operations || Object.keys(api_docs_operations).length === 0 || Object.values(api_docs_operations).some((value) => value !== false));

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const preloadAgentWorkspace = useCallback((code: string) => {
    void apiForLocaleCached(`/api/agents/${encodeURIComponent(code)}`, locale).catch(() => {});
    if (CANVAS_WORKFLOW_CODES.has(code)) {
      void loadInfiniteCanvasWorkspace();
      void apiForLocaleCached("/api/models", locale).catch(() => {});
    } else if (code === GENERAL_CREATIVE_AGENT_CODE) {
      void loadCreativeAgentWorkspace();
    } else {
      void loadAgentWorkspace();
    }
  }, [locale]);

  useEffect(() => {
    if (storedUser && bootstrapUser) setBootstrapUser(null);
  }, [bootstrapUser, storedUser]);

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
    if (user && !wallet) api<Wallet>("/api/wallet").then(setWallet).catch(() => {});
  }, [user, wallet]);

  useEffect(() => {
    const refreshWallet = () => {
      if (user) api<Wallet>("/api/wallet").then(setWallet).catch(() => {});
    };
    window.addEventListener("starai:wallet-changed", refreshWallet);
    return () => window.removeEventListener("starai:wallet-changed", refreshWallet);
  }, [user]);

  useEffect(() => {
    if (selectedModelCode) {
      setSection("models");
      setActiveModelCode(selectedModelCode);
      setActiveAgentCode(undefined);
    }
  }, [selectedModelCode]);

  useEffect(() => {
    if (selectedAgentCode) {
      if (selectedAgentCode === GENERAL_CREATIVE_AGENT_CODE) {
        setSection("models");
        setActiveModelCode(GENERAL_CREATIVE_AGENT_CODE);
        setActiveAgentCode(undefined);
        router.replace(`/app/models/${GENERAL_CREATIVE_AGENT_CODE}`);
        return;
      }
      setSection("agents");
      setActiveAgentCode(selectedAgentCode);
      setActiveModelCode(undefined);
      setActiveModel(null);
    }
  }, [router, selectedAgentCode]);

  useEffect(() => {
    if (!isWorkbench || section !== "models") return;
    setCreativeAgentLoaded(false);
    apiForLocaleCached<AgentItem>(`/api/agents/${GENERAL_CREATIVE_AGENT_CODE}`, locale)
      .then((item) => setCreativeAgent(item || null))
      .catch(() => setCreativeAgent(null))
      .finally(() => setCreativeAgentLoaded(true));
  }, [isWorkbench, locale, section]);

  useEffect(() => {
    if (!creativeAgentLoaded || activeModelCode !== GENERAL_CREATIVE_AGENT_CODE || creativeAgent) return;
    setActiveModelCode(undefined);
    setActiveModel(null);
    router.replace("/app");
  }, [activeModelCode, creativeAgent, creativeAgentLoaded, router]);

  useEffect(() => {
    if (!isWorkbench || section !== "models") return;
    apiCached<ModelCategory[]>("/api/model-categories", 30_000, false)
      .then((items) => setModelCategoryCodes((items || []).map((item) => item.code).filter(Boolean)))
      .catch(() => setModelCategoryCodes([]));
  }, [isWorkbench, section]);

  const visibleModelCategories = useMemo(() => {
    const enabled = new Set(modelCategoryCodes);
    const hasModels = enabled.size > 0;
    const hasChatLike = enabled.has("chat") || enabled.has("multi_collab");
    return CATEGORIES.filter((cat) => {
      if (cat.code === "mine") return true;
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
    let active = true;
    apiForLocaleCached<Model[]>(`/api/models${q}`, locale)
      .then((items) => { if (active) setModels(Array.isArray(items) ? items : []); })
      .catch((error) => {
        if (active && error?.name !== "AbortError") setModels([]);
      });
    return () => { active = false; };
  }, [category, isWorkbench, section, locale]);

  useEffect(() => {
    if (section !== "models" || activeModelCode || isMobile || !creativeAgentLoaded) return;
    if (creativeAgent && (category === "all" || category === "chat")) setActiveModelCode(GENERAL_CREATIVE_AGENT_CODE);
    else if (models.length > 0) setActiveModelCode(models[0].code);
  }, [models, creativeAgent, creativeAgentLoaded, activeModelCode, category, section, isMobile]);

  useEffect(() => {
    if (!activeModelCode) {
      setActiveModel(null);
      return;
    }
    if (activeModelCode === GENERAL_CREATIVE_AGENT_CODE) {
      setActiveModel(null);
      return;
    }
    let active = true;
    apiForLocaleCached<Model>(`/api/models/${activeModelCode}`, locale)
      .then((item) => { if (active) setActiveModel(item || null); })
      .catch((error) => {
        if (active && error?.name !== "AbortError") setActiveModel(null);
      });
    return () => { active = false; };
  }, [activeModelCode, locale]);

  useEffect(() => {
    if (!isWorkbench || section !== "agents") return;
    setAgentsLoaded(false);
    let active = true;
    apiForLocaleCached<{ items: AgentItem[] }>("/api/agents", locale)
      .then((r) => {
        if (!active) return;
        const items = Array.isArray(r?.items) ? r.items : [];
        setAgents(items);
        setAgentsLoaded(true);
        if (!isMobile) {
          setActiveAgentCode((prev) =>
            prev && prev !== GENERAL_CREATIVE_AGENT_CODE && items.some((item) => item.code === prev)
              ? prev
              : items.find((item) => item.code !== GENERAL_CREATIVE_AGENT_CODE)?.code
          );
        }
      })
      .catch((error) => {
        if (active && error?.name !== "AbortError") {
          setAgents([]);
          setAgentsLoaded(false);
          if (!isMobile) setActiveAgentCode(INFINITE_CANVAS_CODE);
        }
      });
    return () => { active = false; };
  }, [isWorkbench, section, isMobile, locale]);

  useEffect(() => {
    if (!isWorkbench || section !== "gallery" || galleryMode !== "community") return;
    apiCached<{ items: GalleryTag[] }>("/api/gallery/tags", 30_000).then((r) => setGalleryTags(Array.isArray(r?.items) ? r.items : []));
  }, [galleryMode, isWorkbench, section]);

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
    const canvasAgent: AgentItem = {
      code: INFINITE_CANVAS_CODE,
      name: t("canvas.title"),
      description: t("canvas.description"),
      icon: "∞",
      category: "tool",
      nodes: [],
    };
    const source = agentsLoaded ? agents : [canvasAgent, ...agents.filter((item) => item.code !== INFINITE_CANVAS_CODE)];
    return source.filter((a) => {
      if (a.code === GENERAL_CREATIVE_AGENT_CODE) return false;
      if (agentCategory !== "all" && agentDisplayCategory(a.code, a.category) !== agentCategory) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.description?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [agents, agentsLoaded, agentSearch, agentCategory, t]);

  const showCreativeAgentModel = useMemo(() => {
    if (!creativeAgent || (category !== "all" && category !== "chat")) return false;
    const q = search.trim().toLowerCase();
    return !q || `${creativeAgent.name} ${creativeAgent.description || ""} agent 通用智能体`.toLowerCase().includes(q);
  }, [category, creativeAgent, search]);

  const showApiDocEntry = useMemo(() => {
    if (!apiDocsVisible) return false;
    if (agentCategory !== "all" && agentCategory !== "api") return false;
    const q = agentSearch.trim().toLowerCase();
    if (!q) return true;
    return "开放api文档 api文档 open api documentation 开发者接口".includes(q);
  }, [agentCategory, agentSearch, apiDocsVisible]);

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
      ? (activeModelCode === GENERAL_CREATIVE_AGENT_CODE ? td(`agent.${GENERAL_CREATIVE_AGENT_CODE}.name`, creativeAgent?.name || "Agent 通用智能体") : activeModel ? td(`model.${activeModel.code}.name`, activeModel.display_name) : t("nav.models"))
      : section === "agents"
        ? (() => {
            if (activeAgentCode === INFINITE_CANVAS_CODE) return t("canvas.title");
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
              onPointerEnter={() => {
                if (item.id === "agents") preloadAgentWorkspace(activeAgentCode || INFINITE_CANVAS_CODE);
              }}
              onFocus={() => {
                if (item.id === "agents") preloadAgentWorkspace(activeAgentCode || INFINITE_CANVAS_CODE);
              }}
              onClick={() => {
                setSection(item.id as Section);
                if (item.id === "models") {
                  setActiveAgentCode(undefined);
                  router.push(activeModelCode ? `/app/models/${encodeURIComponent(activeModelCode)}` : "/app");
                } else {
                  setActiveModelCode(undefined);
                  setActiveModel(null);
                }
                if (item.id === "agents") {
                  const code = activeAgentCode && activeAgentCode !== GENERAL_CREATIVE_AGENT_CODE
                    ? activeAgentCode
                    : agentsLoaded
                      ? agents.find((agent) => agent.code !== GENERAL_CREATIVE_AGENT_CODE)?.code
                      : INFINITE_CANVAS_CODE;
                  setActiveAgentCode(code);
                  preloadAgentWorkspace(code || INFINITE_CANVAS_CODE);
                  router.push(`/app/agents/${encodeURIComponent(code || INFINITE_CANVAS_CODE)}`);
                }
                if (item.id === "gallery") {
                  router.push("/app");
                }
                closeDrawer();
              }}
              className={clsx(
                "flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-0.5 py-3 text-[11px] transition xl:text-xs",
                active ? "bg-primary/10 text-primary font-medium" : "text-gray-400 hover:bg-gray-50"
              )}
            >
              <Icon size={20} />
              {!compact && <span className="w-full break-words text-center leading-4">{primaryNavLabel(item.id)}</span>}
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
                    router.push("/app");
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
            {showCreativeAgentModel && creativeAgent ? (
              <button
                type="button"
                data-active={activeModelCode === GENERAL_CREATIVE_AGENT_CODE ? "true" : "false"}
                onClick={() => {
                  setActiveModelCode(GENERAL_CREATIVE_AGENT_CODE);
                  setActiveModel(null);
                  setSection("models");
                  router.push(`/app/models/${GENERAL_CREATIVE_AGENT_CODE}`);
                  closeDrawer();
                }}
                className={clsx(
                  "tech-list-card w-full rounded-2xl border-2 p-3 text-left transition duration-200",
                  activeModelCode === GENERAL_CREATIVE_AGENT_CODE
                    ? "border-primary bg-white shadow-sm dark:bg-gray-900"
                    : "border-transparent bg-gradient-to-br from-amber-50 to-cyan-50 hover:border-primary/30 dark:from-amber-500/10 dark:to-cyan-500/10"
                )}
              >
                <div className="flex gap-3">
                <div className="tech-icon flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-amber-200 bg-gray-950 text-lg text-amber-300 shadow-sm dark:border-amber-400/20"><AgentIcon value={creativeAgent.icon} fallback="✦" alt={td(`agent.${creativeAgent.code}.name`, creativeAgent.name)} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="tech-title truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{td(`agent.${creativeAgent.code}.name`, creativeAgent.name)}</span>
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">Agent</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-400">{td(`agent.${creativeAgent.code}.description`, creativeAgent.description || "")}</p>
                  </div>
                </div>
              </button>
            ) : null}
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
                    setSection("models");
                    router.push(`/app/models/${encodeURIComponent(model.code)}`);
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
            {filteredModels.length === 0 && !showCreativeAgentModel && <div className="text-center text-xs text-gray-400 py-8">{t("common.noModels")}</div>}
          </div>
        </>
      )}

      {section === "agents" && (
        <>
          <div className="px-2.5 pb-1">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${AGENT_CATEGORIES.length}, minmax(0, 1fr))` }}
            >
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
              const displayCategory = agentDisplayCategory(a.code, a.category);
              const agentName = a.code === INFINITE_CANVAS_CODE ? t("canvas.title") : td(`agent.${a.code}.name`, a.name);
              const agentDesc = a.code === INFINITE_CANVAS_CODE ? t("canvas.description") : td(`agent.${a.code}.description`, a.description || "");
              return (
                <button
                  key={a.code}
                  data-active={selected ? "true" : "false"}
                  onPointerEnter={() => preloadAgentWorkspace(a.code)}
                  onFocus={() => preloadAgentWorkspace(a.code)}
                  onClick={() => {
                    preloadAgentWorkspace(a.code);
                    setActiveAgentCode(a.code);
                    setSection("agents");
                    router.push(`/app/agents/${encodeURIComponent(a.code)}`);
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
                    <div className="tech-icon w-10 h-10 rounded-xl bg-gray-900 text-white flex items-center justify-center text-lg shrink-0 overflow-hidden">
                      <AgentIcon value={a.icon} alt={agentName} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="tech-title font-semibold text-sm text-gray-900 truncate dark:text-gray-100">{agentName}</span>
                        {(() => {
                          const tag = AGENT_CATEGORY_TAG[displayCategory];
                          return tag ? (
                            <span className={clsx("text-[10px] px-1.5 py-0.5 rounded-full shrink-0", tag.className)}>
                              {td(`agentCategory.${displayCategory}`, t(tag.labelKey))}
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
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
          <div className="sticky top-0 z-10 -mx-1 bg-white/95 px-1 pb-3 backdrop-blur dark:bg-gray-900/95">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/5">
              {(["reference", "community"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setGalleryMode(mode)}
                  className={clsx(
                    "rounded-lg px-2 py-2 text-xs font-semibold transition",
                    galleryMode === mode
                      ? "bg-white text-gray-900 shadow-sm dark:bg-emerald-300 dark:text-gray-950"
                      : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  )}
                >
                  {mode === "reference" ? t("gallery.referenceCases") : t("gallery.communityWorks")}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            {galleryMode === "reference" ? (
              <>
                <GallerySidebarFilterGroup
                  label={t("gallery.category")}
                  value={activeReferenceCategory}
                  onChange={setActiveReferenceCategory}
                  items={[{ value: "all", label: t("gallery.all") }, ...referenceTaxonomy.categories.map((value) => ({ value, label: referenceTaxonomyLabel(value, locale) }))]}
                />
                <GallerySidebarFilterGroup
                  label={t("gallery.style")}
                  value={activeReferenceStyle}
                  onChange={setActiveReferenceStyle}
                  items={[{ value: "all", label: t("gallery.all") }, ...referenceTaxonomy.styles.map((value) => ({ value, label: referenceTaxonomyLabel(value, locale) }))]}
                />
                <GallerySidebarFilterGroup
                  label={t("gallery.scene")}
                  value={activeReferenceScene}
                  onChange={setActiveReferenceScene}
                  items={[{ value: "all", label: t("gallery.all") }, ...referenceTaxonomy.scenes.map((value) => ({ value, label: referenceTaxonomyLabel(value, locale) }))]}
                />
                <GallerySidebarFilterGroup
                  label={t("gallery.language")}
                  value={activeReferenceLanguage}
                  onChange={(value) => setActiveReferenceLanguage(value as GalleryLanguage | "all")}
                  items={[{ value: "all", label: t("gallery.all") }, ...referenceTaxonomy.languages.map((value) => ({ value, label: galleryLanguageLabel(value, locale) }))]}
                />
              </>
            ) : (
              <>
                <GallerySidebarFilterGroup
                  label={t("gallery.category")}
                  value={activeTag}
                  onChange={(value) => { setActiveTag(value); setActiveCommunityLanguage("all"); }}
                  items={galleryNavTags.map((tag) => ({ value: tag.slug, label: tag.slug === "all" ? tag.name : td(`gallery.tag.${tag.slug}`, tag.name) }))}
                />
                <GallerySidebarFilterGroup
                  label={t("gallery.language")}
                  value={activeCommunityLanguage}
                  onChange={(value) => setActiveCommunityLanguage(value as GalleryLanguage | "all")}
                  items={[{ value: "all", label: t("gallery.all") }, ...communityLanguages.map((value) => ({ value, label: galleryLanguageLabel(value, locale) }))]}
                />
              </>
            )}
          </div>
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

  const renderMobileTopBar = (title: string) => (
    <div className="relative z-40 lg:hidden shrink-0 flex items-center gap-2 px-3 py-2.5 bg-white border-b border-gray-100 dark:bg-gray-900 dark:border-white/10">
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-gray-600 dark:bg-white/10 dark:text-gray-200"
        aria-label={t("common.openMenu")}
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

  const renderDesktopQuickActions = () => (
    <div className="pointer-events-none absolute right-5 top-4 z-40 hidden items-center gap-2 lg:flex">
      <div className="pointer-events-auto">
        <WorkbenchTopActions onRecharge={() => setShowRecharge(true)} />
      </div>
    </div>
  );

  const SubpageDrawerBody = ({ showHeading = true }: { showHeading?: boolean }) => (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      {showHeading ? <div className="mb-2 px-2 text-[11px] font-semibold text-gray-400">{t("nav.pageNav")}</div> : null}
      <div className="grid grid-cols-3 gap-2">
        {MOBILE_SUBPAGE_LINKS.filter((l) => apiDocsVisible || l.href !== "/app/api-docs").map((l) => {
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
        <button type="button" className="flex-1 bg-black/40" aria-label={t("common.closeMenu")} onClick={closeDrawer} />
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
        {renderMobileTopBar(
            subpageLabel(SUBPAGE_LINKS.find((l) => pathname.startsWith(l.href) && l.href !== "/app")?.href || "/app") ||
            site_name ||
            "StarAI"
        )}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {!hideSubpageRail && (
            <aside className="hidden lg:flex w-[92px] bg-white border-r border-gray-100 flex-col items-center py-4 px-2 shrink-0 dark:bg-gray-900 dark:border-white/10">
              <SiteBrand href="/app" showName={false} className="mb-4" badgeClassName="rounded-2xl shadow-sm" />
              <div className="flex w-full flex-col gap-2">
                {SUBPAGE_LINKS.filter((l) => apiDocsVisible || l.href !== "/app/api-docs").map((l) => {
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
              <div className="pointer-events-none fixed right-5 top-4 z-40 hidden items-center gap-2 lg:flex">
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
    <div className="flex h-[100dvh] bg-[#EEF1F6] overflow-hidden dark:bg-gray-950">
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
        {!hideMobileTopBar && renderMobileTopBar(sectionTitle)}
        {showDesktopHeader && (
          <div className="relative z-40 hidden lg:flex shrink-0 items-center justify-end gap-2 px-5 py-3 bg-white border-b border-gray-100 dark:bg-gray-900 dark:border-white/10">
            <WorkbenchTopActions onRecharge={() => setShowRecharge(true)} />
          </div>
        )}
        {(section === "agents" || section === "gallery") && renderDesktopQuickActions()}

        {showMobileModelPicker ? (
          <div className="lg:hidden flex-1 flex flex-col min-h-0 bg-[#EEF1F6] dark:bg-gray-950">
            <div className="flex-1 overflow-y-auto min-h-0">{renderSidebarBody({ showFooter: false })}</div>
          </div>
        ) : (
          <>
            {section === "models" &&
              (activeModelCode === GENERAL_CREATIVE_AGENT_CODE ? (
                <CreativeAgentWorkspace
                  key={GENERAL_CREATIVE_AGENT_CODE}
                  onOpenModelPicker={isMobile ? () => setActiveModelCode(undefined) : undefined}
                  onOpenNav={isMobile ? () => setDrawerOpen(true) : undefined}
                  onRecharge={() => setShowRecharge(true)}
                  walletBalance={wallet?.compute_balance}
                />
              ) : activeModel ? (
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
                activeAgentCode === INFINITE_CANVAS_CODE ? (
                  <InfiniteCanvasWorkspace key={activeAgentCode} authenticated={Boolean(user)} />
                ) : activeAgentCode === VIRAL_REMAKE_CODE ? (
                  <InfiniteCanvasWorkspace
                    key={activeAgentCode}
                    authenticated={Boolean(user)}
                    workflowCode={VIRAL_REMAKE_CODE}
                    initialTemplateID="viral-remake"
                  />
                ) : activeAgentCode === ONE_CLICK_VIRAL_REMAKE_CODE ? (
                  <InfiniteCanvasWorkspace
                    key={activeAgentCode}
                    authenticated={Boolean(user)}
                    workflowCode={ONE_CLICK_VIRAL_REMAKE_CODE}
                    initialTemplateID="one-click-viral-remake"
                  />
                ) : activeAgentCode === VIDEO_REMAKE_CODE ? (
                  <InfiniteCanvasWorkspace
                    key={activeAgentCode}
                    authenticated={Boolean(user)}
                    workflowCode={VIDEO_REMAKE_CODE}
                    initialTemplateID="video-remake"
                  />
                ) : activeAgentCode === CONTENT_IMAGE_POST_CODE ? (
                  <InfiniteCanvasWorkspace
                    key={activeAgentCode}
                    authenticated={Boolean(user)}
                    workflowCode={CONTENT_IMAGE_POST_CODE}
                    initialTemplateID="content-image-post"
                  />
                ) : activeAgentCode === VIDEO_CREATION_CODE ? (
                  <InfiniteCanvasWorkspace
                    key={activeAgentCode}
                    authenticated={Boolean(user)}
                    workflowCode={VIDEO_CREATION_CODE}
                    initialTemplateID="story-short-video"
                  />
                ) : activeAgentCode === VIDEO_CREATION_V2_CODE ? (
                  <InfiniteCanvasWorkspace
                    key={activeAgentCode}
                    authenticated={Boolean(user)}
                    workflowCode={VIDEO_CREATION_V2_CODE}
                    initialTemplateID="story-short-video-v2"
                  />
                ) : activeAgentCode === ECOMMERCE_VIDEO_CODE ? (
                  <InfiniteCanvasWorkspace
                    key={activeAgentCode}
                    authenticated={Boolean(user)}
                    workflowCode={ECOMMERCE_VIDEO_CODE}
                    initialTemplateID="story-short-video-v2"
                    compactCommerce
                  />
                ) : activeAgentCode === GENERAL_CREATIVE_AGENT_CODE ? (
                  <CreativeAgentWorkspace key={activeAgentCode} />
                ) : (
                  <AgentWorkspace key={activeAgentCode} code={activeAgentCode} />
                )
              ) : (
                <div className="lg:hidden flex-1 flex flex-col min-h-0 bg-[#EEF1F6] overflow-y-auto dark:bg-gray-950">
                  {renderSidebarBody({ showFooter: false })}
                </div>
              ))}

            {section === "gallery" && (
              <GalleryPanel
                activeTag={activeTag}
                activeReferenceCategory={activeReferenceCategory}
                activeReferenceStyle={activeReferenceStyle}
                activeReferenceScene={activeReferenceScene}
                activeReferenceLanguage={activeReferenceLanguage}
                activeCommunityLanguage={activeCommunityLanguage}
                galleryMode={galleryMode}
                onGalleryModeChange={setGalleryMode}
                onCommunityTagChange={setActiveTag}
                onCommunityLanguageChange={setActiveCommunityLanguage}
                onCommunityLanguagesChange={setCommunityLanguages}
                onReferenceCategoryChange={setActiveReferenceCategory}
                onReferenceStyleChange={setActiveReferenceStyle}
                onReferenceSceneChange={setActiveReferenceScene}
                onReferenceLanguageChange={setActiveReferenceLanguage}
                onReferenceTaxonomyChange={setReferenceTaxonomy}
                onUseTemplate={useGalleryTemplate}
              />
            )}
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
