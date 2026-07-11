"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { UILanguage, UITranslationOverride, User } from "@starai/shared-types";
import { api, hasUserSession } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { DEFAULT_UI_LANGUAGES, dictionaries, SUPPORTED_UI_LOCALES, type TranslationKey } from "./dictionaries";

type PublicConfig = {
  default_locale?: string;
  ui_languages?: UILanguage[];
  ui_translation_overrides?: UITranslationOverride[];
};

type I18nContextValue = {
  locale: string;
  language: UILanguage;
  languages: UILanguage[];
  setLocale: (code: string, options?: { persistUser?: boolean }) => void;
  t: (key: TranslationKey | string, vars?: Record<string, string | number>) => string;
  td: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
  ts: (source: string) => string;
  formatDate: (value: string | number | Date) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function sourceTranslationKey(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `source.${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const BUILTIN_LANGUAGE_META: Record<string, Pick<UILanguage, "short" | "name" | "flag">> = {
  "zh-CN": { short: "ZH", name: "\u4e2d\u6587\uff08\u7b80\u4f53\uff09", flag: "\u{1F1E8}\u{1F1F3}" },
  "en-US": { short: "EN", name: "English", flag: "\u{1F1FA}\u{1F1F8}" },
  "ja-JP": { short: "JA", name: "\u65e5\u672c\u8a9e", flag: "\u{1F1EF}\u{1F1F5}" },
  "ko-KR": { short: "KO", name: "\ud55c\uad6d\uc5b4", flag: "\u{1F1F0}\u{1F1F7}" },
  "vi-VN": { short: "VI", name: "Ti\u1ebfng Vi\u1ec7t", flag: "\u{1F1FB}\u{1F1F3}" },
};

const EXTRA_BUILTIN_TRANSLATIONS: Record<string, Record<string, string>> = {
  "zh-CN": {
    "common.backHome": "返回首页",
    "billing.per_token": "按 Token",
    "billing.per_image": "按图片",
    "billing.per_request": "按请求",
    "billing.per_second": "按时长",
    "billing.dynamic": "动态计费",
    "category.chat": "对话",
    "category.image": "图片",
    "category.video": "视频",
    "category.audio": "音频",
    "pricing.title": "价格查询",
    "pricing.desc": "所有模型统一使用算力余额结算。提交任务前会展示预估消耗，实际扣费以任务完成后的真实用量为准。",
    "pricing.model": "模型",
    "pricing.category": "分类",
    "pricing.billing": "计费方式",
    "pricing.price": "价格",
    "pricing.status": "状态",
    "pricing.enabled": "可用",
    "pricing.disabled": "停用",
    "pricing.inputPrice": "输入 {value}",
    "pricing.outputPrice": "输出 {value}",
    "pricing.cacheReadPrice": "缓存读取 {value}",
    "pricing.computePerImage": "{value} 算力 / 张",
    "pricing.computePerRequest": "{value} 算力 / 次",
    "pricing.computePerSecond": "{value} 算力 / 秒",
    "pricing.dynamicEstimate": "按参数动态估算",
    "login.legalEmpty": "暂未配置内容，请联系平台管理员。",
    "login.captchaLoadFailed": "图形验证码加载失败",
    "login.redirectFailed": "跳转失败",
    "login.enterEmail": "请输入邮箱地址",
    "login.agreeRequired": "请先同意服务协议和隐私政策",
    "login.sendFailed": "发送失败",
    "login.debugCode": "调试验证码：{code}",
    "login.verifyFailed": "验证失败",
    "login.enterCaptcha": "请输入图形验证码",
    "login.loginFailed": "登录失败",
    "login.passwordMin": "密码至少需要 6 位",
    "login.passwordMismatch": "两次输入的密码不一致",
    "login.setPasswordFailed": "设置密码失败",
    "customerService.open": "打开在线客服",
    "customerService.dialog": "在线客服",
    "customerService.title": "联系客服",
    "customerService.name": "在线客服",
    "customerService.subtitle": "我们随时为您服务",
    "customerService.qrTip": "长按或扫码添加微信",
    "customerService.online": "在线服务",
    "customerService.phone": "手机号",
    "customerService.wechat": "微信号",
    "customerService.hours": "工作时间",
    "customerService.downloadQR": "下载二维码",
    "workspace.modelPriceMissing": "模型组合未配置价格",
    "workspace.maxReferenceImages": "最多可上传 {max} 张参考图",
    "workspace.enterPrompt": "请输入提示词",
    "workspace.enterText": "请输入文本",
    "workspace.insufficientBalance": "余额不足",
    "workspace.submitFailed": "提交失败",
    "workspace.videoLoading": "视频加载中...",
    "workspace.videoLoadFailed": "视频加载失败，请刷新重试",
    "workspace.downloadImage": "下载图片",
    "workspace.videoGenerating": "视频生成中...",
    "workspace.imageGenerating": "图片生成中...",
  },
  "en-US": {
    "common.backHome": "Back to home",
    "billing.per_token": "Per token",
    "billing.per_image": "Per image",
    "billing.per_request": "Per request",
    "billing.per_second": "Per duration",
    "billing.dynamic": "Dynamic billing",
    "category.chat": "Chat",
    "category.image": "Image",
    "category.video": "Video",
    "category.audio": "Audio",
    "pricing.title": "Pricing",
    "pricing.desc": "All models are settled with compute credits. Estimated usage is shown before submission; actual billing is based on final task usage.",
    "pricing.model": "Model",
    "pricing.category": "Category",
    "pricing.billing": "Billing",
    "pricing.price": "Price",
    "pricing.status": "Status",
    "pricing.enabled": "Available",
    "pricing.disabled": "Disabled",
    "pricing.inputPrice": "Input {value}",
    "pricing.outputPrice": "Output {value}",
    "pricing.cacheReadPrice": "Cache read {value}",
    "pricing.computePerImage": "{value} credits / image",
    "pricing.computePerRequest": "{value} credits / request",
    "pricing.computePerSecond": "{value} credits / second",
    "pricing.dynamicEstimate": "Estimated dynamically by parameters",
    "login.legalEmpty": "No content is configured yet. Please contact the platform administrator.",
    "login.captchaLoadFailed": "Captcha failed to load",
    "login.redirectFailed": "Redirect failed",
    "login.enterEmail": "Please enter email address",
    "login.agreeRequired": "Please agree to the Terms of Service and Privacy Policy first",
    "login.sendFailed": "Send failed",
    "login.debugCode": "Debug code: {code}",
    "login.verifyFailed": "Verification failed",
    "login.enterCaptcha": "Please enter captcha",
    "login.loginFailed": "Login failed",
    "login.passwordMin": "Password must be at least 6 characters",
    "login.passwordMismatch": "Passwords do not match",
    "login.setPasswordFailed": "Failed to set password",
    "customerService.open": "Open customer service",
    "customerService.dialog": "Customer service",
    "customerService.title": "Contact us",
    "customerService.name": "Online support",
    "customerService.subtitle": "We are here to help",
    "customerService.qrTip": "Long press or scan to add WeChat",
    "customerService.online": "Online",
    "customerService.phone": "Phone",
    "customerService.wechat": "WeChat",
    "customerService.hours": "Hours",
    "customerService.downloadQR": "Download QR code",
    "workspace.modelPriceMissing": "Model combination pricing is not configured",
    "workspace.maxReferenceImages": "You can upload up to {max} reference images",
    "workspace.enterPrompt": "Please enter a prompt",
    "workspace.enterText": "Please enter text",
    "workspace.insufficientBalance": "Insufficient balance",
    "workspace.submitFailed": "Submit failed",
    "workspace.videoLoading": "Loading video...",
    "workspace.videoLoadFailed": "Video failed to load. Please refresh and try again.",
    "workspace.downloadImage": "Download image",
    "workspace.videoGenerating": "Generating video...",
    "workspace.imageGenerating": "Generating image...",
  },
  "ja-JP": {
    "common.backHome": "ホームへ戻る",
    "billing.per_token": "Token ごと",
    "billing.per_image": "画像ごと",
    "billing.per_request": "リクエストごと",
    "billing.per_second": "時間ごと",
    "billing.dynamic": "動的課金",
    "category.chat": "チャット",
    "category.image": "画像",
    "category.video": "動画",
    "category.audio": "音声",
    "pricing.title": "料金",
    "pricing.desc": "すべてのモデルはクレジット残高で決済されます。送信前に概算消費量を表示し、実際の課金はタスク完了後の実使用量に基づきます。",
    "pricing.model": "モデル",
    "pricing.category": "カテゴリ",
    "pricing.billing": "課金方式",
    "pricing.price": "価格",
    "pricing.status": "状態",
    "pricing.enabled": "利用可能",
    "pricing.disabled": "停止中",
    "pricing.inputPrice": "入力 {value}",
    "pricing.outputPrice": "出力 {value}",
    "pricing.cacheReadPrice": "キャッシュ読み取り {value}",
    "pricing.computePerImage": "{value} クレジット / 枚",
    "pricing.computePerRequest": "{value} クレジット / 回",
    "pricing.computePerSecond": "{value} クレジット / 秒",
    "pricing.dynamicEstimate": "パラメータに基づき動的に見積もり",
    "login.legalEmpty": "内容はまだ設定されていません。管理者にお問い合わせください。",
    "login.captchaLoadFailed": "認証画像の読み込みに失敗しました",
    "login.redirectFailed": "リダイレクトに失敗しました",
    "login.enterEmail": "メールアドレスを入力してください",
    "login.agreeRequired": "先に利用規約とプライバシーポリシーに同意してください",
    "login.sendFailed": "送信に失敗しました",
    "login.debugCode": "デバッグコード：{code}",
    "login.verifyFailed": "認証に失敗しました",
    "login.enterCaptcha": "画像認証コードを入力してください",
    "login.loginFailed": "ログインに失敗しました",
    "login.passwordMin": "パスワードは6文字以上必要です",
    "login.passwordMismatch": "パスワードが一致しません",
    "login.setPasswordFailed": "パスワード設定に失敗しました",
    "customerService.open": "オンラインサポートを開く",
    "customerService.dialog": "オンラインサポート",
    "customerService.title": "お問い合わせ",
    "customerService.name": "オンラインサポート",
    "customerService.subtitle": "いつでもサポートします",
    "customerService.qrTip": "長押しまたはスキャンして WeChat を追加",
    "customerService.online": "オンライン",
    "customerService.phone": "電話番号",
    "customerService.wechat": "WeChat",
    "customerService.hours": "対応時間",
    "customerService.downloadQR": "QRコードをダウンロード",
    "workspace.modelPriceMissing": "モデル組み合わせの価格が設定されていません",
    "workspace.maxReferenceImages": "参考画像は最大 {max} 枚までアップロードできます",
    "workspace.enterPrompt": "プロンプトを入力してください",
    "workspace.enterText": "テキストを入力してください",
    "workspace.insufficientBalance": "残高不足です",
    "workspace.submitFailed": "送信に失敗しました",
    "workspace.videoLoading": "動画を読み込み中...",
    "workspace.videoLoadFailed": "動画の読み込みに失敗しました。更新して再試行してください。",
    "workspace.downloadImage": "画像をダウンロード",
    "workspace.videoGenerating": "動画を生成中...",
    "workspace.imageGenerating": "画像を生成中...",
  },
  "ko-KR": {
    "common.backHome": "홈으로 돌아가기",
    "billing.per_token": "Token 기준",
    "billing.per_image": "이미지 기준",
    "billing.per_request": "요청 기준",
    "billing.per_second": "시간 기준",
    "billing.dynamic": "동적 과금",
    "category.chat": "채팅",
    "category.image": "이미지",
    "category.video": "동영상",
    "category.audio": "오디오",
    "pricing.title": "가격 조회",
    "pricing.desc": "모든 모델은 컴퓨트 크레딧으로 정산됩니다. 제출 전 예상 사용량을 표시하며, 실제 과금은 작업 완료 후 실제 사용량을 기준으로 합니다.",
    "pricing.model": "모델",
    "pricing.category": "분류",
    "pricing.billing": "과금 방식",
    "pricing.price": "가격",
    "pricing.status": "상태",
    "pricing.enabled": "사용 가능",
    "pricing.disabled": "비활성",
    "pricing.inputPrice": "입력 {value}",
    "pricing.outputPrice": "출력 {value}",
    "pricing.cacheReadPrice": "캐시 읽기 {value}",
    "pricing.computePerImage": "{value} 크레딧 / 장",
    "pricing.computePerRequest": "{value} 크레딧 / 회",
    "pricing.computePerSecond": "{value} 크레딧 / 초",
    "pricing.dynamicEstimate": "파라미터에 따라 동적 산정",
    "login.legalEmpty": "아직 내용이 설정되지 않았습니다. 플랫폼 관리자에게 문의하세요.",
    "login.captchaLoadFailed": "보안 문자 로드에 실패했습니다",
    "login.redirectFailed": "이동에 실패했습니다",
    "login.enterEmail": "이메일 주소를 입력하세요",
    "login.agreeRequired": "먼저 서비스 약관과 개인정보 처리방침에 동의하세요",
    "login.sendFailed": "전송 실패",
    "login.debugCode": "디버그 코드: {code}",
    "login.verifyFailed": "인증 실패",
    "login.enterCaptcha": "보안 문자를 입력하세요",
    "login.loginFailed": "로그인 실패",
    "login.passwordMin": "비밀번호는 최소 6자 이상이어야 합니다",
    "login.passwordMismatch": "비밀번호가 일치하지 않습니다",
    "login.setPasswordFailed": "비밀번호 설정 실패",
    "customerService.open": "온라인 고객센터 열기",
    "customerService.dialog": "온라인 고객센터",
    "customerService.title": "문의하기",
    "customerService.name": "온라인 고객센터",
    "customerService.subtitle": "언제든 도와드리겠습니다",
    "customerService.qrTip": "길게 누르거나 스캔하여 WeChat 추가",
    "customerService.online": "온라인",
    "customerService.phone": "휴대폰 번호",
    "customerService.wechat": "WeChat",
    "customerService.hours": "운영 시간",
    "customerService.downloadQR": "QR 코드 다운로드",
    "workspace.modelPriceMissing": "모델 조합 가격이 설정되지 않았습니다",
    "workspace.maxReferenceImages": "참조 이미지는 최대 {max}장까지 업로드할 수 있습니다",
    "workspace.enterPrompt": "프롬프트를 입력하세요",
    "workspace.enterText": "텍스트를 입력하세요",
    "workspace.insufficientBalance": "잔액 부족",
    "workspace.submitFailed": "제출 실패",
    "workspace.videoLoading": "동영상 로딩 중...",
    "workspace.videoLoadFailed": "동영상 로드 실패. 새로고침 후 다시 시도하세요.",
    "workspace.downloadImage": "이미지 다운로드",
    "workspace.videoGenerating": "동영상 생성 중...",
    "workspace.imageGenerating": "이미지 생성 중...",
  },
  "vi-VN": {
    "common.backHome": "Về trang chủ",
    "billing.per_token": "Theo Token",
    "billing.per_image": "Theo ảnh",
    "billing.per_request": "Theo yêu cầu",
    "billing.per_second": "Theo thời lượng",
    "billing.dynamic": "Tính phí động",
    "category.chat": "Trò chuyện",
    "category.image": "Hình ảnh",
    "category.video": "Video",
    "category.audio": "Âm thanh",
    "pricing.title": "Bảng giá",
    "pricing.desc": "Tất cả mô hình được thanh toán bằng credit tính toán. Hệ thống hiển thị ước tính trước khi gửi; phí thực tế dựa trên mức sử dụng sau khi tác vụ hoàn tất.",
    "pricing.model": "Mô hình",
    "pricing.category": "Danh mục",
    "pricing.billing": "Cách tính phí",
    "pricing.price": "Giá",
    "pricing.status": "Trạng thái",
    "pricing.enabled": "Khả dụng",
    "pricing.disabled": "Tạm dừng",
    "pricing.inputPrice": "Đầu vào {value}",
    "pricing.outputPrice": "Đầu ra {value}",
    "pricing.cacheReadPrice": "Đọc cache {value}",
    "pricing.computePerImage": "{value} credit / ảnh",
    "pricing.computePerRequest": "{value} credit / yêu cầu",
    "pricing.computePerSecond": "{value} credit / giây",
    "pricing.dynamicEstimate": "Ước tính động theo tham số",
    "login.legalEmpty": "Chưa cấu hình nội dung. Vui lòng liên hệ quản trị viên nền tảng.",
    "login.captchaLoadFailed": "Không tải được captcha",
    "login.redirectFailed": "Chuyển hướng thất bại",
    "login.enterEmail": "Vui lòng nhập email",
    "login.agreeRequired": "Vui lòng đồng ý Điều khoản dịch vụ và Chính sách quyền riêng tư trước",
    "login.sendFailed": "Gửi thất bại",
    "login.debugCode": "Mã debug: {code}",
    "login.verifyFailed": "Xác minh thất bại",
    "login.enterCaptcha": "Vui lòng nhập captcha",
    "login.loginFailed": "Đăng nhập thất bại",
    "login.passwordMin": "Mật khẩu cần ít nhất 6 ký tự",
    "login.passwordMismatch": "Mật khẩu không khớp",
    "login.setPasswordFailed": "Đặt mật khẩu thất bại",
    "customerService.open": "Mở hỗ trợ trực tuyến",
    "customerService.dialog": "Hỗ trợ trực tuyến",
    "customerService.title": "Liên hệ hỗ trợ",
    "customerService.name": "Hỗ trợ trực tuyến",
    "customerService.subtitle": "Chúng tôi luôn sẵn sàng hỗ trợ",
    "customerService.qrTip": "Nhấn giữ hoặc quét để thêm WeChat",
    "customerService.online": "Đang trực tuyến",
    "customerService.phone": "Số điện thoại",
    "customerService.wechat": "WeChat",
    "customerService.hours": "Thời gian làm việc",
    "customerService.downloadQR": "Tải mã QR",
    "workspace.modelPriceMissing": "Chưa cấu hình giá cho tổ hợp mô hình",
    "workspace.maxReferenceImages": "Bạn có thể tải lên tối đa {max} ảnh tham chiếu",
    "workspace.enterPrompt": "Vui lòng nhập prompt",
    "workspace.enterText": "Vui lòng nhập văn bản",
    "workspace.insufficientBalance": "Số dư không đủ",
    "workspace.submitFailed": "Gửi thất bại",
    "workspace.videoLoading": "Đang tải video...",
    "workspace.videoLoadFailed": "Không tải được video. Vui lòng làm mới và thử lại.",
    "workspace.downloadImage": "Tải ảnh",
    "workspace.videoGenerating": "Đang tạo video...",
    "workspace.imageGenerating": "Đang tạo ảnh...",
  },
};

function isSupported(code: string) {
  return SUPPORTED_UI_LOCALES.includes(code as any);
}

function normalizeLanguage(item: UILanguage): UILanguage | null {
  const code = String(item.code || "").trim();
  if (!code || !isSupported(code)) return null;
  const builtin = BUILTIN_LANGUAGE_META[code];
  const short = String(item.short || builtin?.short || code.slice(0, 2)).trim().toUpperCase();
  const name = String(item.name || builtin?.name || short).trim();
  const fallback = DEFAULT_UI_LANGUAGES.find((lang) => lang.code === code) as UILanguage | undefined;
  const rawFlag = String(item.flag || "").trim();
  const cleanFlag = rawFlag && !/[cn]/.test(rawFlag) ? rawFlag : "";
  const flag = String(cleanFlag || builtin?.flag || fallback?.flag || "\u{1F310}").trim() || builtin?.flag || "\u{1F310}";
  return {
    code,
    short,
    name,
    flag,
    flag_url: String(item.flag_url || fallback?.flag_url || "").trim() || undefined,
    enabled: item.enabled !== false,
    sort_order: Number(item.sort_order ?? 0) || 0,
  };
}

export function normalizeUILanguages(items?: UILanguage[]) {
  const source = items?.length ? items : DEFAULT_UI_LANGUAGES;
  const unique = new Map<string, UILanguage>();
  source.forEach((item) => {
    const cleaned = normalizeLanguage(item);
    if (cleaned?.enabled) unique.set(cleaned.code, cleaned);
  });
  const list = Array.from(unique.values()).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  return list.length ? list : DEFAULT_UI_LANGUAGES;
}

function matchLocale(candidates: string[], languages: UILanguage[]) {
  for (const candidate of candidates.filter(Boolean)) {
    const exact = languages.find((item) => item.code.toLowerCase() === candidate.toLowerCase());
    if (exact) return exact.code;
    const base = candidate.split("-")[0]?.toLowerCase();
    const sameBase = languages.find((item) => item.code.split("-")[0]?.toLowerCase() === base);
    if (sameBase) return sameBase.code;
  }
  return languages[0]?.code || "zh-CN";
}

function interpolate(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return Object.entries(vars).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, String(value)), text);
}

function usableTranslation(value?: string) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  return /\?{2,}/.test(text) ? "" : text;
}

function hasCJKText(value?: string) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ""));
}

function updateStoredUserLocale(code: string) {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return;
    const user = JSON.parse(raw) as User;
    localStorage.setItem("user", JSON.stringify({ ...user, locale: code }));
  } catch {
    /* ignore */
  }
}

function normalizeTranslationOverrides(items?: UITranslationOverride[]) {
  const result: Record<string, Record<string, string>> = {};
  if (!Array.isArray(items)) return result;
  for (const item of items) {
    if (item?.enabled === false) continue;
    const locale = String(item?.locale || "").trim();
    const key = String(item?.key || "").trim();
    const value = String(item?.value || "").trim();
    if (!locale || !isSupported(locale) || !key || !value) continue;
    // Chinese UI should use the built-in Chinese dictionary and admin-provided
    // original Chinese content. Skipping zh-CN overrides prevents imported
    // review files from replacing stable built-ins with partial values.
    if (locale === "zh-CN") continue;
    // en-US overrides must be English. If a mixed CN file was imported by
    // mistake, do not let Chinese values pollute the English UI.
    if (locale === "en-US" && hasCJKText(value)) continue;
    result[locale] ||= {};
    result[locale][key] = value;
  }
  return result;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const hydrate = useAuthStore((s) => s.hydrate);
  const [languages, setLanguages] = useState<UILanguage[]>(DEFAULT_UI_LANGUAGES);
  const [locale, setLocaleState] = useState("zh-CN");
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    let alive = true;
    api<PublicConfig>("/api/system-configs/public")
      .then((cfg) => {
        if (!alive) return;
        const next = normalizeUILanguages(cfg.ui_languages);
        setLanguages(next);
        setOverrides(normalizeTranslationOverrides(cfg.ui_translation_overrides));
        const stored = localStorage.getItem("site_locale") || "";
        const userLocale = user?.locale || "";
        setLocaleState((current) => matchLocale([stored, current, userLocale, cfg.default_locale || "", navigator.language], next));
      })
      .catch(() => {
        if (!alive) return;
        const next = normalizeUILanguages();
        setLanguages(next);
        setOverrides({});
        setLocaleState((current) => matchLocale([localStorage.getItem("site_locale") || "", current, user?.locale || "", navigator.language], next));
      });
    return () => {
      alive = false;
    };
  }, [user?.locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (code: string, options: { persistUser?: boolean } = {}) => {
      const next = matchLocale([code], languages);
      setLocaleState(next);
      localStorage.setItem("site_locale", next);
      updateStoredUserLocale(next);
      if (options.persistUser !== false && hasUserSession()) {
        api<User>("/api/me/profile", { method: "PATCH", body: JSON.stringify({ locale: next }) }).catch(() => {});
      }
      window.dispatchEvent(new CustomEvent("starai:ui-locale-change", { detail: { locale: next } }));
    },
    [languages]
  );

  const t = useCallback(
    (key: TranslationKey | string, vars?: Record<string, string | number>) => {
      const overrideCurrent = usableTranslation(overrides[locale]?.[key as string]);
      const extraCurrent = usableTranslation(EXTRA_BUILTIN_TRANSLATIONS[locale]?.[key as string]);
      const rawCurrent = usableTranslation(dictionaries[locale]?.[key as TranslationKey]);
      const rawEnglish = usableTranslation(dictionaries["en-US"]?.[key as TranslationKey]);
      // The initial ja/ko/vi catalogs were bootstrapped from English. Treat an
      // unchanged English value as a placeholder so a real built-in/admin
      // translation can win, instead of making the language switch look inert.
      const current = locale !== "en-US" && locale !== "zh-CN" && rawCurrent === rawEnglish ? "" : rawCurrent;
      const overrideEn = usableTranslation(overrides["en-US"]?.[key as string]);
      const fallbackEn = rawEnglish;
      const extraEn = usableTranslation(EXTRA_BUILTIN_TRANSLATIONS["en-US"]?.[key as string]);
      const overrideZh = usableTranslation(overrides["zh-CN"]?.[key as string]);
      const fallbackZh = usableTranslation(dictionaries["zh-CN"]?.[key as TranslationKey]);
      const extraZh = usableTranslation(EXTRA_BUILTIN_TRANSLATIONS["zh-CN"]?.[key as string]);
      return interpolate(String(overrideCurrent || extraCurrent || current || overrideEn || extraEn || fallbackEn || overrideZh || extraZh || fallbackZh || key), vars);
    },
    [locale, overrides]
  );

  const td = useCallback(
    (key: string, fallback: string, vars?: Record<string, string | number>) => {
      const ownOverride = usableTranslation(overrides[locale]?.[key]);
      const ownExtra = usableTranslation(EXTRA_BUILTIN_TRANSLATIONS[locale]?.[key]);
      const rawBuiltin = usableTranslation(dictionaries[locale]?.[key as TranslationKey]);
      const englishBuiltin = usableTranslation(dictionaries["en-US"]?.[key as TranslationKey]);
      const ownBuiltin = locale !== "en-US" && locale !== "zh-CN" && rawBuiltin === englishBuiltin ? "" : rawBuiltin;
      const ownValue = ownOverride || ownExtra || ownBuiltin;
      if (ownValue) return interpolate(ownValue, vars);
      return interpolate(fallback, vars);
    },
    [locale, overrides]
  );

  const ts = useCallback((source: string) => {
    if (locale === "zh-CN" || !source.trim()) return source;
    return usableTranslation(overrides[locale]?.[sourceTranslationKey(source.trim())]) || source;
  }, [locale, overrides]);

  const value = useMemo<I18nContextValue>(() => {
    const language = languages.find((item) => item.code === locale) || languages[0] || DEFAULT_UI_LANGUAGES[0];
    return {
      locale,
      language,
      languages,
      setLocale,
      t,
      td,
      ts,
      formatDate: (input) => new Intl.DateTimeFormat(locale).format(new Date(input)),
      formatNumber: (input, options) => new Intl.NumberFormat(locale, options).format(input),
    };
  }, [languages, locale, setLocale, t, td, ts]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
