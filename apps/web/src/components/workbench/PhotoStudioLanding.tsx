"use client";

import { useEffect, useState } from "react";
import { ArrowUp, Camera, HelpCircle, History, ImageIcon, Layers, Loader2, Palette, Plus, Upload, X } from "lucide-react";
import { api, apiCached, uploadAsset } from "@/lib/api";
import { BottomBarState, ChatTopTools, ReferenceImagePick } from "./BottomBar";
import { MediaMenuOption, MediaOptionMenu } from "./MediaOptionMenu";
import { PhotoPlayGuide } from "./PhotoPlayGuide";
import { useI18n } from "@/i18n/I18nProvider";

type HistoryItem = { public_id: string; title?: string; workflow_name?: string; status: string; created_at: string };
type AgentRole = { id: string; name?: string; avatar?: string; description?: string };
type LandingProps = {
  workflowCode: string;
  workflowName: string;
  workflowDescription: string;
  roles: AgentRole[];
  heroTags?: string[];
  steps?: { icon?: string; title?: string; subtitle?: string; tags?: string[] }[];
  onLoadHistory?: (id: string) => void | Promise<void>;
  onNewTask?: () => void;
};
type InputBarProps = {
  defaultModelCode?: string;
  error?: string;
  featureTags?: string[];
  onSubmit: (inputs: Record<string, any>) => void | Promise<void>;
};

const PHOTO_TYPES = ["写真", "职业照", "证件照"];
const ID_BACKGROUNDS = ["白色", "蓝色", "红色"];
const COUNTS = [1, 2, 4, 6, 8];
const STYLES = [
  "影棚质感", "杂志大片", "黑白艺术", "韩系简约", "日系清新", "港风胶片", "法式复古", "美式复古",
  "国风古装", "旗袍风情", "新中式", "森系文艺", "咖啡馆日常", "都市夜景", "海边度假", "校园青春",
  "轻奢名媛", "甜美少女", "酷飒街头", "运动活力", "赛博霓虹", "暗调情绪", "户外自然", "婚纱浪漫",
  "雪景冬日", "商务精英", "纯白极简", "毕业季", "古典油画", "二次元动漫", "敦煌飞天", "民族风",
  "金秋落叶", "樱花春景", "Y2K千禧", "多巴胺糖果", "欧式宫廷", "沙漠戈壁",
];
// 后端未配置角色时的兜底 AI 编辑部成员
const DEFAULT_TEAM: AgentRole[] = [
  { id: "photo_director", name: "摄影总监", avatar: "/assets/photo-studio/photo-director.png", description: "统筹整场拍摄，把控写真类型、风格与出片质量" },
  { id: "stylist", name: "造型师", avatar: "/assets/photo-studio/stylist.png", description: "根据照片与风格倾向设计妆造、服装与拍摄方案" },
  { id: "photographer", name: "摄影师", avatar: "/assets/photo-studio/photographer.png", description: "按拍摄方案出片，影棚级布光与构图" },
  { id: "retoucher", name: "修图师", avatar: "/assets/photo-studio/retoucher.png", description: "保留人像特征的精修质感，皮肤与光影自然通透" },
];
const isImageAvatar = (avatar?: string) => !!avatar && (avatar.startsWith("/") || avatar.startsWith("http"));

type TopBarProps = {
  workflowCode: string;
  onNewTask?: () => void;
  onLoadHistory?: (id: string) => void | Promise<void>;
  historyFallbackTitle?: string;
};

/** 顶部操作栏：新任务 + 历史（落地页与项目页共用，提交任务后保持可见可点） */
export function PhotoStudioTopBar({ workflowCode, onNewTask, onLoadHistory, historyFallbackTitle = "写真任务" }: TopBarProps) {
  const { ts } = useI18n();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState("");

  const toggleHistory = async () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next) return;
    setHistoryError("");
    try {
      const result = await api<{ items: HistoryItem[] }>(`/api/agent-projects?workflow_code=${encodeURIComponent(workflowCode)}&page=1&page_size=20`);
      setHistoryItems(result.items || []);
    } catch (err) {
      setHistoryItems([]);
      setHistoryError(err instanceof Error ? err.message : ts("历史记录加载失败"));
    }
  };

  return (
    <div className="relative flex shrink-0 items-center gap-2">
      <button type="button" onClick={() => onNewTask?.()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-dark shadow-sm"><Plus size={15} />{ts("新任务")}</button>
      <button type="button" onClick={toggleHistory} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-100 bg-white px-3 text-sm text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"><History size={15} />{ts("历史")}</button>
      {historyOpen && (
        <div className="absolute left-0 top-11 z-40 w-[320px] max-h-[60vh] overflow-y-auto rounded-2xl border border-gray-100 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-gray-900">
          {historyError ? <div className="p-4 text-xs text-red-500">{historyError}</div> : historyItems.length === 0 ? <div className="p-5 text-center text-xs text-gray-400">{ts("暂无历史任务")}</div> : historyItems.map((item) => (
            <button key={item.public_id} type="button" onClick={() => { setHistoryOpen(false); onLoadHistory?.(item.public_id); }} className="w-full rounded-xl px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/5">
              <div className="truncate text-sm text-gray-800 dark:text-gray-100">{item.title || item.workflow_name || ts(historyFallbackTitle)}</div>
              <div className="mt-0.5 text-[10px] text-gray-400">{new Date(item.created_at).toLocaleString()}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 顶部展示区：标题、玩法步骤、AI 编辑部团队（输入栏由 PhotoStudioInputBar 常驻底部） */
export function PhotoStudioLanding({ workflowCode, workflowName, workflowDescription, roles, heroTags, steps, onLoadHistory, onNewTask }: LandingProps) {
  const { t, ts } = useI18n();
  const team = roles.length > 0 ? roles : DEFAULT_TEAM;
  const directorAvatar = team[0]?.avatar;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 py-1.5 sm:px-5 sm:py-2 lg:px-8">
      <PhotoStudioTopBar workflowCode={workflowCode} onNewTask={onNewTask} onLoadHistory={onLoadHistory} />

      <div className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col justify-center py-1.5 lg:py-3">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-fuchsia-100 px-3 py-1 text-xs font-semibold text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-200"><span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400" />{ts("摄影智能体")}</div>
          <div className="mt-2 flex items-center justify-center gap-2.5 sm:gap-3">
            {isImageAvatar(directorAvatar) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img loading="lazy" decoding="async" src={directorAvatar} alt={ts("AI写真馆")} className="h-10 w-10 rounded-2xl object-cover ring-1 ring-fuchsia-200 dark:ring-fuchsia-400/30 sm:h-12 sm:w-12" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-fuchsia-100 text-xl dark:bg-fuchsia-500/15 sm:h-12 sm:w-12 sm:text-2xl">📸</div>
            )}
            <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white sm:text-4xl">{workflowName || ts("AI写真馆")}</h1>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-[13px] leading-5 text-gray-500 dark:text-slate-300 sm:text-sm sm:leading-6">{workflowDescription || ts("上传一张照片，选择写真类型与风格倾向，几分钟产出一整套杂志级写真。")}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {(heroTags?.length ? heroTags : ["AI写真", "风格百变", "人像保真"]).map((tag) => <span key={tag} className="hero-tag">{ts(tag)}</span>)}
          </div>
        </div>

        {(steps?.length ?? 0) > 0 && (
          <div className="mx-auto mt-3 grid w-full grid-cols-2 gap-2 px-3 sm:mt-4 sm:grid-cols-4 sm:px-0">
            {(steps || []).map((step, index) => (
              <div key={index} className="rounded-2xl border border-white bg-white/70 p-2.5 backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-3">
                <div className="text-lg">{step.icon}</div>
                <div className="mt-1 text-xs font-semibold text-gray-800 dark:text-gray-100">{step.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-gray-400">{step.subtitle}</div>
              </div>
            ))}
          </div>
        )}

        {/* AI 编辑部：为你效力的摄影团队（移动端一行四个居中） */}
        <div className="mx-auto mt-3 w-full px-3 sm:mt-4 sm:px-0">
          <div className="flex items-center justify-center gap-3">
            <h2 className="text-sm font-bold text-fuchsia-600 dark:text-fuchsia-300 sm:text-base">{ts("为你效力的 AI 编辑部")}</h2>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
              <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" /></span>
              {t("{count} 位成员在线", { count: team.length })}
            </span>
          </div>
          <div className="mx-auto mt-2.5 grid max-w-md grid-cols-4 justify-items-center gap-2 sm:mt-3 sm:max-w-[640px] sm:gap-4">
            {team.map((role) => (
              <div key={role.id} title={ts(role.description || "")} className="flex flex-col items-center gap-1.5 text-center">
                <div className="relative">
                  {isImageAvatar(role.avatar) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img loading="lazy" decoding="async" src={role.avatar} alt={ts(role.name || role.id)} className="h-12 w-12 rounded-full object-cover shadow-sm ring-1 ring-fuchsia-200/80 dark:ring-fuchsia-400/30" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-fuchsia-100 text-xl shadow-sm ring-1 ring-fuchsia-200/80 dark:bg-fuchsia-500/10 dark:ring-fuchsia-400/30">{role.avatar || "📸"}</div>
                  )}
                  {/* 在线小绿点角标 */}
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400 dark:border-[#0a0510]" />
                </div>
                <span className="whitespace-nowrap text-[11px] text-gray-600 dark:text-slate-300">{ts(role.name || role.id)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 底部常驻输入栏：参照电商一键出图，资产库引入用 ChatTopTools，提交后不跳转 */
export function PhotoStudioInputBar({ defaultModelCode, error, featureTags, onSubmit }: InputBarProps) {
  const { t, ts } = useI18n();
  const [photo, setPhoto] = useState<ReferenceImagePick | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [photoType, setPhotoType] = useState("写真");
  const [style, setStyle] = useState("影棚质感");
  const [idBackground, setIdBackground] = useState("白色");
  const [count, setCount] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [models, setModels] = useState<{ code: string; display_name?: string; category?: string }[]>([]);
  const [model, setModel] = useState(defaultModelCode || "");
  const [guideOpen, setGuideOpen] = useState(false);
  const [bottom, setBottom] = useState<BottomBarState>({ channel_key: "price_first", fallback_enabled: true, web_search: false, timeout_sec: 30, asset_ids: [], files: [] });

  useEffect(() => {
    apiCached<{ code: string; display_name?: string; category?: string }[]>("/api/models?category=image")
      .then((items) => {
        const list = (items || []).filter((item) => item.category !== "multi_collab");
        setModels(list);
        setModel((old) => (list.some((item) => item.code === old) ? old : list[0]?.code || ""));
      })
      .catch(() => setModels([]));
  }, [defaultModelCode]);

  const upload = async (file?: File) => {
    if (!file || uploading) return;
    setUploading(true);
    setUploadError("");
    try {
      const asset = await uploadAsset(file, { name: file.name, kind: "image", asset_type: "role" });
      setPhoto({ url: asset.url, name: file.name });
    } catch (err) {
      setPhoto(null);
      setUploadError(err instanceof Error ? err.message : ts("照片上传失败"));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!photo || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        image_url: photo.url,
        photo_type: photoType,
        style: photoType === "证件照" ? "" : style,
        id_background: idBackground,
        count,
        prompt: prompt.trim(),
        aspect_ratio: "3:4",
        _mode: "auto",
        ...(model ? { model_code: model } : {}),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const modelLabel = models.find((item) => item.code === model)?.display_name || model || ts("出图模型");

  return (
    <div className="relative z-20 shrink-0 px-3 pb-2.5 pt-1 sm:px-6 sm:pb-5 sm:pt-2">
      {/* 特性标签：置于输入区块上方 */}
      {featureTags?.length ? (
        <div className="mx-auto mb-1.5 flex w-full max-w-[1040px] flex-wrap justify-center gap-1.5">
          {featureTags.map((tag) => <span key={tag} className="rounded-full border border-fuchsia-100 bg-white/60 px-2.5 py-0.5 text-[10px] text-fuchsia-600 dark:border-fuchsia-400/20 dark:bg-white/5 dark:text-fuchsia-300">{ts(tag)}</span>)}
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-[1040px]">
        {error && <p className="mb-2 px-1 text-sm text-red-500">{error.includes("Failed to fetch") || error.includes("fetch failed") ? ts("无法连接到 API 服务，请先启动后端服务后重试。") : error}</p>}
        <div className="soft-input overflow-hidden">
          {/* 上排参数栏：资产库首位 / 写真类型 /（非证件照）风格倾向 /（证件照）底色 / 玩法说明 */}
          <div className="border-b border-gray-50 px-3 py-2 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
                {/* 资产库引入：与电商一键出图同款组件，置于上排第一个位置 */}
                <ChatTopTools
                  value={bottom}
                  onChange={setBottom}
                  showUpload={false}
                  showRole={false}
                  referencePickMode
                  referenceImages={photo ? [photo] : []}
                  onReferenceImagesChange={(images) => { setPhoto(images[0] || null); setUploadError(""); }}
                  maxReferenceImages={1}
                  assetLibraryLabel={ts("资产库")}
                />
                <MediaOptionMenu icon={<Camera size={15} />} activeLabel={ts(photoType)} title={ts("写真类型")} subtitle={ts("选择本次拍摄的用途与构图方向")} compactOnMobile>
                  {(close) => (
                    <div className="space-y-2">
                      {PHOTO_TYPES.map((item) => (
                        <MediaMenuOption key={item} selected={photoType === item} onClick={() => { setPhotoType(item); close(); }}>{ts(item)}</MediaMenuOption>
                      ))}
                    </div>
                  )}
                </MediaOptionMenu>
                {photoType !== "证件照" && (
                  <MediaOptionMenu icon={<Palette size={15} />} activeLabel={ts(style)} title={ts("风格倾向")} subtitle={ts("38种主流写真风格，决定妆造、场景与色调")} compactOnMobile menuWidth={320}>
                    {(close) => (
                      <div className="grid grid-cols-3 gap-2">
                        {STYLES.map((item) => (
                          <MediaMenuOption key={item} selected={style === item} onClick={() => { setStyle(item); close(); }}>{ts(item)}</MediaMenuOption>
                        ))}
                      </div>
                    )}
                  </MediaOptionMenu>
                )}
                {photoType === "证件照" && (
                  <MediaOptionMenu icon={<Layers size={15} />} activeLabel={t("{background}底", { background: ts(idBackground) })} title={ts("证件照底色")} subtitle={ts("标准证件色值：蓝底 RGB(67,142,219)、红底 RGB(255,0,0)、白底纯白，适用于求职、结婚登记等审核场景")} compactOnMobile>
                    {(close) => (
                      <div className="space-y-2">
                        {ID_BACKGROUNDS.map((item) => (
                          <MediaMenuOption key={item} selected={idBackground === item} onClick={() => { setIdBackground(item); close(); }}>{ts(item)}</MediaMenuOption>
                        ))}
                      </div>
                    )}
                  </MediaOptionMenu>
                )}
              </div>
              <button type="button" onClick={() => setGuideOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5 sm:px-2.5"><HelpCircle size={15} />{ts("玩法说明")}</button>
            </div>
          </div>

          {/* 本人照片与文字输入同一行，高度与AI小说工坊输入区保持一致 */}
          <div className="flex min-h-[112px] items-start gap-3 px-3 py-3">
            {photo ? (
              <div className="group/img relative h-16 w-20 shrink-0 overflow-hidden rounded-2xl border-2 border-white bg-gray-100 shadow-lg dark:border-white/10 dark:bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img loading="lazy" decoding="async" src={photo.url} alt={ts(photo.name || "本人照片")} className="h-full w-full object-cover" />
                <button type="button" onClick={() => setPhoto(null)} className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover/img:opacity-100" title={ts("移除照片")}>
                  <X size={12} />
                </button>
              </div>
            ) : (
              <label className="relative flex h-16 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border border-dashed border-gray-200 bg-white text-[10px] text-gray-400 shadow-sm transition hover:border-fuchsia-300 hover:bg-fuchsia-50/40 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:border-fuchsia-400/40 dark:hover:bg-fuchsia-400/5">
                {uploading ? <Loader2 size={18} className="animate-spin text-fuchsia-400" /> : <Upload size={18} className="text-gray-400 dark:text-gray-300" />}
                <span className="px-1 text-center leading-tight">{uploading ? ts("上传中…") : ts("上传本人照片")}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading} onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
            )}
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder={ts("可选：补充服装、场景、动作或氛围要求，例如穿白色连衣裙、回眸微笑……")} className="min-h-[88px] min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-relaxed text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500" />
          </div>
          {uploadError && <div className="px-3 pb-1.5 text-xs text-red-500">{uploadError}</div>}

          {/* 底栏：出图模型 / 生成张数 / 发送 */}
          <div className="flex items-center gap-2 overflow-x-auto border-t border-gray-50 px-3 py-3 dark:border-white/10">
            <MediaOptionMenu icon={<ImageIcon size={15} />} activeLabel={modelLabel} title={ts("出图模型")} subtitle={ts("选择负责写真生成的图片大模型")} compactOnMobile menuWidth={260}>
              {(close) => (
                <div className="space-y-2">
                  {models.length === 0 ? <div className="px-2 py-3 text-center text-xs text-gray-400">{ts("暂无可用的图片模型")}</div> : models.map((item) => (
                    <MediaMenuOption key={item.code} selected={model === item.code} onClick={() => { setModel(item.code); close(); }}>{item.display_name || item.code}</MediaMenuOption>
                  ))}
                </div>
              )}
            </MediaOptionMenu>
            <MediaOptionMenu icon={<Layers size={15} />} activeLabel={t("{count} 张", { count })} title={ts("生成张数")} subtitle={ts("一次拍摄产出的写真数量")} compactOnMobile>
              {(close) => (
                <div className="space-y-2">
                  {COUNTS.map((item) => (
                    <MediaMenuOption key={item} selected={count === item} onClick={() => { setCount(item); close(); }}>{t("{count} 张", { count: item })}</MediaMenuOption>
                  ))}
                </div>
              )}
            </MediaOptionMenu>
            <button type="button" onClick={submit} disabled={!photo || uploading || submitting} className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-white shadow-md disabled:opacity-40">{submitting ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={19} />}</button>
          </div>
        </div>
      </div>

      <PhotoPlayGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
