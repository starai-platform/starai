export const CATEGORIES = [
  { code: "all", label: "\u5168\u90e8", labelKey: "nav.all" },
  { code: "chat", label: "\u804a\u5929", labelKey: "nav.chat" },
  { code: "image", label: "\u56fe\u7247", labelKey: "nav.image" },
  { code: "video", label: "\u89c6\u9891", labelKey: "nav.video" },
  { code: "audio", label: "\u97f3\u9891", labelKey: "nav.audio" },
  { code: "mine", label: "\u6211\u7684", labelKey: "nav.mine" },
] as const;

export const CATEGORY_TAG: Record<string, { label: string; labelKey: string; className: string }> = {
  chat: { label: "\u804a\u5929", labelKey: "nav.chat", className: "bg-blue-50 text-blue-600" },
  multi_collab: { label: "\u591a\u6a21\u578b", labelKey: "category.multiCollab", className: "bg-indigo-50 text-indigo-600" },
  image: { label: "\u56fe\u7247", labelKey: "nav.image", className: "bg-emerald-50 text-emerald-600" },
  video: { label: "\u89c6\u9891", labelKey: "nav.video", className: "bg-purple-50 text-purple-600" },
  audio: { label: "\u97f3\u9891", labelKey: "nav.audio", className: "bg-orange-50 text-orange-600" },
};

export const MODEL_ICONS: Record<string, string> = {
  chat: "\u{1F4AC}",
  multi_collab: "\u{1F916}",
  image: "\u{1F5BC}\uFE0F",
  video: "\u{1F3AC}",
  audio: "\u{1F3B5}",
};

export const AGENT_CATEGORIES = [
  { code: "all", label: "\u5168\u90e8", labelKey: "nav.all" },
  { code: "image", label: "\u56fe\u7247", labelKey: "nav.image" },
  { code: "video", label: "\u89c6\u9891", labelKey: "nav.video" },
  { code: "multi_collab", label: "\u591a\u6a21\u578b", labelKey: "category.multiCollab" },
  { code: "api", label: "API", labelKey: "category.api" },
] as const;

export const AGENT_CATEGORY_TAG: Record<string, { label: string; labelKey: string; className: string }> = {
  image: { label: "\u56fe\u7247", labelKey: "nav.image", className: "bg-emerald-50 text-emerald-600" },
  video: { label: "\u89c6\u9891", labelKey: "nav.video", className: "bg-purple-50 text-purple-600" },
  multi_collab: { label: "\u591a\u6a21\u578b", labelKey: "category.multiCollab", className: "bg-indigo-50 text-indigo-600" },
  api: { label: "API", labelKey: "category.api", className: "bg-sky-50 text-sky-600" },
  workflow: { label: "\u901a\u7528", labelKey: "category.workflow", className: "bg-gray-100 text-gray-500" },
};

// Hero gradient themes for the agent workspace banner.
export const AGENT_THEMES: Record<string, { gradient: string; iconBg: string; pill: string; accent: string }> = {
  amber: {
    gradient: "from-amber-50 via-orange-50 to-white",
    iconBg: "bg-amber-100 text-amber-600",
    pill: "bg-amber-100/70 text-amber-700",
    accent: "text-amber-600",
  },
  rose: {
    gradient: "from-rose-50 via-pink-50 to-white",
    iconBg: "bg-rose-100 text-rose-600",
    pill: "bg-rose-100/70 text-rose-700",
    accent: "text-rose-600",
  },
  violet: {
    gradient: "from-violet-50 via-purple-50 to-white",
    iconBg: "bg-violet-100 text-violet-600",
    pill: "bg-violet-100/70 text-violet-700",
    accent: "text-violet-600",
  },
  sky: {
    gradient: "from-sky-50 via-blue-50 to-white",
    iconBg: "bg-sky-100 text-sky-600",
    pill: "bg-sky-100/70 text-sky-700",
    accent: "text-sky-600",
  },
  emerald: {
    gradient: "from-emerald-50 via-teal-50 to-white",
    iconBg: "bg-emerald-100 text-emerald-600",
    pill: "bg-emerald-100/70 text-emerald-700",
    accent: "text-emerald-600",
  },
};

export const FEATURE_CARDS = [
  {
    titleKey: "workspace.feature.multiView.title",
    descKey: "workspace.feature.multiView.desc",
    icon: "\u{1F310}",
    color: "bg-amber-50 text-amber-600",
  },
  {
    titleKey: "workspace.feature.fusion.title",
    descKey: "workspace.feature.fusion.desc",
    icon: "\u2728",
    color: "bg-purple-50 text-purple-600",
  },
  {
    titleKey: "workspace.feature.parallel.title",
    descKey: "workspace.feature.parallel.desc",
    icon: "\u26A1",
    color: "bg-blue-50 text-blue-600",
  },
  {
    titleKey: "workspace.feature.quality.title",
    descKey: "workspace.feature.quality.desc",
    icon: "\u{1F6E1}\uFE0F",
    color: "bg-pink-50 text-pink-600",
  },
];
