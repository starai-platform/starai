"use client";

import { useEffect, useState } from "react";
import { adminApi, adminUploadFile } from "@/lib/api";
import { UI_TRANSLATION_KEYS, UI_TRANSLATION_ZH_LABELS, type UITranslationOverride } from "@starai/shared-types";

interface UILanguageRow {
  code: string;
  short: string;
  name: string;
  flag: string;
  flag_url?: string;
  enabled: boolean;
  sort_order: number;
}

interface UITranslationRow {
  locale: string;
  key: string;
  value: string;
  enabled: boolean;
}

type TranslationSourceLabels = Record<string, string>;

interface ChangelogEntry {
  version: string;
  date?: string;
  items: string[];
}

interface TranslationImportStats {
  total: number;
  imported: number;
  emptyValues: number;
  localeCounts: Record<string, number>;
  zhCNRows: number;
  enUSChineseValues: number;
  nonTargetRows: number;
}

interface ConfigItem {
  key: string;
  label: string;
  type: "text" | "number" | "checkbox" | "password" | "textarea";
  hint?: string;
}

const BASE_ITEMS: ConfigItem[] = [
  { key: "payment_enabled", label: "在线支付", type: "checkbox" },
  { key: "card_recharge_enabled", label: "卡密充值", type: "checkbox" },
];

const MEMBER_ITEMS: ConfigItem[] = [
  { key: "site_base_url", label: "前台站点地址", type: "text", hint: "OAuth 登录完成后的前台地址，例如 https://starai.example.com" },
  { key: "signup_bonus", label: "注册赠送算力", type: "number", hint: "新用户注册赠送的算力，0 表示不赠送。" },
  { key: "image_captcha_enabled", label: "启用图形验证码", type: "checkbox", hint: "关闭后，前台登录和注册/邮箱验证码获取不再显示或校验图形验证码。" },
];

const STORAGE_ITEMS: ConfigItem[] = [
  { key: "storage_endpoint", label: "Endpoint 地址", type: "text", hint: "S3 兼容地址，不要带 http:// 或 https://。如 localhost:9000、account.r2.cloudflarestorage.com、storage.googleapis.com" },
  { key: "storage_access_key", label: "Access Key", type: "text" },
  { key: "storage_secret_key", label: "Secret Key", type: "password" },
  { key: "storage_bucket", label: "Bucket 名称", type: "text" },
  { key: "storage_public_url", label: "公开访问域名", type: "text", hint: "如 https://cdn.example.com。留空时按 Endpoint 自动生成。" },
  { key: "storage_use_ssl", label: "使用 HTTPS/SSL", type: "checkbox" },
  { key: "work_retention_days", label: "作品自动删除天数", type: "number", hint: "0 表示永久保留。大于 0 时，新作品会写入过期时间，清理任务会删除记录和对象存储文件。" },
];

interface SmtpProvider {
  value: string;
  label: string;
  host: string;
  port: number;
  ssl: boolean;
  passLabel: string;
  hint: string;
}

const SMTP_PERSONAL: SmtpProvider[] = [
  { value: "qq", label: "QQ 邮箱", host: "smtp.qq.com", port: 465, ssl: true, passLabel: "授权码", hint: "QQ 邮箱需要在网页端开启 POP3/SMTP 服务，并使用授权码作为密码。" },
  { value: "163", label: "163 邮箱", host: "smtp.163.com", port: 465, ssl: true, passLabel: "授权码", hint: "163 邮箱需开启 SMTP/IMAP 服务，并使用授权码。" },
  { value: "126", label: "126 邮箱", host: "smtp.126.com", port: 465, ssl: true, passLabel: "授权码", hint: "126 邮箱需开启 SMTP 服务后填写授权码。" },
  { value: "gmail", label: "Gmail（个人）", host: "smtp.gmail.com", port: 465, ssl: true, passLabel: "应用专用密码", hint: "需开启两步验证后生成应用专用密码。国内服务器可能无法直连 Gmail。" },
];

const SMTP_ENTERPRISE: SmtpProvider[] = [
  { value: "exmail", label: "腾讯企业邮", host: "smtp.exmail.qq.com", port: 465, ssl: true, passLabel: "客户端专用密码", hint: "企业邮开启安全登录时请使用客户端专用密码。" },
  { value: "aliyun", label: "阿里企业邮箱", host: "smtp.qiye.aliyun.com", port: 465, ssl: true, passLabel: "登录密码", hint: "按企业邮箱安全策略填写登录密码或专用密码。" },
  { value: "netease_qiye", label: "网易企业邮箱", host: "smtp.qiye.163.com", port: 465, ssl: true, passLabel: "授权码/登录密码", hint: "按网易企业邮箱 SMTP 设置填写。" },
  { value: "ms365", label: "Microsoft 365 / Outlook", host: "smtp.office365.com", port: 587, ssl: false, passLabel: "密码/应用密码", hint: "使用 587 端口 + STARTTLS，租户需允许 SMTP AUTH。" },
  { value: "gworkspace", label: "Google Workspace", host: "smtp.gmail.com", port: 465, ssl: true, passLabel: "应用专用密码", hint: "管理员需允许 SMTP，账号开启两步验证后生成应用专用密码。" },
  { value: "custom", label: "自定义 / 其他服务商", host: "", port: 465, ssl: true, passLabel: "密码/授权码", hint: "按服务商文档填写主机、端口、加密方式和凭据。" },
];

const ALL_SMTP_PROVIDERS = [...SMTP_PERSONAL, ...SMTP_ENTERPRISE];

const OAUTH_GROUPS = [
  { provider: "google", label: "Google 一键登录", callbackHint: "Google Cloud Console 回调地址：{API地址}/api/auth/oauth/google/callback" },
  { provider: "github", label: "GitHub 一键登录", callbackHint: "GitHub OAuth App 回调地址：{API地址}/api/auth/oauth/github/callback" },
];

const STORAGE_PRESETS = [
  { value: "local", label: "本地存储", endpoint: "", ssl: false, hint: "开发测试默认选项，无需填写对象存储参数；文件保存在 API 服务本地 data/uploads 目录。" },
  { value: "minio", label: "MinIO / 自建 S3", endpoint: "", ssl: false, hint: "本地 Docker MinIO 可留空，API 会自动读取 .env / 容器环境变量；生产环境再按实际 S3 信息填写。" },
  { value: "", label: "手动配置", endpoint: "", ssl: true, hint: "适用于自定义 S3 兼容服务。" },
  { value: "cloudflare_r2", label: "Cloudflare R2", endpoint: "accountid.r2.cloudflarestorage.com", ssl: true, hint: "把 accountid 替换成 Cloudflare 账号 ID，并配置公开域名或 R2 自定义域名。" },
  { value: "aws_s3", label: "AWS S3", endpoint: "s3.amazonaws.com", ssl: true, hint: "也可填写区域 Endpoint，例如 s3.us-east-1.amazonaws.com。" },
  { value: "google_s3", label: "Google Cloud Storage（S3 兼容）", endpoint: "storage.googleapis.com", ssl: true, hint: "使用 Google Cloud Storage 的 HMAC Key 接入。" },
];

const DEFAULT_UI_LANGUAGES: UILanguageRow[] = [
  { code: "zh-CN", short: "ZH", name: "中文", flag: "🇨🇳", flag_url: "/assets/comic-styles/cn.png", enabled: true, sort_order: 10 },
  { code: "en-US", short: "EN", name: "English", flag: "🇺🇸", flag_url: "/assets/comic-styles/us.png", enabled: true, sort_order: 20 },
  { code: "ja-JP", short: "JA", name: "日本語", flag: "🇯🇵", flag_url: "/assets/comic-styles/jp.png", enabled: true, sort_order: 30 },
  { code: "ko-KR", short: "KO", name: "한국어", flag: "🇰🇷", flag_url: "/assets/comic-styles/kr.png", enabled: true, sort_order: 40 },
  { code: "vi-VN", short: "VI", name: "Tiếng Việt", flag: "🇻🇳", flag_url: "/assets/comic-styles/vn.png", enabled: true, sort_order: 50 },
];

function normalizeUILanguageRows(value: unknown): UILanguageRow[] {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_UI_LANGUAGES;
  const rows = source
    .map((item: any, idx) => {
      const code = String(item?.code || "").trim();
      const defaults = DEFAULT_UI_LANGUAGES.find((lang) => lang.code === code);
      return {
        code,
        short: String(item?.short || defaults?.short || "").trim().toUpperCase(),
        name: String(item?.name || defaults?.name || "").trim(),
        flag: String(item?.flag || defaults?.flag || "🌐").trim() || defaults?.flag || "🌐",
        flag_url: String(item?.flag_url || defaults?.flag_url || "").trim() || undefined,
        enabled: item?.enabled !== false,
        sort_order: Number(item?.sort_order ?? defaults?.sort_order ?? (idx + 1) * 10) || (idx + 1) * 10,
      };
    })
    .filter((item) => item.code && item.short && item.name);
  return rows.length ? rows : DEFAULT_UI_LANGUAGES;
}

function normalizeTranslationRows(value: unknown): UITranslationRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => ({
      locale: String(item?.locale || "").trim(),
      key: String(item?.key || "").trim(),
      value: String(item?.value || ""),
      enabled: item?.enabled !== false,
    }))
    .filter((item) => item.locale && item.key);
}

function hasCJKText(value: unknown) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ""));
}

function isEmptyTranslationValue(value: unknown) {
  return !String(value || "").trim();
}

function cleanupTranslationRows(rows: UITranslationRow[]) {
  let removedZhCN = 0;
  let removedEnChinese = 0;
  let removedEmpty = 0;
  const seen = new Map<string, UITranslationRow>();
  for (const row of rows) {
    const locale = row.locale.trim();
    const key = row.key.trim();
    const value = row.value.trim();
    if (!locale || !key) continue;
    if (!value) {
      removedEmpty++;
      continue;
    }
    if (locale === "zh-CN") {
      removedZhCN++;
      continue;
    }
    if (locale === "en-US" && hasCJKText(value)) {
      removedEnChinese++;
      continue;
    }
    seen.set(`${locale}\u0000${key}`, { locale, key, value, enabled: row.enabled !== false });
  }
  return {
    rows: Array.from(seen.values()),
    removedZhCN,
    removedEnChinese,
    removedEmpty,
  };
}

function analyzeTranslationRows(rows: UITranslationRow[], targetLocale: string): TranslationImportStats {
  const localeCounts: Record<string, number> = {};
  let emptyValues = 0;
  let zhCNRows = 0;
  let enUSChineseValues = 0;
  let nonTargetRows = 0;
  rows.forEach((row) => {
    const locale = row.locale.trim();
    localeCounts[locale] = (localeCounts[locale] || 0) + 1;
    if (isEmptyTranslationValue(row.value)) emptyValues++;
    if (locale === "zh-CN") zhCNRows++;
    if (locale === "en-US" && hasCJKText(row.value)) enUSChineseValues++;
    if (targetLocale && locale !== targetLocale) nonTargetRows++;
  });
  return {
    total: rows.length,
    imported: rows.length - emptyValues,
    emptyValues,
    localeCounts,
    zhCNRows,
    enUSChineseValues,
    nonTargetRows,
  };
}

function mergeTranslationRows(current: UITranslationRow[], incoming: UITranslationRow[]) {
  const merged = new Map<string, UITranslationRow>();
  current.forEach((row) => {
    const locale = row.locale.trim();
    const key = row.key.trim();
    if (locale && key) merged.set(`${locale}\u0000${key}`, { ...row, locale, key });
  });
  incoming.forEach((row) => {
    const locale = row.locale.trim();
    const key = row.key.trim();
    if (locale && key) merged.set(`${locale}\u0000${key}`, { locale, key, value: row.value, enabled: row.enabled !== false });
  });
  return Array.from(merged.values());
}

export default function SystemConfigPage() {
  const [configs, setConfigs] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [faviconUploading, setFaviconUploading] = useState(false);
  const [supportUploading, setSupportUploading] = useState(false);
  const [supportAvatarUploading, setSupportAvatarUploading] = useState(false);
  const [supportFloatingUploading, setSupportFloatingUploading] = useState(false);
  const [uiLanguageOpen, setUiLanguageOpen] = useState(false);
  const [uiLanguageRows, setUiLanguageRows] = useState<UILanguageRow[]>(DEFAULT_UI_LANGUAGES);
  const [uiLanguageErr, setUiLanguageErr] = useState("");
  const [translationOpen, setTranslationOpen] = useState(false);
  const [translationRows, setTranslationRows] = useState<UITranslationRow[]>([]);
  const [translationLocale, setTranslationLocale] = useState("en-US");
  const [translationSearch, setTranslationSearch] = useState("");
  const [translationErr, setTranslationErr] = useState("");
  const [translationMsg, setTranslationMsg] = useState("");
  const [translationSaving, setTranslationSaving] = useState(false);
  const [translationFilling, setTranslationFilling] = useState(false);
  const [translationSourceLabels, setTranslationSourceLabels] = useState<TranslationSourceLabels>({});
  const [versionOpen, setVersionOpen] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [changelogErr, setChangelogErr] = useState("");

  useEffect(() => {
    adminApi<Record<string, unknown>>("/system-configs").then((cfg) => {
      const customerServiceEnabled =
        cfg.customer_service_enabled === undefined
          ? true
          : !(
              cfg.customer_service_enabled === false ||
              cfg.customer_service_enabled === 0 ||
              String(cfg.customer_service_enabled).toLowerCase() === "false"
            );
      setConfigs({
        customer_service_title: "联系客服",
        customer_service_name: "在线客服",
        customer_service_subtitle: "我们随时为您服务",
        customer_service_qr_tip: "长按或扫码添加微信",
        terms_title: "服务协议",
        terms_content: "",
        privacy_title: "隐私政策",
        privacy_content: "",
        home_meta_title: "",
        home_meta_description: "",
        email_provider: "smtp",
        ...cfg,
        customer_service_enabled: customerServiceEnabled,
        image_captcha_enabled: cfg.image_captcha_enabled === undefined ? true : !(cfg.image_captcha_enabled === false || cfg.image_captcha_enabled === 0 || String(cfg.image_captcha_enabled).toLowerCase() === "false"),
      });
      setUiLanguageRows(normalizeUILanguageRows(cfg.ui_languages));
      setTranslationRows(normalizeTranslationRows(cfg.ui_translation_overrides));
    });
  }, []);

  const loadVersionInfo = async () => {
    setChangelogErr("");
    try {
      const res = await fetch("/admin/version", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rows = Array.isArray(data?.changelog) ? data.changelog : [];
      setAppVersion(String(data?.version || rows[0]?.version || ""));
      setChangelog(rows);
    } catch (err) {
      setChangelogErr(err instanceof Error ? `更新记录读取失败：${err.message}` : "更新记录读取失败");
    }
  };

  useEffect(() => {
    loadVersionInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openVersionLog = async () => {
    setVersionOpen(true);
    await loadVersionInfo();
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    setSaveErr("");
    try {
      await adminApi("/system-configs", {
        method: "PATCH",
        body: JSON.stringify(configs),
      });
      setSaved(true);
      setSaveMsg("配置已保存");
      setTimeout(() => {
        setSaved(false);
        setSaveMsg("");
      }, 3000);
    } catch (err) {
      setSaveErr(err instanceof Error ? `保存失败：${err.message}` : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const zhLabelForTranslationKey = (key: string) => translationSourceLabels[key] || UI_TRANSLATION_ZH_LABELS[key] || "";

  const loadDynamicTranslationLabels = async () => {
    const labels: TranslationSourceLabels = {};
    const put = (key: string, value: unknown) => {
      const text = String(value ?? "").trim();
      if (key && text) labels[key] = text;
    };

    try {
      const modelResp = await adminApi<any[] | { items?: any[] }>("/models");
      const models = Array.isArray(modelResp) ? modelResp : modelResp.items || [];
      models.forEach((model) => {
        const code = String(model?.code || model?.model_code || "").trim();
        if (!code) return;
        put(`model.${code}.name`, model?.display_name || model?.name);
        put(`model.${code}.description`, model?.description);
        (Array.isArray(model?.tags) ? model.tags : []).forEach((tag: unknown) => put(`model.${code}.tag.${String(tag)}`, tag));
      });
    } catch {
      /* optional source */
    }

    try {
      const agentResp = await adminApi<any[] | { items?: any[] }>("/agents");
      const agents = Array.isArray(agentResp) ? agentResp : agentResp.items || [];
      agents.forEach((agent) => {
        const code = String(agent?.code || "").trim();
        if (!code) return;
        put(`agent.${code}.name`, agent?.name);
        put(`agent.${code}.description`, agent?.description);
        const display = agent?.display_config || {};
        [...(display.hero_tags || []), ...(display.feature_tags || [])].forEach((tag: unknown) => put(`agent.${code}.tag.${String(tag)}`, tag));
        (Array.isArray(display.steps) ? display.steps : []).forEach((step: any, idx: number) => {
          put(`agent.${code}.step.${idx}.title`, step?.title);
          put(`agent.${code}.step.${idx}.subtitle`, step?.subtitle);
          (Array.isArray(step?.tags) ? step.tags : []).forEach((tag: unknown) => put(`agent.${code}.step.${idx}.tag.${String(tag)}`, tag));
        });
      });
    } catch {
      /* optional source */
    }

    try {
      const res = await fetch("/api/gallery/tags", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        (data?.data?.items || data?.items || []).forEach((tag: any) => {
          const slug = String(tag?.slug || "").trim();
          if (slug && slug !== "all") put(`gallery.tag.${slug}`, tag?.name || slug);
        });
      }
    } catch {
      /* optional source */
    }

    try {
      const gallery = await adminApi<{ items?: any[] }>("/gallery?page=1&page_size=200");
      (gallery.items || []).forEach((item) => {
        put(`gallery.category.${String(item?.category || "")}`, item?.category);
        (Array.isArray(item?.tags) ? item.tags : []).forEach((tag: unknown) => put(`gallery.tag.${String(tag)}`, tag));
      });
    } catch {
      /* optional source */
    }

    try {
      const homeCards = await adminApi<{ items?: any[] }>("/home/cards");
      (homeCards.items || []).forEach((card) => {
        const key = String(card?.key || "").trim();
        if (!key) return;
        put(`homeCard.${key}.title`, card?.title);
        put(`homeCard.${key}.description`, card?.description);
      });
    } catch {
      /* optional source */
    }

    setTranslationSourceLabels((prev) => ({ ...prev, ...labels }));
    return labels;
  };

  const saveTranslationOverrides = async (rows = translationRows) => {
    const cleaned = cleanupTranslationRows(rows);
    const payload: UITranslationOverride[] = cleaned.rows.map((row) => ({
      locale: row.locale,
      key: row.key,
      value: row.value,
      enabled: row.enabled !== false,
    }));
    setTranslationSaving(true);
    setTranslationErr("");
    setTranslationMsg("");
    try {
      setConfigs((prev) => ({ ...prev, ui_translation_overrides: payload }));
      await adminApi("/system-configs", { method: "PATCH", body: JSON.stringify({ ui_translation_overrides: payload }) });
      setTranslationRows(cleaned.rows);
      const removed = cleaned.removedZhCN + cleaned.removedEnChinese + cleaned.removedEmpty;
      setTranslationMsg(`保存成功，共 ${payload.length} 条${removed ? `；已过滤 ${removed} 条无效/反向覆盖` : ""}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setTranslationErr(err instanceof Error ? `保存失败：${err.message}` : "保存失败");
    } finally {
      setTranslationSaving(false);
    }
  };

  const fillMissingTranslationKeys = async () => {
    setTranslationFilling(true);
    setTranslationErr("");
    setTranslationMsg("");
    try {
      const dynamicLabels = await loadDynamicTranslationLabels();
    const locale = translationLocale || uiLanguageRows[0]?.code || "en-US";
    const existing = new Set(translationRows.filter((row) => row.locale === locale).map((row) => row.key));
      const allKeys = Array.from(new Set<string>([...UI_TRANSLATION_KEYS, ...Object.keys(dynamicLabels), ...Object.keys(translationSourceLabels)]));
    const additions = allKeys.filter((key) => !existing.has(key)).map((key) => ({
      locale,
      key,
      value: "",
      enabled: true,
    }));
      if (additions.length) setTranslationRows((prev) => [...prev, ...additions]);
      setTranslationMsg(`已补齐 ${additions.length} 个空项`);
    } catch (err) {
      setTranslationErr(err instanceof Error ? err.message : "补齐失败");
    } finally {
      setTranslationFilling(false);
    }
  };

  const exportTranslations = () => {
    const targetLocale = translationLocale || "en-US";
    const sourceRows = translationRows.filter((row) => row.locale === targetLocale);
    const rows = sourceRows.map((row) => ({
      locale: row.locale,
      key: row.key,
      zh_label: zhLabelForTranslationKey(row.key),
      value: targetLocale === "zh-CN" ? "" : row.value,
      enabled: row.enabled,
    }));
    if (targetLocale === "zh-CN") {
      setTranslationMsg("中文界面默认使用内置中文和后台原文，导出的中文 JSON 仅建议用于审校，不建议导入保存。");
    }
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ui_translation_overrides.${targetLocale}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTranslations = async (file?: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rows = normalizeTranslationRows(parsed);
      if (!rows.length && Array.isArray(parsed) && parsed.length) throw new Error("JSON 结构无效");
      const targetLocale = translationLocale || "en-US";
      const stats = analyzeTranslationRows(rows, targetLocale);
      if (targetLocale === "en-US" && (stats.zhCNRows > 0 || stats.enUSChineseValues > 0)) {
        throw new Error(`导入方向疑似错误：发现 ${stats.zhCNRows} 条 zh-CN 记录、${stats.enUSChineseValues} 条 en-US 中文 value。英文词典只能导入 en-US 英文 value，请不要导入 cn.json。`);
      }
      if (targetLocale === "zh-CN") {
        throw new Error("中文界面默认使用内置中文和后台原文，一般不需要导入中文覆盖。请只把英文 JSON 导入到 en-US。");
      }
      const validRows = rows.filter((row) => row.locale === targetLocale && !isEmptyTranslationValue(row.value));
      if (!validRows.length) throw new Error(`没有可导入的 ${targetLocale} 有效翻译值。`);
      setTranslationRows((prev) => mergeTranslationRows(prev, validRows));
      setTranslationErr("");
      setTranslationMsg(`已导入 ${validRows.length} 条 ${targetLocale} 翻译，空值 ${stats.emptyValues} 条、非当前语言 ${stats.nonTargetRows} 条已跳过，保存后生效。`);
    } catch (err) {
      setTranslationErr(err instanceof Error ? err.message : "导入失败");
      setTranslationMsg("");
    }
  };

  const cleanupCurrentTranslations = () => {
    const cleaned = cleanupTranslationRows(translationRows);
    setTranslationRows(cleaned.rows);
    const removed = cleaned.removedZhCN + cleaned.removedEnChinese + cleaned.removedEmpty;
    setTranslationErr("");
    setTranslationMsg(`已清理 ${removed} 条：zh-CN 覆盖 ${cleaned.removedZhCN} 条，en-US 中文 value ${cleaned.removedEnChinese} 条，空 value ${cleaned.removedEmpty} 条。请点击“保存词典”生效。`);
  };

  const smtpProvider = ALL_SMTP_PROVIDERS.find((p) => p.value === String(configs.smtp_provider ?? "")) || null;
  const emailProvider = String(configs.email_provider ?? "smtp") || "smtp";
  const publicBaseURL = String(configs.site_base_url || "").replace(/\/+$/, "");
  const termsURL = publicBaseURL ? `${publicBaseURL}/terms` : "/terms";
  const privacyURL = publicBaseURL ? `${publicBaseURL}/privacy` : "/privacy";
  const storageProvider = String(configs.storage_provider ?? "local");
  const storagePreset = STORAGE_PRESETS.find((p) => p.value === storageProvider) || STORAGE_PRESETS[0];
  const storageUsesEnv = storageProvider === "local" || storageProvider === "minio";

  const setField = (key: string, value: unknown) => {
    setConfigs((prev) => ({ ...prev, [key]: value }));
  };

  const saveUILanguages = async () => {
    const rows = normalizeUILanguageRows(uiLanguageRows);
    setUiLanguageErr("");
    setConfigs((prev) => ({ ...prev, ui_languages: rows }));
    await adminApi("/system-configs", { method: "PATCH", body: JSON.stringify({ ui_languages: rows }) });
    setSaved(true);
    setUiLanguageOpen(false);
    setTimeout(() => setSaved(false), 2000);
  };

  const uploadLanguageFlag = async (idx: number, file?: File | null) => {
    if (!file) return;
    const url = await adminUploadFile(file);
    setUiLanguageRows((prev) => prev.map((item, i) => i === idx ? { ...item, flag_url: url } : item));
  };

  const applySmtpProvider = (value: string) => {
    const p = ALL_SMTP_PROVIDERS.find((x) => x.value === value);
    setConfigs((prev) => ({
      ...prev,
      smtp_provider: value,
      ...(p?.host ? { smtp_host: p.host } : {}),
      ...(p ? { smtp_port: p.port, smtp_ssl: p.ssl } : {}),
    }));
  };

  const applyStoragePreset = (value: string) => {
    const p = STORAGE_PRESETS.find((x) => x.value === value);
    setConfigs((prev) => ({
      ...prev,
      storage_provider: value,
      ...(value === "local" || value === "minio" ? { storage_endpoint: "", storage_access_key: "", storage_secret_key: "", storage_bucket: "", storage_public_url: "" } : {}),
      ...(p?.endpoint ? { storage_endpoint: p.endpoint } : {}),
      ...(p ? { storage_use_ssl: p.ssl } : {}),
    }));
  };

  const renderItem = (item: ConfigItem, className = "") => (
    <div key={item.key} className={className}>
      <label className="text-xs text-gray-500">{item.label}</label>
      {item.type === "checkbox" ? (
        <label className="mt-2 flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={!!configs[item.key]} onChange={(e) => setField(item.key, e.target.checked)} className="rounded" />
          <span className="text-sm text-gray-700">启用</span>
        </label>
      ) : item.type === "textarea" ? (
        <textarea
          value={String(configs[item.key] ?? "")}
          onChange={(e) => setField(item.key, e.target.value)}
          className="mt-1 min-h-40 w-full rounded-lg border px-3 py-2 text-sm leading-6 focus:border-primary focus:outline-none"
        />
      ) : (
        <input
          type={item.type}
          value={String(configs[item.key] ?? "")}
          onChange={(e) => setField(item.key, item.type === "number" ? Number(e.target.value) || 0 : e.target.value)}
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
      )}
      {item.hint && <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{item.hint}</p>}
    </div>
  );

  const uploadSiteLogo = async (file?: File | null) => {
    if (!file) return;
    setLogoUploading(true);
    try {
      const url = await adminUploadFile(file);
      setField("site_logo", url);
    } finally {
      setLogoUploading(false);
    }
  };

  const uploadSiteFavicon = async (file?: File | null) => {
    if (!file) return;
    setFaviconUploading(true);
    try {
      const url = await adminUploadFile(file);
      setField("site_favicon", url);
    } finally {
      setFaviconUploading(false);
    }
  };

  const uploadSupportQR = async (file?: File | null) => {
    if (!file) return;
    setSupportUploading(true);
    try {
      const url = await adminUploadFile(file);
      setField("customer_service_qr_url", url);
    } finally {
      setSupportUploading(false);
    }
  };

  const uploadSupportImage = async (
    key: "customer_service_avatar" | "customer_service_floating_image",
    file?: File | null,
  ) => {
    if (!file) return;
    const setUploading = key === "customer_service_avatar" ? setSupportAvatarUploading : setSupportFloatingUploading;
    setUploading(true);
    try {
      const url = await adminUploadFile(file);
      setField(key, url);
    } finally {
      setUploading(false);
    }
  };

  const filteredTranslationRows = translationRows.filter((row) => {
    if (translationLocale && row.locale !== translationLocale) return false;
    const q = translationSearch.trim().toLowerCase();
    if (!q) return true;
    const zhLabel = zhLabelForTranslationKey(row.key);
    return row.key.toLowerCase().includes(q) || row.value.toLowerCase().includes(q) || zhLabel.toLowerCase().includes(q);
  });

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-950">系统配置</h1>
            <button
              type="button"
              onClick={openVersionLog}
              className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-500 shadow-sm hover:border-gray-300 hover:text-gray-900"
            >
              当前版本 {appVersion ? `v${appVersion.replace(/^v/i, "")}` : "读取中"}
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-500">把品牌展示、登录注册、对象存储、OAuth 和邮件发信集中放在这里统一维护。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setUiLanguageOpen(true)} className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
            界面语言管理
          </button>
          {/* <div className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-500 shadow-sm">保存后前台与后台品牌区域会同步读取最新配置</div> */}
        </div>
      </div>

      {versionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setVersionOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-950">更新记录</h2>
                <p className="mt-1 text-xs text-gray-400">当前版本 {appVersion ? `v${appVersion.replace(/^v/i, "")}` : "读取中"}，内容来自 apps/admin/CHANGELOG.md。</p>
              </div>
              <button type="button" onClick={() => setVersionOpen(false)} className="rounded-xl border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">关闭</button>
            </div>
            {changelogErr ? <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{changelogErr}</div> : null}
            {!changelogErr && changelog.length === 0 ? <div className="rounded-xl bg-gray-50 px-3 py-8 text-center text-sm text-gray-400">正在读取更新记录...</div> : null}
            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              {changelog.map((entry) => (
                <div key={`${entry.version}-${entry.date || ""}`} className="rounded-2xl border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-gray-950">v{entry.version.replace(/^v/i, "")}</div>
                    {entry.date ? <div className="text-xs text-gray-400">{entry.date}</div> : null}
                  </div>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                    {entry.items.length ? entry.items.map((item) => <li key={item}>- {item}</li>) : <li>- 暂无更新说明。</li>}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {uiLanguageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setUiLanguageOpen(false)}>
          <div className="w-full max-w-5xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-950">界面语言管理</h2>
                <p className="mt-1 text-xs leading-5 text-gray-400">这里仅控制前台 UI 界面语言，和模型管理里的“生成语言”不是同一个功能。新增语言需要前端内置词典后才会展示给用户。</p>
              </div>
              <button type="button" onClick={() => setUiLanguageOpen(false)} className="rounded-xl border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">关闭</button>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setTranslationOpen(true)} className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-semibold text-white">翻译词典管理</button>
              <span className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">前台优先使用后台覆盖词典；空值不会覆盖内置词典。</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">国旗图片</th>
                    <th className="px-3 py-2 text-left">国旗符号</th>
                    <th className="px-3 py-2 text-left">Locale</th>
                    <th className="px-3 py-2 text-left">简称</th>
                    <th className="px-3 py-2 text-left">显示名称</th>
                    <th className="px-3 py-2 text-left">排序</th>
                    <th className="px-3 py-2 text-left">启用</th>
                    <th className="px-3 py-2 text-left">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {uiLanguageRows.map((row, idx) => (
                    <tr key={`${row.code}-${idx}`}>
                      <td className="px-3 py-2">
                        <div className="flex min-w-[150px] items-center gap-2">
                          <div className="flex h-8 w-11 items-center justify-center overflow-hidden rounded-lg border bg-gray-50 text-lg">
                            {row.flag_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={row.flag_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              row.flag || "🌐"
                            )}
                          </div>
                          <label className="cursor-pointer rounded-lg border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                            上传
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              className="hidden"
                              onChange={(e) => {
                                uploadLanguageFlag(idx, e.target.files?.[0]);
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                          {row.flag_url && (
                            <button type="button" onClick={() => setUiLanguageRows((prev) => prev.map((item, i) => i === idx ? { ...item, flag_url: "" } : item))} className="text-xs text-gray-400 hover:text-red-500">
                              清除
                            </button>
                          )}
                        </div>
                      </td>
                      {(["flag", "code", "short", "name", "sort_order"] as const).map((field) => (
                        <td key={field} className="px-3 py-2">
                          <input
                            type={field === "sort_order" ? "number" : "text"}
                            value={String(row[field])}
                            onChange={(e) => {
                              const value = field === "sort_order" ? Number(e.target.value) || 0 : e.target.value;
                              setUiLanguageRows((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
                            }}
                            className="w-full rounded-lg border px-2 py-1.5 text-sm"
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={row.enabled} onChange={(e) => setUiLanguageRows((prev) => prev.map((item, i) => (i === idx ? { ...item, enabled: e.target.checked } : item)))} />
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setUiLanguageRows((prev) => prev.filter((_, i) => i !== idx))} className="text-xs text-red-500 hover:underline">删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {uiLanguageErr && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{uiLanguageErr}</p>}
            <div className="mt-5 flex flex-wrap justify-between gap-3">
              <button type="button" onClick={() => setUiLanguageRows((prev) => [...prev, { code: "", short: "", name: "", flag: "🌐", flag_url: "", enabled: false, sort_order: (prev.length + 1) * 10 }])} className="rounded-xl border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">新增语言</button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setUiLanguageRows(DEFAULT_UI_LANGUAGES)} className="rounded-xl border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">恢复默认</button>
                <button type="button" onClick={saveUILanguages} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-dark">保存界面语言</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {translationOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4" onClick={() => setTranslationOpen(false)}>
          <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-gray-100 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-950">翻译词典管理</h2>
                  <p className="mt-1 text-xs leading-5 text-gray-400">这里维护前台 UI 文案覆盖值。基础词典仍在 apps/web/src/i18n/dictionaries.ts，后台覆盖优先级更高。</p>
                </div>
                <button type="button" onClick={() => setTranslationOpen(false)} className="rounded-xl border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">关闭</button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <select value={translationLocale} onChange={(e) => setTranslationLocale(e.target.value)} className="rounded-xl border px-3 py-2 text-sm">
                  {uiLanguageRows.map((lang) => (
                    <option key={lang.code} value={lang.code}>{lang.flag} {lang.short} {lang.name}</option>
                  ))}
                </select>
                <input value={translationSearch} onChange={(e) => setTranslationSearch(e.target.value)} placeholder="搜索 key / 翻译内容" className="min-w-[220px] flex-1 rounded-xl border px-3 py-2 text-sm" />
                <button type="button" disabled={translationFilling} onClick={fillMissingTranslationKeys} className="rounded-xl border px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  {translationFilling ? "补齐中..." : "补齐内置/业务 key 空项"}
                </button>
                <button type="button" onClick={cleanupCurrentTranslations} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 hover:bg-amber-100">
                  清理错误覆盖
                </button>
                <button type="button" onClick={() => setTranslationRows((prev) => [...prev, { locale: translationLocale || "en-US", key: "", value: "", enabled: true }])} className="rounded-xl border px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">新增</button>
                <button type="button" onClick={exportTranslations} className="rounded-xl border px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">导出 JSON</button>
                <label className="cursor-pointer rounded-xl border px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
                  导入 JSON
                  <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { importTranslations(e.target.files?.[0]); e.currentTarget.value = ""; }} />
                </label>
                <button type="button" disabled={translationSaving} onClick={() => saveTranslationOverrides()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-dark disabled:opacity-50">
                  {translationSaving ? "保存中..." : "保存词典"}
                </button>
              </div>
              <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-700">
                `zh_label` 只是翻译参考，不参与前台显示；`value` 才是当前 locale 的覆盖值。中文界面默认使用内置中文和后台原文，通常只需要维护 en-US / ja-JP / ko-KR / vi-VN 等非中文覆盖。不要把 cn.json 导入到 en-US。
              </div>
              {translationErr && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{translationErr}</div>}
              {translationMsg && <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{translationMsg}</div>}
            </div>
            <div className="flex-1 overflow-auto p-5">
              <table className="w-full min-w-[1120px] text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">启用</th>
                    <th className="px-3 py-2 text-left">语言</th>
                    <th className="px-3 py-2 text-left">Key</th>
                    <th className="px-3 py-2 text-left">原中文名</th>
                    <th className="px-3 py-2 text-left">翻译值</th>
                    <th className="px-3 py-2 text-left">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredTranslationRows.map((row) => {
                    const realIndex = translationRows.indexOf(row);
                    const zhLabel = zhLabelForTranslationKey(row.key);
                    return (
                      <tr key={`${row.locale}-${row.key}-${realIndex}`}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={row.enabled} onChange={(e) => setTranslationRows((prev) => prev.map((item, i) => i === realIndex ? { ...item, enabled: e.target.checked } : item))} />
                        </td>
                        <td className="px-3 py-2">
                          <select value={row.locale} onChange={(e) => setTranslationRows((prev) => prev.map((item, i) => i === realIndex ? { ...item, locale: e.target.value } : item))} className="w-full rounded-lg border px-2 py-1.5">
                            {uiLanguageRows.map((lang) => <option key={lang.code} value={lang.code}>{lang.short}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input value={row.key} onChange={(e) => setTranslationRows((prev) => prev.map((item, i) => i === realIndex ? { ...item, key: e.target.value } : item))} className="w-full rounded-lg border px-2 py-1.5 font-mono text-xs" />
                        </td>
                        <td className="px-3 py-2">
                          <div className="max-w-[260px] whitespace-pre-wrap break-words rounded-lg bg-gray-50 px-2 py-1.5 text-xs leading-5 text-gray-600">
                            {zhLabel || <span className="text-gray-300">未收录</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <textarea value={row.value} onChange={(e) => setTranslationRows((prev) => prev.map((item, i) => i === realIndex ? { ...item, value: e.target.value } : item))} className="min-h-[38px] w-full rounded-lg border px-2 py-1.5" />
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => setTranslationRows((prev) => prev.filter((_, i) => i !== realIndex))} className="text-xs text-red-500 hover:underline">删除</button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredTranslationRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-gray-400">暂无翻译项，可点击“补齐内置 key 空项”。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm shadow-gray-950/5 xl:col-span-2">
          <div className="mb-1 text-sm font-semibold text-gray-900">品牌设置</div>
          <p className="mb-5 text-xs leading-relaxed text-gray-400">这里控制用户前台、管理后台、开放 API 文档等所有带品牌 Logo 与说明文案的区域。</p>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {renderItem({ key: "site_name", label: "品牌名称", type: "text", hint: "显示在前台工作台、登录弹窗、API 文档、后台左上角等主要品牌位置。" })}
                {renderItem({ key: "site_description", label: "前台品牌描述", type: "text", hint: "显示在用户前台工作台品牌区域、登录弹窗等位置。" })}
                {renderItem({ key: "admin_site_description", label: "后台品牌描述", type: "text", hint: "显示在管理后台左上角、后台登录页等品牌副标题位置。" })}
                {renderItem({ key: "site_api_tagline", label: "API 文档描述", type: "text", hint: "显示在开放 API 文档页面的品牌副标题位置。" })}
                {renderItem({ key: "site_copyright", label: "首页版权信息", type: "text", hint: "显示在前台首页底部版权栏。留空时自动使用品牌名称生成默认版权文案。" }, "md:col-span-2")}
                {renderItem({ key: "home_meta_title", label: "首页 Title", type: "text", hint: "浏览器标签页和搜索引擎标题。留空时使用品牌名称自动生成。" })}
                {renderItem({ key: "home_meta_description", label: "首页 Description", type: "text", hint: "搜索引擎摘要描述。留空时使用前台品牌描述。" })}
              </div>

              <div>
                <label className="text-xs text-gray-500">品牌 Logo</label>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-gray-200 bg-gray-50">
                    {configs.site_logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={String(configs.site_logo)} alt="site logo" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-2xl font-bold text-gray-400">{String(configs.site_name ?? "S").slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-dark">
                      {logoUploading ? "上传中..." : "上传 Logo"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="hidden"
                        disabled={logoUploading}
                        onChange={(e) => {
                          uploadSiteLogo(e.target.files?.[0]);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button type="button" onClick={() => setField("site_logo", "")} className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                      清除
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-gray-400">建议上传正方形 Logo。未上传时，系统会自动使用品牌名称首字母作为占位图标。</p>
              </div>

              <div>
                <label className="text-xs text-gray-500">网站 favicon / ICO</label>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                    {configs.site_favicon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={String(configs.site_favicon)} alt="favicon" className="h-full w-full object-contain p-2" />
                    ) : configs.site_logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={String(configs.site_logo)} alt="favicon fallback" className="h-full w-full object-contain p-2" />
                    ) : (
                      <span className="text-lg font-bold text-gray-400">{String(configs.site_name ?? "S").slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center rounded-xl bg-gray-950 px-4 py-2 text-sm font-semibold text-white">
                      {faviconUploading ? "上传中..." : "上传 favicon"}
                      <input
                        type="file"
                        accept="image/x-icon,image/vnd.microsoft.icon,image/png,image/jpeg,image/webp,image/svg+xml"
                        className="hidden"
                        disabled={faviconUploading}
                        onChange={(e) => {
                          uploadSiteFavicon(e.target.files?.[0]);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button type="button" onClick={() => setField("site_favicon", "")} className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                      清除
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-gray-400">建议上传 32×32 或 64×64 的 ICO/PNG/SVG。未配置时前台会自动使用品牌 Logo 或默认图标。</p>
              </div>
            </div>

            <div className="rounded-3xl border border-gray-200 bg-gray-50/70 p-4">
              <div className="mb-3 text-sm font-semibold text-gray-900">实时预览</div>
              <div className="space-y-3">
                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">用户前台</div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary text-sm font-bold text-dark">
                      {configs.site_logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={String(configs.site_logo)} alt="front brand" className="h-full w-full object-cover" />
                      ) : (
                        String(configs.site_name ?? "S").slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-gray-950">{String(configs.site_name || "StarAI")}</div>
                      <div className="truncate text-sm text-gray-500">{String(configs.site_description || "AI 大模型聚合平台")}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">管理后台</div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gray-950 text-sm font-bold text-white">
                      {configs.site_logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={String(configs.site_logo)} alt="admin brand" className="h-full w-full object-cover" />
                      ) : (
                        String(configs.site_name ?? "S").slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-gray-950">{String(configs.site_name || "StarAI")} Admin</div>
                      <div className="truncate text-sm text-gray-500">{String(configs.admin_site_description || "管理后台")}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">API 文档</div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary text-sm font-bold text-dark">
                      {configs.site_logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={String(configs.site_logo)} alt="api brand" className="h-full w-full object-cover" />
                      ) : (
                        String(configs.site_name ?? "S").slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-gray-950">{String(configs.site_name || "StarAI")}</div>
                      <div className="truncate text-sm text-gray-500">{String(configs.site_api_tagline || "Open API Documentation")}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm shadow-gray-950/5 xl:col-span-2">
          <div className="mb-1 text-sm font-semibold text-gray-900">服务协议与隐私政策</div>
          <p className="mb-5 text-xs leading-relaxed text-gray-400">这里配置登录弹窗内点击展示的内容，同时生成 Google 一键登录申请时可填写的公开链接。</p>

          <div className="mb-5 grid gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-xs leading-6 text-gray-600 md:grid-cols-2">
            <div>
              <div className="font-semibold text-gray-900">服务协议链接</div>
              <a href={termsURL} target="_blank" rel="noreferrer" className="break-all text-emerald-700 hover:underline">{termsURL}</a>
            </div>
            <div>
              <div className="font-semibold text-gray-900">隐私政策链接</div>
              <a href={privacyURL} target="_blank" rel="noreferrer" className="break-all text-emerald-700 hover:underline">{privacyURL}</a>
            </div>
            <p className="text-[11px] text-gray-500 md:col-span-2">申请 Google 一键登录时，请使用完整域名链接。若这里显示的是 /terms 或 /privacy，请先在“登录与注册”里填写“前台站点地址”。</p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              {renderItem({ key: "terms_title", label: "服务协议标题", type: "text" })}
              {renderItem({ key: "terms_content", label: "服务协议内容", type: "textarea", hint: "支持换行，前台会按纯文本展示，避免脚本注入风险。" })}
            </div>
            <div className="space-y-4">
              {renderItem({ key: "privacy_title", label: "隐私政策标题", type: "text" })}
              {renderItem({ key: "privacy_content", label: "隐私政策内容", type: "textarea", hint: "支持换行，前台会按纯文本展示，避免脚本注入风险。" })}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm shadow-gray-950/5 xl:col-span-2">
          <div className="mb-1 text-sm font-semibold text-gray-900">首页在线客服</div>
          <p className="mb-5 text-xs leading-relaxed text-gray-400">配置首页右下角悬浮入口和客服弹窗。悬浮图会等比例显示在固定尺寸容器内，避免过小或过度占据页面。</p>

          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {renderItem({ key: "customer_service_enabled", label: "启用首页在线客服", type: "checkbox" })}
                {renderItem({ key: "customer_service_title", label: "弹窗标题", type: "text", hint: "例如：联系客服。" })}
                {renderItem({ key: "customer_service_name", label: "客服名称", type: "text", hint: "例如：乌苏、StarAI 客服。" })}
                {renderItem({ key: "customer_service_subtitle", label: "弹窗副标题", type: "text", hint: "例如：我们随时为您服务。" })}
                {renderItem({ key: "customer_service_qr_tip", label: "二维码提示语", type: "text", hint: "显示在二维码下方。" })}
                {renderItem({ key: "customer_service_phone", label: "手机号", type: "text" })}
                {renderItem({ key: "customer_service_wechat", label: "微信号", type: "text" })}
                {renderItem({ key: "customer_service_hours", label: "工作时间", type: "text", hint: "例如：00:00 - 23:59。" })}
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {[
                  {
                    key: "customer_service_floating_image" as const,
                    label: "悬浮入口图",
                    value: configs.customer_service_floating_image,
                    uploading: supportFloatingUploading,
                    upload: (file?: File | null) => uploadSupportImage("customer_service_floating_image", file),
                    hint: "建议正方形透明 PNG/WebP，前台显示约 64–72px。",
                  },
                  {
                    key: "customer_service_avatar" as const,
                    label: "客服头像",
                    value: configs.customer_service_avatar,
                    uploading: supportAvatarUploading,
                    upload: (file?: File | null) => uploadSupportImage("customer_service_avatar", file),
                    hint: "显示在客服资料卡中，建议正方形图片。",
                  },
                  {
                    key: "customer_service_qr_url" as const,
                    label: "微信二维码",
                    value: configs.customer_service_qr_url,
                    uploading: supportUploading,
                    upload: uploadSupportQR,
                    hint: "建议上传清晰的正方形二维码。",
                  },
                ].map((item) => (
                  <div key={item.key} className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                    <div className="text-xs font-medium text-gray-600">{item.label}</div>
                    <div className="mt-3 flex h-28 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-gray-200 bg-white">
                      {item.value ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={String(item.value)} alt={item.label} className="h-full w-full object-contain p-2" />
                      ) : (
                        <span className="text-xs text-gray-300">未上传</span>
                      )}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <label className="inline-flex cursor-pointer items-center rounded-xl bg-gray-950 px-3 py-2 text-xs font-semibold text-white">
                        {item.uploading ? "上传中..." : "上传图片"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          className="hidden"
                          disabled={item.uploading}
                          onChange={(e) => {
                            item.upload(e.target.files?.[0]);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <button type="button" onClick={() => setField(item.key, "")} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 hover:bg-gray-50">
                        清除
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-gray-400">{item.hint}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl bg-[#11151b] p-5 text-white">
              <div className="text-xs font-medium uppercase tracking-wider text-white/40">{String(configs.customer_service_title || "联系客服")} · 弹窗预览</div>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white/[0.05]">
                    {configs.customer_service_avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={String(configs.customer_service_avatar)} alt="客服头像" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xl text-white/40">客</span>
                    )}
                  </div>
                  <div>
                    <div className="font-semibold">{String(configs.customer_service_name || "在线客服")}</div>
                    <div className="mt-1 text-xs text-emerald-400">● 在线服务</div>
                  </div>
                </div>
                {configs.customer_service_qr_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={String(configs.customer_service_qr_url)} alt="二维码预览" className="mx-auto mt-5 h-40 w-40 rounded-xl bg-white object-contain p-2" />
                ) : (
                  <div className="mx-auto mt-5 grid h-40 w-40 place-items-center rounded-xl bg-white/5 text-xs text-white/25">二维码预览</div>
                )}
                <div className="mt-5 space-y-2 text-xs text-white/60">
                  <div>手机号：{String(configs.customer_service_phone || "未配置")}</div>
                  <div>微信号：{String(configs.customer_service_wechat || "未配置")}</div>
                  <div>工作时间：{String(configs.customer_service_hours || "未配置")}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm shadow-gray-950/5">
          <div className="mb-4 text-sm font-semibold text-gray-900">基础配置</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {BASE_ITEMS.map((item) => renderItem(item))}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm shadow-gray-950/5">
          <div className="mb-4 text-sm font-semibold text-gray-900">登录与注册</div>
          <div className="grid grid-cols-1 gap-4">{MEMBER_ITEMS.map((item) => renderItem(item))}</div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm shadow-gray-950/5 xl:col-span-2">
          <div className="mb-1 text-sm font-semibold text-gray-900">作品存储与自动清理</div>
          <p className="mb-4 text-xs leading-relaxed text-gray-400">
            开发环境建议使用本地存储或 Docker MinIO，均可不填写凭据。外部 S3/R2/GCS 才需要在这里显式配置，保存后重启 API 和 Worker 服务生效。
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-xs text-gray-500">存储服务商</label>
              <select value={storageProvider} onChange={(e) => applyStoragePreset(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none">
                {STORAGE_PRESETS.map((p) => (
                  <option key={p.value || "manual"} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{storagePreset.hint}</p>
            </div>
            {storageUsesEnv && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-[12px] leading-relaxed text-gray-600 md:col-span-2">
                当前模式无需在后台填写 Endpoint、Access Key、Secret Key 或 Bucket。API 会优先使用本地存储；MinIO 模式会读取 .env / Docker 环境变量，连接失败时自动回退到本地存储。
              </div>
            )}
            {!storageUsesEnv && STORAGE_ITEMS.map((item) => renderItem(item, item.key === "storage_public_url" ? "md:col-span-2" : ""))}
            {storageUsesEnv && renderItem({ key: "work_retention_days", label: "作品自动删除天数", type: "number", hint: "0 表示永久保留。大于 0 时，新作品会写入过期时间，清理任务会删除记录和已保存文件。" }, "md:col-span-2")}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm shadow-gray-950/5 xl:col-span-2">
          <div className="mb-4 text-sm font-semibold text-gray-900">第三方 OAuth 登录</div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {OAUTH_GROUPS.map((g) => (
              <div key={g.provider} className="space-y-3 rounded-xl border bg-gray-50 p-4">
                {renderItem({ key: `oauth_${g.provider}_enabled`, label: g.label, type: "checkbox" })}
                {renderItem({ key: `oauth_${g.provider}_client_id`, label: "Client ID", type: "text" })}
                {renderItem({ key: `oauth_${g.provider}_client_secret`, label: "Client Secret", type: "password" })}
                <p className="text-[11px] text-gray-400">{g.callbackHint}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm shadow-gray-950/5 xl:col-span-2">
          <div className="mb-4 text-sm font-semibold text-gray-900">邮箱验证码发信</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {renderItem({ key: "smtp_enabled", label: "启用邮件验证码发信", type: "checkbox" })}
            {renderItem({ key: "email_otp_debug", label: "验证码调试模式", type: "checkbox", hint: "仅用于开发排障。开启后即使邮件服务发送失败也会返回 debug_code。" })}
            <div className="md:col-span-2">
              <label className="text-xs text-gray-500">发信服务商</label>
              <select value={emailProvider} onChange={(e) => setField("email_provider", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none">
                <option value="smtp">SMTP 邮箱服务商</option>
                <option value="resend">Resend 邮件 API</option>
              </select>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                Resend 需要先在 Resend 后台完成域名验证，并使用已验证域名作为发件人。官网：
                <a href="https://resend.com" target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">https://resend.com</a>
              </p>
            </div>
            {emailProvider === "resend" ? (
              <>
                {renderItem({ key: "resend_api_key", label: "Resend API Key", type: "password", hint: "在 Resend 后台 API Keys 中创建，通常以 re_ 开头。" })}
                {renderItem({ key: "resend_from", label: "Resend 发件人", type: "text", hint: "例如 StarAI <noreply@yourdomain.com>，域名必须已在 Resend 验证。" })}
              </>
            ) : (
              <>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-500">邮箱服务商</label>
              <select value={String(configs.smtp_provider ?? "")} onChange={(e) => applySmtpProvider(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none">
                <option value="">请选择服务商</option>
                <optgroup label="个人邮箱">
                  {SMTP_PERSONAL.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </optgroup>
                <optgroup label="企业邮箱">
                  {SMTP_ENTERPRISE.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            {smtpProvider && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-[12px] leading-relaxed text-gray-600 md:col-span-2">
                <span className="font-semibold text-gray-800">{smtpProvider.label}：</span>
                {smtpProvider.hint}
              </div>
            )}
            {renderItem({ key: "smtp_host", label: "SMTP 主机", type: "text" })}
            {renderItem({ key: "smtp_port", label: "SMTP 端口", type: "number", hint: "SSL 直连通常为 465，STARTTLS 通常为 587。" })}
            {renderItem({ key: "smtp_ssl", label: "使用 SSL（465）", type: "checkbox" })}
            {renderItem({ key: "smtp_user", label: "SMTP 用户名", type: "text", hint: "通常是完整邮箱地址。" })}
            {renderItem({ key: "smtp_pass", label: `SMTP ${smtpProvider?.passLabel || "密码/授权码"}`, type: "password" })}
            {renderItem({ key: "smtp_from", label: "发件人", type: "text", hint: "例如 你的站点名称 <noreply@yourdomain.com>。留空则使用 SMTP 用户名。" }, "md:col-span-2")}
              </>
            )}
          </div>
        </section>
      </div>

      <div className="-mx-2 sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-gray-100 bg-white/95 px-2 py-4 backdrop-blur-sm">
        <div className="min-h-5 text-xs">
          {saveErr ? <span className="text-red-500">{saveErr}</span> : null}
          {saveMsg ? <span className="text-emerald-600">{saveMsg}</span> : null}
        </div>
        <button onClick={handleSave} disabled={saving} className="min-w-[140px] rounded-xl bg-primary px-8 py-2.5 text-sm font-semibold text-dark disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? "保存中..." : saved ? "已保存" : "保存配置"}
        </button>
      </div>
    </div>
  );
}
