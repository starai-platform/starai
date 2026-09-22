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
    "upscale.workflow": "AI 视频超分工作流",
    "upscale.history": "历史任务",
    "upscale.source": "源视频",
    "upscale.uploading": "视频上传中...",
    "upscale.upload": "点击上传源视频",
    "upscale.limit": "最大 {size} MB，最长 {duration} 秒",
    "upscale.asset": "从资产库选择视频",
    "upscale.settings": "高清增强设置",
    "upscale.resolution": "目标清晰度",
    "upscale.mode": "增强模式",
    "upscale.balanced": "均衡",
    "upscale.detail": "细节",
    "upscale.denoise": "降噪",
    "upscale.preserveAudio": "保留源视频声音",
    "upscale.preserveAudioDesc": "输出视频继续使用原音轨",
    "upscale.prompt": "可选：补充画面降噪、人物细节或清晰度要求",
    "upscale.completed": "处理完成",
    "upscale.cancel": "取消",
    "upscale.target": "目标清晰度",
    "upscale.actualCost": "实际消耗：{value} 算力",
    "upscale.failed": "处理失败",
    "upscale.processing": "AI 高清处理中...",
    "upscale.retry": "重新处理",
    "upscale.start": "开始高清增强",
    "upscale.result": "高清结果",
    "upscale.download": "下载视频",
    "upscale.selectAsset": "选择视频资产",
    "upscale.assetOnly": "只显示视频类型资产",
    "upscale.noAssets": "资产库暂无视频",
    "upscale.historyTitle": "历史高清任务",
    "upscale.noHistory": "暂无历史任务",
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
    "upscale.workflow": "AI Video Upscaling Workflow",
    "upscale.history": "Task history",
    "upscale.source": "Source video",
    "upscale.uploading": "Uploading video...",
    "upscale.upload": "Upload source video",
    "upscale.limit": "Up to {size} MB and {duration} seconds",
    "upscale.asset": "Choose from asset library",
    "upscale.settings": "Enhancement settings",
    "upscale.resolution": "Target resolution",
    "upscale.mode": "Enhancement mode",
    "upscale.balanced": "Balanced",
    "upscale.detail": "Detail",
    "upscale.denoise": "Denoise",
    "upscale.preserveAudio": "Preserve source audio",
    "upscale.preserveAudioDesc": "Keep the original audio track in the output",
    "upscale.prompt": "Optional: add denoise, facial detail, or clarity requirements",
    "upscale.completed": "Completed",
    "upscale.cancel": "Cancel",
    "upscale.target": "Target resolution",
    "upscale.actualCost": "Actual usage: {value} credits",
    "upscale.failed": "Failed",
    "upscale.processing": "Enhancing video...",
    "upscale.retry": "Try again",
    "upscale.start": "Start enhancement",
    "upscale.result": "Enhanced result",
    "upscale.download": "Download video",
    "upscale.selectAsset": "Select a video asset",
    "upscale.assetOnly": "Only video assets are shown",
    "upscale.noAssets": "No videos in the asset library",
    "upscale.historyTitle": "Enhancement history",
    "upscale.noHistory": "No task history",
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
    "upscale.workflow": "AI 動画高画質化ワークフロー",
    "upscale.history": "タスク履歴",
    "upscale.source": "元動画",
    "upscale.uploading": "動画をアップロード中...",
    "upscale.upload": "元動画をアップロード",
    "upscale.limit": "最大 {size} MB、{duration} 秒",
    "upscale.asset": "アセットライブラリから選択",
    "upscale.settings": "高画質化設定",
    "upscale.resolution": "出力解像度",
    "upscale.mode": "強化モード",
    "upscale.balanced": "バランス",
    "upscale.detail": "ディテール",
    "upscale.denoise": "ノイズ除去",
    "upscale.preserveAudio": "元の音声を保持",
    "upscale.preserveAudioDesc": "出力動画に元の音声トラックを残します",
    "upscale.prompt": "任意：ノイズ除去、人物の細部、鮮明さの要件を追加",
    "upscale.completed": "処理完了",
    "upscale.cancel": "キャンセル",
    "upscale.target": "出力解像度",
    "upscale.actualCost": "実際の消費：{value} クレジット",
    "upscale.failed": "処理失敗",
    "upscale.processing": "動画を高画質化中...",
    "upscale.retry": "再処理",
    "upscale.start": "高画質化を開始",
    "upscale.result": "高画質化結果",
    "upscale.download": "動画をダウンロード",
    "upscale.selectAsset": "動画アセットを選択",
    "upscale.assetOnly": "動画タイプのアセットのみ表示",
    "upscale.noAssets": "動画アセットがありません",
    "upscale.historyTitle": "高画質化履歴",
    "upscale.noHistory": "履歴がありません",
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
    "upscale.workflow": "AI 동영상 업스케일 워크플로",
    "upscale.history": "작업 기록",
    "upscale.source": "원본 동영상",
    "upscale.uploading": "동영상 업로드 중...",
    "upscale.upload": "원본 동영상 업로드",
    "upscale.limit": "최대 {size}MB, {duration}초",
    "upscale.asset": "에셋 라이브러리에서 선택",
    "upscale.settings": "화질 향상 설정",
    "upscale.resolution": "목표 해상도",
    "upscale.mode": "향상 모드",
    "upscale.balanced": "균형",
    "upscale.detail": "디테일",
    "upscale.denoise": "노이즈 제거",
    "upscale.preserveAudio": "원본 오디오 유지",
    "upscale.preserveAudioDesc": "출력 동영상에 원본 오디오 트랙을 유지합니다",
    "upscale.prompt": "선택 사항: 노이즈 제거, 인물 디테일 또는 선명도 요구 입력",
    "upscale.completed": "처리 완료",
    "upscale.cancel": "취소",
    "upscale.target": "목표 해상도",
    "upscale.actualCost": "실제 사용량: {value} 크레딧",
    "upscale.failed": "처리 실패",
    "upscale.processing": "동영상 화질 향상 중...",
    "upscale.retry": "다시 처리",
    "upscale.start": "화질 향상 시작",
    "upscale.result": "향상된 결과",
    "upscale.download": "동영상 다운로드",
    "upscale.selectAsset": "동영상 에셋 선택",
    "upscale.assetOnly": "동영상 에셋만 표시",
    "upscale.noAssets": "에셋 라이브러리에 동영상이 없습니다",
    "upscale.historyTitle": "화질 향상 기록",
    "upscale.noHistory": "작업 기록이 없습니다",
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
    "upscale.workflow": "Quy trình nâng cấp video bằng AI",
    "upscale.history": "Lịch sử tác vụ",
    "upscale.source": "Video nguồn",
    "upscale.uploading": "Đang tải video lên...",
    "upscale.upload": "Tải video nguồn lên",
    "upscale.limit": "Tối đa {size} MB và {duration} giây",
    "upscale.asset": "Chọn từ thư viện tài sản",
    "upscale.settings": "Cài đặt tăng cường",
    "upscale.resolution": "Độ phân giải đích",
    "upscale.mode": "Chế độ tăng cường",
    "upscale.balanced": "Cân bằng",
    "upscale.detail": "Chi tiết",
    "upscale.denoise": "Khử nhiễu",
    "upscale.preserveAudio": "Giữ âm thanh gốc",
    "upscale.preserveAudioDesc": "Giữ bản âm thanh gốc trong video đầu ra",
    "upscale.prompt": "Tùy chọn: thêm yêu cầu khử nhiễu, chi tiết khuôn mặt hoặc độ nét",
    "upscale.completed": "Hoàn tất",
    "upscale.cancel": "Hủy",
    "upscale.target": "Độ phân giải đích",
    "upscale.actualCost": "Mức dùng thực tế: {value} tín dụng",
    "upscale.failed": "Thất bại",
    "upscale.processing": "Đang nâng cấp video...",
    "upscale.retry": "Thử lại",
    "upscale.start": "Bắt đầu tăng cường",
    "upscale.result": "Kết quả nâng cấp",
    "upscale.download": "Tải video xuống",
    "upscale.selectAsset": "Chọn tài sản video",
    "upscale.assetOnly": "Chỉ hiển thị tài sản video",
    "upscale.noAssets": "Không có video trong thư viện",
    "upscale.historyTitle": "Lịch sử nâng cấp",
    "upscale.noHistory": "Chưa có lịch sử tác vụ",
  },
};

const BUILTIN_KEY_TRANSLATIONS: Record<string, Record<string, string>> = {
  "apiDocs.backWorkspace": { "en-US": "Back to workspace", "ja-JP": "ワークスペースに戻る", "ko-KR": "워크스페이스로 돌아가기", "vi-VN": "Quay lại workspace" },
  "common.loading": { "en-US": "Loading...", "ja-JP": "読み込み中…", "ko-KR": "로드 중...", "vi-VN": "Đang tải..." },
  "common.newTask": { "en-US": "New task", "ja-JP": "新しいタスク", "ko-KR": "새 작업", "vi-VN": "Tác vụ mới" },
  "common.history": { "en-US": "History", "ja-JP": "履歴", "ko-KR": "기록", "vi-VN": "Lịch sử" },
  "common.searchModels": { "en-US": "Search models...", "ja-JP": "モデルを検索…", "ko-KR": "모델 검색...", "vi-VN": "Tìm model..." },
  "common.searchAgents": { "en-US": "Search agents...", "ja-JP": "エージェントを検索…", "ko-KR": "에이전트 검색...", "vi-VN": "Tìm agent..." },
  "common.recharge": { "en-US": "Recharge", "ja-JP": "チャージ", "ko-KR": "충전", "vi-VN": "Nạp tiền" },
  "nav.models": { "en-US": "Models", "ja-JP": "モデル", "ko-KR": "모델", "vi-VN": "Model" },
  "nav.agents": { "en-US": "Agents", "ja-JP": "エージェント", "ko-KR": "에이전트", "vi-VN": "Agent" },
  "nav.gallery": { "en-US": "Inspiration Gallery", "ja-JP": "インスピレーションギャラリー", "ko-KR": "영감 갤러리", "vi-VN": "Thư viện cảm hứng" },
  "nav.chat": { "en-US": "Chat", "ja-JP": "チャット", "ko-KR": "채팅", "vi-VN": "Chat" },
  "nav.image": { "en-US": "Images", "ja-JP": "画像", "ko-KR": "이미지", "vi-VN": "Hình ảnh" },
  "nav.video": { "en-US": "Video", "ja-JP": "動画", "ko-KR": "동영상", "vi-VN": "Video" },
  "nav.audio": { "en-US": "Audio", "ja-JP": "音声", "ko-KR": "오디오", "vi-VN": "Âm thanh" },
  "workspace.defaultModelDesc": { "en-US": "Choose a model and start creating.", "ja-JP": "モデルを選択して作成を始めましょう。", "ko-KR": "모델을 선택하고 창작을 시작하세요.", "vi-VN": "Chọn một model để bắt đầu sáng tạo." },
  "workspace.placeholder.chat": { "en-US": "Type a message, press Enter to send...", "ja-JP": "メッセージを入力してEnterで送信…", "ko-KR": "메시지를 입력하고 Enter를 눌러 전송하세요...", "vi-VN": "Nhập tin nhắn, nhấn Enter để gửi..." },
  "workspace.placeholder.image": { "en-US": "Describe the image you want to generate...", "ja-JP": "生成したい画像を説明してください…", "ko-KR": "생성할 이미지를 설명하세요...", "vi-VN": "Mô tả hình ảnh bạn muốn tạo..." },
  "workspace.placeholder.video": { "en-US": "Describe the video you want to generate...", "ja-JP": "生成したい動画を説明してください…", "ko-KR": "생성할 동영상을 설명하세요...", "vi-VN": "Mô tả video bạn muốn tạo..." },
  "workspace.placeholder.audio": { "en-US": "Enter audio generation requirements...", "ja-JP": "音声生成の要件を入力してください…", "ko-KR": "음성 생성 요구 사항을 입력하세요...", "vi-VN": "Nhập yêu cầu tạo âm thanh..." },
  "category.chat": { "en-US": "Chat", "ja-JP": "チャット", "ko-KR": "채팅", "vi-VN": "Chat" },
  "category.image": { "en-US": "Image", "ja-JP": "画像", "ko-KR": "이미지", "vi-VN": "Hình ảnh" },
  "category.video": { "en-US": "Video", "ja-JP": "動画", "ko-KR": "동영상", "vi-VN": "Video" },
  "category.audio": { "en-US": "Audio", "ja-JP": "音声", "ko-KR": "오디오", "vi-VN": "Âm thanh" },
};

// Some newer surfaces use a source sentence instead of a dictionary key.
// Keep these translations in the bundle so the first render never depends on
// the optional AI translation service.
const BUILTIN_SOURCE_TRANSLATIONS: Record<string, Record<string, string>> = {
  "API 文档中心": { "en-US": "API Documentation", "ja-JP": "API ドキュメント", "ko-KR": "API 문서", "vi-VN": "Tài liệu API" },
  "聊天与文本": { "en-US": "Chat & text", "ja-JP": "チャットとテキスト", "ko-KR": "채팅 및 텍스트", "vi-VN": "Trò chuyện & văn bản" },
  "平台": { "en-US": "Platform", "ja-JP": "プラットフォーム", "ko-KR": "플랫폼", "vi-VN": "Nền tảng" },
  "图片": { "en-US": "Images", "ja-JP": "画像", "ko-KR": "이미지", "vi-VN": "Hình ảnh" },
  "视频": { "en-US": "Video", "ja-JP": "動画", "ko-KR": "동영상", "vi-VN": "Video" },
  "音频": { "en-US": "Audio", "ja-JP": "音声", "ko-KR": "오디오", "vi-VN": "Âm thanh" },
  "支持的模型": { "en-US": "Supported models", "ja-JP": "対応モデル", "ko-KR": "지원 모델", "vi-VN": "Mô hình được hỗ trợ" },
  "当前没有已发布的模型文档。": { "en-US": "No published model documentation is available.", "ja-JP": "公開済みのモデルドキュメントはありません。", "ko-KR": "게시된 모델 문서가 없습니다.", "vi-VN": "Chưa có tài liệu mô hình được xuất bản." },
  "在线调试": { "en-US": "Online debugging", "ja-JP": "オンラインデバッグ", "ko-KR": "온라인 디버깅", "vi-VN": "Gỡ lỗi trực tuyến" },
  "仅当前页面使用，不保存 API Key": { "en-US": "Used on this page only; API keys are not saved", "ja-JP": "このページのみで使用し、API Key は保存されません", "ko-KR": "이 페이지에서만 사용하며 API Key는 저장되지 않습니다", "vi-VN": "Chỉ dùng trên trang này; API Key không được lưu" },
  "填写 API Key 后发送真实请求。接口地址可以按部署环境修改；任务查询接口需要先替换路径中的 task_no。": { "en-US": "Enter an API key to send a real request. Adjust the endpoint for your deployment; replace task_no before calling task APIs.", "ja-JP": "API Key を入力して実際のリクエストを送信します。環境に合わせてエンドポイントを変更し、タスク API の task_no を置き換えてください。", "ko-KR": "API Key를 입력하면 실제 요청을 보냅니다. 배포 환경에 맞게 엔드포인트를 수정하고 작업 API의 task_no를 바꾸세요.", "vi-VN": "Nhập API Key để gửi yêu cầu thật. Điều chỉnh endpoint theo môi trường triển khai và thay task_no trước khi gọi API tác vụ." },
  "请求地址": { "en-US": "Endpoint", "ja-JP": "エンドポイント", "ko-KR": "엔드포인트", "vi-VN": "Endpoint" },
  "请求体 JSON": { "en-US": "Request body JSON", "ja-JP": "リクエスト本文 JSON", "ko-KR": "요청 본문 JSON", "vi-VN": "JSON nội dung yêu cầu" },
  "请求体": { "en-US": "Request body", "ja-JP": "リクエストボディ", "ko-KR": "요청 본문", "vi-VN": "Nội dung yêu cầu" },
  "响应体": { "en-US": "Response body", "ja-JP": "レスポンスボディ", "ko-KR": "응답 본문", "vi-VN": "Nội dung phản hồi" },
  "错误码": { "en-US": "Error codes", "ja-JP": "エラーコード", "ko-KR": "오류 코드", "vi-VN": "Mã lỗi" },
  "错误标识": { "en-US": "Error identifier", "ja-JP": "エラー識別子", "ko-KR": "오류 식별자", "vi-VN": "Mã nhận diện lỗi" },
  "填写 API Key": { "en-US": "Enter API key", "ja-JP": "API Key を入力", "ko-KR": "API Key 입력", "vi-VN": "Nhập API Key" },
  "发送请求": { "en-US": "Send request", "ja-JP": "リクエストを送信", "ko-KR": "요청 보내기", "vi-VN": "Gửi yêu cầu" },
  "请求中...": { "en-US": "Sending...", "ja-JP": "送信中...", "ko-KR": "요청 중...", "vi-VN": "Đang gửi..." },
  "启用实时流式响应": { "en-US": "Enable streaming response", "ja-JP": "ストリーミング応答を有効化", "ko-KR": "실시간 스트리밍 응답 사용", "vi-VN": "Bật phản hồi dạng luồng" },
  "API Key": { "en-US": "API key", "ja-JP": "API Key", "ko-KR": "API Key", "vi-VN": "API Key" },
  "请求格式": { "en-US": "Request format", "ja-JP": "リクエスト形式", "ko-KR": "요청 형식", "vi-VN": "Định dạng yêu cầu" },
  "响应模式": { "en-US": "Response mode", "ja-JP": "応答モード", "ko-KR": "응답 모드", "vi-VN": "Chế độ phản hồi" },
  "鉴权方式": { "en-US": "Authentication", "ja-JP": "認証方式", "ko-KR": "인증 방식", "vi-VN": "Xác thực" },
  "接口协议": { "en-US": "API protocol", "ja-JP": "API プロトコル", "ko-KR": "API 프로토콜", "vi-VN": "Giao thức API" },
  "调用约定": { "en-US": "Request conventions", "ja-JP": "呼び出し規約", "ko-KR": "호출 규칙", "vi-VN": "Quy ước gọi" },
  "平台能力": { "en-US": "Platform capabilities", "ja-JP": "プラットフォーム機能", "ko-KR": "플랫폼 기능", "vi-VN": "Năng lực nền tảng" },
  "请求头": { "en-US": "Request headers", "ja-JP": "リクエストヘッダー", "ko-KR": "요청 헤더", "vi-VN": "Header yêu cầu" },
  "请求示例": { "en-US": "Request example", "ja-JP": "リクエスト例", "ko-KR": "요청 예시", "vi-VN": "Ví dụ yêu cầu" },
  "响应示例": { "en-US": "Response example", "ja-JP": "レスポンス例", "ko-KR": "응답 예시", "vi-VN": "Ví dụ phản hồi" },
  "请求参数": { "en-US": "Request parameters", "ja-JP": "リクエストパラメータ", "ko-KR": "요청 매개변수", "vi-VN": "Tham số yêu cầu" },
  "响应状态": { "en-US": "Response status", "ja-JP": "レスポンスステータス", "ko-KR": "응답 상태", "vi-VN": "Trạng thái phản hồi" },
  "异步任务流程": { "en-US": "Asynchronous task flow", "ja-JP": "非同期タスクフロー", "ko-KR": "비동기 작업 흐름", "vi-VN": "Quy trình tác vụ bất đồng bộ" },
  "流式事件": { "en-US": "Streaming events", "ja-JP": "ストリーミングイベント", "ko-KR": "스트리밍 이벤트", "vi-VN": "Sự kiện dạng luồng" },
  "复制地址": { "en-US": "Copy endpoint", "ja-JP": "エンドポイントをコピー", "ko-KR": "엔드포인트 복사", "vi-VN": "Sao chép endpoint" },
  "复制示例": { "en-US": "Copy example", "ja-JP": "例をコピー", "ko-KR": "예시 복사", "vi-VN": "Sao chép ví dụ" },
  "已复制": { "en-US": "Copied", "ja-JP": "コピーしました", "ko-KR": "복사됨", "vi-VN": "Đã sao chép" },
  "生成图片": { "en-US": "Generate images", "ja-JP": "画像を生成", "ko-KR": "이미지 생성", "vi-VN": "Tạo hình ảnh" },
  "创建视频": { "en-US": "Create video", "ja-JP": "動画を作成", "ko-KR": "동영상 생성", "vi-VN": "Tạo video" },
  "生成语音": { "en-US": "Generate speech", "ja-JP": "音声を生成", "ko-KR": "음성 생성", "vi-VN": "Tạo giọng nói" },
  "图片生成提示词": { "en-US": "Image generation prompt", "ja-JP": "画像生成プロンプト", "ko-KR": "이미지 생성 프롬프트", "vi-VN": "Prompt tạo ảnh" },
  "生成数量，默认 1": { "en-US": "Number of images to generate; defaults to 1", "ja-JP": "生成枚数。デフォルトは1", "ko-KR": "생성할 이미지 수이며 기본값은 1입니다", "vi-VN": "Số lượng ảnh cần tạo; mặc định là 1" },
  "比例，例如 1:1、16:9、9:16、4:3、3:4": { "en-US": "Aspect ratio, such as 1:1, 16:9, 9:16, 4:3, or 3:4", "ja-JP": "アスペクト比。例: 1:1、16:9、9:16、4:3、3:4", "ko-KR": "종횡비(예: 1:1, 16:9, 9:16, 4:3, 3:4)", "vi-VN": "Tỷ lệ khung hình, ví dụ 1:1, 16:9, 9:16, 4:3 hoặc 3:4" },
  "清晰度档位，例如 1K、2K、4K": { "en-US": "Resolution tier, such as 1K, 2K, or 4K", "ja-JP": "解像度レベル。例: 1K、2K、4K", "ko-KR": "해상도 단계(예: 1K, 2K, 4K)", "vi-VN": "Mức độ phân giải, ví dụ 1K, 2K hoặc 4K" },
  "实际像素尺寸，例如 1024x1024、3840x2160": { "en-US": "Pixel dimensions, such as 1024x1024 or 3840x2160", "ja-JP": "実際のピクセルサイズ。例: 1024x1024、3840x2160", "ko-KR": "실제 픽셀 크기(예: 1024x1024, 3840x2160)", "vi-VN": "Kích thước pixel thực tế, ví dụ 1024x1024 hoặc 3840x2160" },
  "参考图 URL，支持单张或数组": { "en-US": "Reference image URL; accepts a single URL or an array", "ja-JP": "参照画像URL。単一URLまたは配列に対応", "ko-KR": "참조 이미지 URL이며 단일 URL 또는 배열을 지원합니다", "vi-VN": "URL ảnh tham chiếu; hỗ trợ một URL hoặc một mảng" },
  "视频生成提示词": { "en-US": "Video generation prompt", "ja-JP": "動画生成プロンプト", "ko-KR": "동영상 생성 프롬프트", "vi-VN": "Prompt tạo video" },
  "视频时长，以后台模型支持为准，例如 12s": { "en-US": "Video duration, subject to the configured model; for example, 12s", "ja-JP": "動画の長さ。設定済みモデルに準拠。例: 12s", "ko-KR": "동영상 길이이며 구성된 모델 지원 범위를 따릅니다(예: 12s)", "vi-VN": "Thời lượng video, tùy theo model đã cấu hình; ví dụ 12s" },
  "画面方向，例如 portrait / landscape": { "en-US": "Orientation, such as portrait or landscape", "ja-JP": "画面の向き。例: portrait / landscape", "ko-KR": "화면 방향(예: portrait / landscape)", "vi-VN": "Hướng khung hình, ví dụ portrait / landscape" },
  "画面比例，例如 9:16、16:9": { "en-US": "Aspect ratio, such as 9:16 or 16:9", "ja-JP": "アスペクト比。例: 9:16、16:9", "ko-KR": "종횡비(예: 9:16, 16:9)", "vi-VN": "Tỷ lệ khung hình, ví dụ 9:16 hoặc 16:9" },
  "图生视频参考图 URL": { "en-US": "Image-to-video reference image URL", "ja-JP": "画像から動画への参照画像URL", "ko-KR": "이미지-투-비디오 참조 이미지 URL", "vi-VN": "URL ảnh tham chiếu để tạo video từ ảnh" },
  "需要合成的文本": { "en-US": "Text to synthesize", "ja-JP": "合成するテキスト", "ko-KR": "합성할 텍스트", "vi-VN": "Văn bản cần tổng hợp" },
  "音色，以后台模型支持为准": { "en-US": "Voice, subject to the configured model", "ja-JP": "音声。設定済みモデルに準拠", "ko-KR": "음성이며 구성된 모델 지원 범위를 따릅니다", "vi-VN": "Giọng đọc, tùy theo model đã cấu hình" },
  "输出格式，例如 mp3 / wav": { "en-US": "Output format, such as mp3 or wav", "ja-JP": "出力形式。例: mp3 / wav", "ko-KR": "출력 형식(예: mp3 / wav)", "vi-VN": "Định dạng đầu ra, ví dụ mp3 hoặc wav" },
  "尺寸": { "en-US": "Size", "ja-JP": "サイズ", "ko-KR": "크기", "vi-VN": "Kích thước" },
  "数量": { "en-US": "Quantity", "ja-JP": "数量", "ko-KR": "수량", "vi-VN": "Số lượng" },
  "风格": { "en-US": "Style", "ja-JP": "スタイル", "ko-KR": "스타일", "vi-VN": "Phong cách" },
  "视频尺寸": { "en-US": "Video size", "ja-JP": "動画サイズ", "ko-KR": "동영상 크기", "vi-VN": "Kích thước video" },
  "视频时长": { "en-US": "Video duration", "ja-JP": "動画の長さ", "ko-KR": "동영상 길이", "vi-VN": "Thời lượng video" },
  "画幅": { "en-US": "Aspect ratio", "ja-JP": "画面比率", "ko-KR": "화면 비율", "vi-VN": "Tỷ lệ khung hình" },
  "画面方向": { "en-US": "Orientation", "ja-JP": "画面の向き", "ko-KR": "화면 방향", "vi-VN": "Hướng khung hình" },
  "速度版本": { "en-US": "Speed version", "ja-JP": "速度バージョン", "ko-KR": "속도 버전", "vi-VN": "Phiên bản tốc độ" },
  "画质宽高比": { "en-US": "Quality aspect ratio", "ja-JP": "画質アスペクト比", "ko-KR": "화질 종횡비", "vi-VN": "Tỷ lệ khung hình chất lượng" },
  "分辨率": { "en-US": "Resolution", "ja-JP": "解像度", "ko-KR": "해상도", "vi-VN": "Độ phân giải" },
  "生成模式": { "en-US": "Generation mode", "ja-JP": "生成モード", "ko-KR": "생성 모드", "vi-VN": "Chế độ tạo" },
  "视频比例": { "en-US": "Video aspect ratio", "ja-JP": "動画比率", "ko-KR": "동영상 비율", "vi-VN": "Tỷ lệ video" },
  "提示词优化": { "en-US": "Prompt enhancement", "ja-JP": "プロンプト最適化", "ko-KR": "프롬프트 최적화", "vi-VN": "Tối ưu prompt" },
  "视频超分": { "en-US": "Video upscaling", "ja-JP": "動画超解像", "ko-KR": "동영상 업스케일링", "vi-VN": "Nâng cấp video" },
  "音色模式": { "en-US": "Voice mode", "ja-JP": "音声モード", "ko-KR": "음색 모드", "vi-VN": "Chế độ giọng" },
  "语速": { "en-US": "Speech speed", "ja-JP": "速度", "ko-KR": "말하기 속도", "vi-VN": "Tốc độ đọc" },
  "音调": { "en-US": "Pitch", "ja-JP": "音程", "ko-KR": "음정", "vi-VN": "Cao độ" },
  "情感": { "en-US": "Emotion", "ja-JP": "感情", "ko-KR": "감정", "vi-VN": "Cảm xúc" },
  "纯音乐": { "en-US": "Instrumental", "ja-JP": "インストゥルメンタル", "ko-KR": "연주곡", "vi-VN": "Nhạc không lời" },
  "歌词优化": { "en-US": "Lyric enhancement", "ja-JP": "歌詞最適化", "ko-KR": "가사 최적화", "vi-VN": "Tối ưu lời bài hát" },
  "AIGC 水印": { "en-US": "AIGC watermark", "ja-JP": "AIGCウォーターマーク", "ko-KR": "AIGC 워터마크", "vi-VN": "Hình mờ AIGC" },
  "请输入音乐描述...": { "en-US": "Enter a music description...", "ja-JP": "音楽の説明を入力…", "ko-KR": "음악 설명을 입력하세요...", "vi-VN": "Nhập mô tả âm nhạc..." },
  "按用户和 API Key 限流": { "en-US": "Rate-limited by user and API key", "ja-JP": "ユーザーとAPIキー単位でレート制限", "ko-KR": "사용자 및 API Key 기준으로 요청이 제한됩니다", "vi-VN": "Giới hạn tốc độ theo người dùng và API Key" },
  "创建任务成功后轮询任务详情；status=succeeded 时读取 output，status=failed 时读取 error_message。": { "en-US": "After task creation, poll the task details; read output when status=succeeded and error_message when status=failed.", "ja-JP": "タスク作成後に詳細をポーリングします。status=succeededではoutput、status=failedではerror_messageを読み取ります。", "ko-KR": "작업 생성 후 작업 상세 정보를 폴링합니다. status=succeeded이면 output을, status=failed이면 error_message를 읽습니다.", "vi-VN": "Sau khi tạo tác vụ, hãy polling chi tiết tác vụ; đọc output khi status=succeeded và error_message khi status=failed." },
  "请求参数错误，例如 model 不存在或未启用": { "en-US": "Invalid request parameters, for example when model does not exist or is not enabled", "ja-JP": "リクエストパラメータエラー。modelが存在しない、または有効化されていない場合など", "ko-KR": "요청 매개변수 오류(예: model이 없거나 활성화되지 않음)", "vi-VN": "Tham số yêu cầu không hợp lệ, ví dụ model không tồn tại hoặc chưa bật" },
  "模型不存在或未启用，请检查 model 是否为后台模型编码或接入模型名": { "en-US": "Model does not exist or is not enabled. Check that model is a configured platform code or upstream model name.", "ja-JP": "モデルが存在しないか、有効化されていません。modelが設定済みのプラットフォームコードまたは上流モデル名か確認してください。", "ko-KR": "모델이 없거나 활성화되지 않았습니다. model이 구성된 플랫폼 코드 또는 상위 모델 이름인지 확인하세요.", "vi-VN": "Model không tồn tại hoặc chưa bật. Hãy kiểm tra model là mã nền tảng hoặc tên model upstream đã cấu hình." },
  "为莫来石产品生成电商商品主图，白底，高级质感，真实摄影风格": { "en-US": "Create an e-commerce hero image for a mullite product with a white background, premium feel, and realistic photography.", "ja-JP": "ムライト製品のECメイン画像を、白背景・高級感・リアルな写真風で作成します。", "ko-KR": "흰색 배경과 고급스러운 질감의 사실적인 사진 스타일로 멀라이트 제품의 쇼핑몰 대표 이미지를 생성합니다.", "vi-VN": "Tạo ảnh chính thương mại điện tử cho sản phẩm mullite với nền trắng, cảm giác cao cấp và phong cách chụp ảnh chân thực." },
  "生成一段商品展示短视频，突出产品质感、卖点和镜头推进": { "en-US": "Create a short product showcase video highlighting the product texture, selling points, and camera movement.", "ja-JP": "商品の質感、セールスポイント、カメラのプッシュインを強調した短い商品紹介動画を作成します。", "ko-KR": "제품의 질감, 장점 및 카메라 전진 연출을 강조하는 짧은 상품 소개 동영상을 생성합니다.", "vi-VN": "Tạo video giới thiệu sản phẩm ngắn, làm nổi bật chất liệu, điểm bán hàng và chuyển động máy quay." },
  "欢迎使用 StarAI 开放平台。": { "en-US": "Welcome to the StarAI Open Platform.", "ja-JP": "StarAIオープンプラットフォームへようこそ。", "ko-KR": "StarAI 오픈 플랫폼에 오신 것을 환영합니다.", "vi-VN": "Chào mừng bạn đến với Nền tảng mở StarAI." },
  "MiniMax 海螺语音克隆模型。支持上传音频复刻专属音色，提供 HD 高清与 Turbo 极速两种合成质量，可调语速、音调、情感与音效。": { "en-US": "MiniMax Hailuo voice cloning model. Upload an audio sample to replicate a custom voice. Choose HD or Turbo synthesis quality, with adjustable speed, pitch, emotion, and sound effects.", "ja-JP": "MiniMax Hailuo音声クローンモデル。音声サンプルをアップロードして専用の声色を再現できます。HDまたはTurboの合成品質を選択でき、速度・音程・感情・効果音を調整できます。", "ko-KR": "MiniMax Hailuo 음성 복제 모델입니다. 오디오 샘플을 업로드해 전용 음색을 복제할 수 있으며 HD 또는 Turbo 합성 품질, 속도·음정·감정·음향 효과를 조절할 수 있습니다.", "vi-VN": "Model nhân bản giọng nói MiniMax Hailuo. Tải mẫu âm thanh lên để tái tạo giọng tùy chỉnh, chọn chất lượng HD hoặc Turbo và điều chỉnh tốc độ, cao độ, cảm xúc cùng hiệu ứng âm thanh." },
  "快速图片生成，支持多种尺寸": { "en-US": "Fast image generation with multiple size options", "ja-JP": "複数サイズに対応した高速画像生成", "ko-KR": "다양한 크기를 지원하는 빠른 이미지 생성", "vi-VN": "Tạo ảnh nhanh với nhiều tùy chọn kích thước" },
  "文本生成短视频，支持时长与画幅设置": { "en-US": "Text-to-video generation with configurable duration and aspect ratio", "ja-JP": "長さと画面比率を設定できるテキストから動画への生成", "ko-KR": "길이와 화면 비율을 설정할 수 있는 텍스트-투-비디오 생성", "vi-VN": "Tạo video từ văn bản với thời lượng và tỷ lệ khung hình tùy chỉnh" },
  "单参考图视频生成，支持时长与画幅方向": { "en-US": "Video generation from a single reference image with configurable duration and orientation", "ja-JP": "単一参照画像から動画を生成し、長さと画面方向を設定できます", "ko-KR": "단일 참조 이미지로 동영상을 생성하며 길이와 화면 방향을 설정할 수 있습니다", "vi-VN": "Tạo video từ một ảnh tham chiếu với thời lượng và hướng khung hình tùy chỉnh" },
  "多参考图一致风格视频，支持速度/时长/比例/分辨率": { "en-US": "Consistent-style video from multiple reference images with configurable speed, duration, aspect ratio, and resolution", "ja-JP": "複数の参照画像から一貫したスタイルの動画を生成し、速度・長さ・比率・解像度を設定できます", "ko-KR": "여러 참조 이미지로 일관된 스타일의 동영상을 생성하며 속도, 길이, 비율 및 해상도를 설정할 수 있습니다", "vi-VN": "Tạo video phong cách nhất quán từ nhiều ảnh tham chiếu, hỗ trợ tùy chỉnh tốc độ, thời lượng, tỷ lệ và độ phân giải" },
  "首尾帧 + 参考图，支持生成模式/比例/提示词优化/超分": { "en-US": "First and last frames plus reference images, with generation mode, aspect ratio, prompt enhancement, and upscaling controls", "ja-JP": "始端・終端フレームと参照画像に対応し、生成モード・比率・プロンプト最適化・超解像を設定できます", "ko-KR": "시작·끝 프레임과 참조 이미지를 지원하며 생성 모드, 비율, 프롬프트 최적화 및 업스케일링을 설정할 수 있습니다", "vi-VN": "Hỗ trợ khung hình đầu/cuối và ảnh tham chiếu, cùng các tùy chọn chế độ tạo, tỷ lệ, tối ưu prompt và nâng cấp độ phân giải" },
  "字节跳动豆包语音合成 2.0。数百种音色、多种情感，支持长文本合成（最高 10 万字），输出 MP3/WAV/PCM。": { "en-US": "ByteDance Doubao Text-to-Speech 2.0. Offers hundreds of voices and multiple emotions, supports long-form synthesis up to 100,000 Chinese characters, and outputs MP3, WAV, or PCM.", "ja-JP": "ByteDance Doubao音声合成2.0。数百種類の音声と複数の感情に対応し、最大10万字の長文合成とMP3・WAV・PCM出力をサポートします。", "ko-KR": "ByteDance Doubao 텍스트 음성 변환 2.0입니다. 수백 가지 음색과 다양한 감정을 제공하고 최대 10만 자의 긴 텍스트 합성 및 MP3·WAV·PCM 출력을 지원합니다.", "vi-VN": "Doubao Text-to-Speech 2.0 của ByteDance. Cung cấp hàng trăm giọng đọc và nhiều cảm xúc, hỗ trợ tổng hợp văn bản dài tối đa 100.000 ký tự tiếng Trung, xuất MP3, WAV hoặc PCM." },
  "Google Gemini 3.1 Flash TTS。提供 30 种音色与 24 种语言，支持用自然语言控制情感变化与语气推进。": { "en-US": "Google Gemini 3.1 Flash TTS. Provides 30 voices and 24 languages, with natural-language control over emotional variation and delivery.", "ja-JP": "Google Gemini 3.1 Flash TTS。30種類の音声と24言語に対応し、自然言語で感情の変化や話し方を制御できます。", "ko-KR": "Google Gemini 3.1 Flash TTS입니다. 30개 음색과 24개 언어를 제공하며 자연어로 감정 변화와 말투를 제어할 수 있습니다.", "vi-VN": "Google Gemini 3.1 Flash TTS. Cung cấp 30 giọng đọc và 24 ngôn ngữ, hỗ trợ điều khiển biến đổi cảm xúc và cách đọc bằng ngôn ngữ tự nhiên." },
  "Google Gemini 3.1 Flash TTS。30 种音色、24 种语言，可用自然语言描述情绪起伏与递进。": { "en-US": "Google Gemini 3.1 Flash TTS. Provides 30 voices and 24 languages; describe emotional variation and progression in natural language.", "ja-JP": "Google Gemini 3.1 Flash TTS。30種類の音声と24言語に対応し、自然言語で感情の起伏や変化を指定できます。", "ko-KR": "Google Gemini 3.1 Flash TTS입니다. 30개 음색과 24개 언어를 제공하며 자연어로 감정의 변화와 고조를 설명할 수 있습니다.", "vi-VN": "Google Gemini 3.1 Flash TTS. Cung cấp 30 giọng đọc và 24 ngôn ngữ; bạn có thể mô tả diễn biến và mức độ cảm xúc bằng ngôn ngữ tự nhiên." },
  "Suno V4.5 歌词生曲。支持歌曲/纯音乐模式，最长约 4 分钟，含歌词与卡拉 OK 字幕输出。": { "en-US": "Suno V4.5 lyric-to-song generation. Supports song and instrumental modes, up to about four minutes, with lyrics and karaoke subtitle output.", "ja-JP": "Suno V4.5歌詞から楽曲を生成。歌唱曲・インストゥルメンタルモードに対応し、約4分までの歌詞とカラオケ字幕を出力できます。", "ko-KR": "Suno V4.5 가사-음악 생성입니다. 노래 및 연주곡 모드를 지원하고 약 4분 길이까지 가사와 노래방 자막을 출력합니다.", "vi-VN": "Tạo bài hát từ lời bài hát với Suno V4.5. Hỗ trợ chế độ bài hát/nhạc không lời, thời lượng khoảng 4 phút và xuất lời bài hát cùng phụ đề karaoke." },
  "MiniMax Speech 2.8 HD 高保真文本转语音，支持 Voice ID、Emotion、Format、Speed 等参数。": { "en-US": "MiniMax Speech 2.8 HD high-fidelity text-to-speech with Voice ID, Emotion, Format, Speed, and other parameters.", "ja-JP": "MiniMax Speech 2.8 HD高忠実度テキスト音声合成。Voice ID、Emotion、Format、Speedなどのパラメータに対応します。", "ko-KR": "MiniMax Speech 2.8 HD 고음질 텍스트 음성 변환으로 Voice ID, Emotion, Format, Speed 등의 매개변수를 지원합니다.", "vi-VN": "Chuyển văn bản thành giọng nói độ trung thực cao với MiniMax Speech 2.8 HD, hỗ trợ các tham số Voice ID, Emotion, Format, Speed và hơn thế nữa." },
  "MiniMax Music-2.6 文本生成音乐。输入歌词与歌曲描述，支持纯音乐、歌词优化、采样率、码率和输出格式配置。": { "en-US": "MiniMax Music-2.6 text-to-music generation. Enter lyrics and a song description, with controls for instrumental mode, lyric optimization, sample rate, bitrate, and output format.", "ja-JP": "MiniMax Music-2.6テキストから音楽を生成。歌詞と曲の説明を入力し、インストゥルメンタル、歌詞最適化、サンプルレート、ビットレート、出力形式を設定できます。", "ko-KR": "MiniMax Music-2.6 텍스트-투-뮤직 생성입니다. 가사와 곡 설명을 입력하고 연주곡 모드, 가사 최적화, 샘플레이트, 비트레이트 및 출력 형식을 설정할 수 있습니다.", "vi-VN": "Tạo nhạc từ văn bản với MiniMax Music-2.6. Nhập lời bài hát và mô tả, đồng thời cấu hình chế độ nhạc không lời, tối ưu lời, sample rate, bitrate và định dạng đầu ra." },
  "MiniMax Speech 2.8 官方语音合成，支持 HD / Turbo、音色、情绪、语言增强、字幕及完整音频输出配置。": { "en-US": "Official MiniMax Speech 2.8 synthesis with HD/Turbo models, voices, emotions, language enhancement, subtitles, and complete audio output controls.", "ja-JP": "MiniMax Speech 2.8公式音声合成。HD/Turbo、音色、感情、言語強化、字幕、完全な音声出力設定に対応します。", "ko-KR": "MiniMax Speech 2.8 공식 음성 합성입니다. HD/Turbo, 음색, 감정, 언어 강화, 자막 및 전체 오디오 출력 설정을 지원합니다.", "vi-VN": "Tổng hợp giọng nói MiniMax Speech 2.8 chính thức, hỗ trợ HD/Turbo, giọng đọc, cảm xúc, tăng cường ngôn ngữ, phụ đề và đầy đủ cấu hình đầu ra âm thanh." },
  "MiniMax Music 3.0 / 2.6 官方音乐生成。输入音乐描述与歌词，支持纯音乐、歌词优化、采样率、码率和返回格式配置。": { "en-US": "Official MiniMax Music 3.0/2.6 generation. Enter a music description and lyrics, with controls for instrumental mode, lyric optimization, sample rate, bitrate, and response format.", "ja-JP": "MiniMax Music 3.0/2.6公式音楽生成。音楽の説明と歌詞を入力し、インストゥルメンタル、歌詞最適化、サンプルレート、ビットレート、返却形式を設定できます。", "ko-KR": "MiniMax Music 3.0/2.6 공식 음악 생성입니다. 음악 설명과 가사를 입력하고 연주곡, 가사 최적화, 샘플레이트, 비트레이트 및 반환 형식을 설정할 수 있습니다.", "vi-VN": "Tạo nhạc MiniMax Music 3.0/2.6 chính thức. Nhập mô tả âm nhạc và lời bài hát, với các tùy chọn nhạc không lời, tối ưu lời, sample rate, bitrate và định dạng trả về." },
  "电商一键出图": { "en-US": "One-click e-commerce images", "ja-JP": "EC画像をワンクリック生成", "ko-KR": "원클릭 이커머스 이미지", "vi-VN": "Tạo ảnh thương mại điện tử một chạm" },
  "上传商品图与描述，AI 自动识别并出图，多轮对话精准补全，每步可控一键出图。": { "en-US": "Upload a product image and description. AI identifies the product and generates images, while multi-turn conversation fills in details with step-by-step control.", "ja-JP": "商品画像と説明をアップロードすると、AIが自動認識して画像を生成します。マルチターン対話で詳細を補完し、各ステップを制御できます。", "ko-KR": "상품 이미지와 설명을 업로드하면 AI가 자동으로 인식해 이미지를 생성합니다. 멀티턴 대화로 세부 정보를 보완하고 각 단계를 제어할 수 있습니다.", "vi-VN": "Tải ảnh và mô tả sản phẩm lên để AI tự nhận diện và tạo ảnh; hội thoại nhiều lượt sẽ bổ sung chi tiết với khả năng kiểm soát từng bước." },
  "通用一键生图": { "en-US": "General one-click image generation", "ja-JP": "汎用ワンクリック画像生成", "ko-KR": "범용 원클릭 이미지 생성", "vi-VN": "Tạo ảnh tổng quát một chạm" },
  "描述你想生成的图片，AI 智能分析需求并推荐方案，多轮对话逐张可控。": { "en-US": "Describe the image you want. AI analyzes your request and recommends options, with per-image control through multi-turn conversation.", "ja-JP": "生成したい画像を説明すると、AIが要望を分析して案を提案します。マルチターン対話で画像ごとに調整できます。", "ko-KR": "원하는 이미지를 설명하면 AI가 요구 사항을 분석해 옵션을 추천하고 멀티턴 대화로 이미지를 하나씩 제어할 수 있습니다.", "vi-VN": "Mô tả ảnh bạn muốn tạo; AI phân tích yêu cầu và đề xuất phương án, cho phép kiểm soát từng ảnh qua hội thoại nhiều lượt." },
  "商品与卖点分析": { "en-US": "Product and selling-point analysis", "ja-JP": "商品とセールスポイントの分析", "ko-KR": "상품 및 판매 포인트 분석", "vi-VN": "Phân tích sản phẩm và điểm bán hàng" },
  "识别商品、已确认参数和可用卖点": { "en-US": "Identify the product, confirmed parameters, and usable selling points", "ja-JP": "商品、確認済みパラメータ、利用可能な訴求点を識別", "ko-KR": "상품, 확인된 매개변수 및 활용 가능한 판매 포인트를 식별합니다", "vi-VN": "Nhận diện sản phẩm, thông số đã xác nhận và điểm bán hàng có thể sử dụng" },
  "详情页模块规划": { "en-US": "Detail-page module planning", "ja-JP": "詳細ページのモジュール設計", "ko-KR": "상세 페이지 모듈 기획", "vi-VN": "Lập kế hoạch mô-đun trang chi tiết" },
  "按首屏、卖点、细节、场景和规格拆分模块": { "en-US": "Split modules by hero section, selling points, details, scenes, and specifications", "ja-JP": "ファーストビュー、訴求点、詳細、シーン、仕様に分けてモジュール化", "ko-KR": "첫 화면, 판매 포인트, 세부 정보, 장면 및 사양별로 모듈을 나눕니다", "vi-VN": "Chia mô-đun theo màn hình đầu, điểm bán hàng, chi tiết, bối cảnh và thông số" },
  "模块图逐张生成": { "en-US": "Generate module images one by one", "ja-JP": "モジュール画像を1枚ずつ生成", "ko-KR": "모듈 이미지를 한 장씩 생성", "vi-VN": "Tạo từng ảnh mô-đun" },
  "每个模块使用独立提示词并保持商品一致": { "en-US": "Use an independent prompt for each module while keeping the product consistent", "ja-JP": "各モジュールに個別プロンプトを使用し、商品を一貫させます", "ko-KR": "각 모듈에 독립 프롬프트를 사용하면서 상품 일관성을 유지합니다", "vi-VN": "Dùng prompt riêng cho từng mô-đun và giữ sản phẩm nhất quán" },
  "详情长图合成": { "en-US": "Compose the long detail image", "ja-JP": "詳細ページのロング画像を合成", "ko-KR": "상세 롱 이미지 합성", "vi-VN": "Ghép ảnh dài trang chi tiết" },
  "模块图安全生成后自动按顺序拼接成长图": { "en-US": "Safely generate module images and automatically join them into a long image in order", "ja-JP": "モジュール画像を安全に生成し、順番に連結してロング画像にします", "ko-KR": "모듈 이미지를 안전하게 생성한 뒤 순서대로 연결해 긴 이미지로 만듭니다", "vi-VN": "Tạo ảnh mô-đun an toàn rồi tự động ghép theo thứ tự thành ảnh dài" },
  "图片智能体": { "en-US": "Image agent", "ja-JP": "画像エージェント", "ko-KR": "이미지 에이전트", "vi-VN": "Agent hình ảnh" },
  "AI智能体": { "en-US": "AI agent", "ja-JP": "AIエージェント", "ko-KR": "AI 에이전트", "vi-VN": "Agent AI" },
  "多轮对话": { "en-US": "Multi-turn conversation", "ja-JP": "マルチターン対話", "ko-KR": "멀티턴 대화", "vi-VN": "Hội thoại nhiều lượt" },
  "每步可控": { "en-US": "Control every step", "ja-JP": "各ステップを制御", "ko-KR": "모든 단계 제어", "vi-VN": "Kiểm soát từng bước" },
  "上传图片+描述，AI 自动识别卖点": { "en-US": "Upload an image and description; AI automatically identifies selling points", "ja-JP": "画像と説明をアップロードすると、AIが訴求点を自動識別", "ko-KR": "이미지와 설명을 업로드하면 AI가 판매 포인트를 자동으로 식별합니다", "vi-VN": "Tải ảnh và mô tả lên; AI tự động nhận diện điểm bán hàng" },
  "AI 按需求推荐主图/详情图/场景图": { "en-US": "AI recommends hero, detail, and scene images based on your needs", "ja-JP": "AIが要望に応じてメイン・詳細・シーン画像を提案", "ko-KR": "AI가 요구에 따라 대표 이미지, 상세 이미지 및 장면 이미지를 추천합니다", "vi-VN": "AI đề xuất ảnh chính, ảnh chi tiết và ảnh bối cảnh theo nhu cầu" },
  "选风格、定方案，每张图都可调整": { "en-US": "Choose a style and plan; adjust every image individually", "ja-JP": "スタイルと案を選び、各画像を個別に調整", "ko-KR": "스타일과 계획을 선택하고 각 이미지를 개별 조정합니다", "vi-VN": "Chọn phong cách và phương án; điều chỉnh từng ảnh riêng lẻ" },
  "并发出图，质量自检，不满意一键重做": { "en-US": "Generate images concurrently, run quality checks, and redo with one click", "ja-JP": "画像を並列生成し、品質を自動確認。不満があればワンクリックで再生成", "ko-KR": "이미지를 동시에 생성하고 품질을 검사하며 만족스럽지 않으면 한 번에 다시 생성합니다", "vi-VN": "Tạo ảnh đồng thời, tự kiểm tra chất lượng và tạo lại bằng một chạm nếu chưa hài lòng" },
  "电商带货短视频": { "en-US": "E-commerce sales video", "ja-JP": "EC販売動画", "ko-KR": "이커머스 판매 동영상", "vi-VN": "Video bán hàng thương mại điện tử" },
  "输入商品信息，自动生成营销文案、商品海报与展示短视频。": { "en-US": "Enter product information to automatically generate marketing copy, product posters, and showcase videos.", "ja-JP": "商品情報を入力すると、マーケティング文案、商品ポスター、紹介動画を自動生成します。", "ko-KR": "상품 정보를 입력하면 마케팅 문구, 상품 포스터 및 소개 동영상을 자동으로 생성합니다.", "vi-VN": "Nhập thông tin sản phẩm để tự động tạo nội dung marketing, poster sản phẩm và video giới thiệu." },
  "极速生视频": { "en-US": "Fast video generation", "ja-JP": "高速動画生成", "ko-KR": "빠른 동영상 생성", "vi-VN": "Tạo video nhanh" },
  "一键视频高清": { "en-US": "One-click video enhancement", "ja-JP": "ワンクリック動画高画質化", "ko-KR": "원클릭 동영상 고화질화", "vi-VN": "Nâng cao chất lượng video một chạm" },
  "一键去字幕": { "en-US": "One-click subtitle removal", "ja-JP": "ワンクリック字幕削除", "ko-KR": "원클릭 자막 제거", "vi-VN": "Xóa phụ đề một chạm" },
  "视频复刻": { "en-US": "Video remake", "ja-JP": "動画リメイク", "ko-KR": "동영상 리메이크", "vi-VN": "Làm lại video" },
  "上传视频并选择目标画风，通过视频转视频模型保持动作与人物一致性完成风格转绘。": { "en-US": "Upload a video and choose a target style. A video-to-video model preserves motion and character consistency during style transfer.", "ja-JP": "動画をアップロードして目標スタイルを選択すると、動画変換モデルが動きと人物の一貫性を保ってスタイル変換します。", "ko-KR": "동영상을 업로드하고 목표 스타일을 선택하면 비디오-투-비디오 모델이 동작과 인물 일관성을 유지하며 스타일을 변환합니다.", "vi-VN": "Tải video lên và chọn phong cách đích; model video-to-video giữ nhất quán chuyển động và nhân vật khi chuyển phong cách." },
  "输入商品名称和详细信息，例如：XXX品牌玻尿酸精华液，30ml，主打三重保湿，敏感肌可用...": { "en-US": "Enter the product name and details, for example: XXX hyaluronic acid serum, 30ml, focused on triple hydration, suitable for sensitive skin...", "ja-JP": "商品名と詳細を入力してください。例: XXXブランドのヒアルロン酸美容液、30ml、3重保湿、敏感肌向け…", "ko-KR": "상품명과 상세 정보를 입력하세요. 예: XXX 브랜드 히알루론산 세럼, 30ml, 3중 보습, 민감성 피부용...", "vi-VN": "Nhập tên và thông tin chi tiết sản phẩm, ví dụ: serum axit hyaluronic XXX, 30ml, dưỡng ẩm ba lớp, phù hợp da nhạy cảm..." },
  "上传爆款参考视频与品牌素材，AI 多模态拆解内容结构，生成原创关键帧、多段视频并合成为完整短视频。": { "en-US": "Upload a viral reference video and brand assets. AI analyzes the structure multimodally, creates original keyframes and video segments, and composes a complete short video.", "ja-JP": "話題の参照動画とブランド素材をアップロードすると、AIがマルチモーダルに構成を分析し、オリジナルのキーフレームと動画セグメントを生成して短編動画に合成します。", "ko-KR": "인기 참고 동영상과 브랜드 자료를 업로드하면 AI가 멀티모달로 구조를 분석하고 독창적인 키프레임과 동영상 세그먼트를 생성해 완성된 숏폼으로 합성합니다.", "vi-VN": "Tải video tham chiếu phổ biến và tài sản thương hiệu lên; AI phân tích đa phương thức, tạo keyframe và đoạn video nguyên bản rồi ghép thành video ngắn hoàn chỉnh." },
  "上传原片、品牌或商品素材与可选原片音频，AI 自动拆镜、替换主体、生成分段视频并合成为完整成片。": { "en-US": "Upload the original video, brand or product assets, and optional original audio. AI automatically splits shots, replaces subjects, generates segments, and composes the final video.", "ja-JP": "元動画、ブランドまたは商品素材、任意の元音声をアップロードすると、AIがショット分割、主体置換、セグメント生成、最終合成を自動で行います。", "ko-KR": "원본 동영상, 브랜드 또는 상품 자료와 선택적 원본 오디오를 업로드하면 AI가 장면을 나누고 주체를 교체하며 세그먼트를 생성해 최종 영상을 합성합니다.", "vi-VN": "Tải video gốc, tài sản thương hiệu hoặc sản phẩm và âm thanh gốc tùy chọn lên; AI tự tách cảnh, thay chủ thể, tạo các đoạn và ghép video cuối." },
  "上传低清视频，通过 AI 超分增强输出 720P、1K 或 2K 高清视频。": { "en-US": "Upload a low-resolution video and use AI upscaling to output a 720P, 1K, or 2K HD video.", "ja-JP": "低解像度動画をアップロードし、AI超解像で720P、1K、2Kの高画質動画を出力します。", "ko-KR": "저해상도 동영상을 업로드하면 AI 업스케일링으로 720P, 1K 또는 2K 고화질 동영상을 출력합니다.", "vi-VN": "Tải video độ phân giải thấp lên và dùng AI nâng cấp để xuất video HD 720P, 1K hoặc 2K." },
  "自动识别独立字幕轨或烧录硬字幕，并输出清理后的完整视频。": { "en-US": "Automatically detect separate or burned-in subtitles and output a cleaned complete video.", "ja-JP": "独立字幕トラックまたは焼き込み字幕を自動検出し、字幕を除去した完全な動画を出力します。", "ko-KR": "독립 자막 트랙 또는 영상에 삽입된 자막을 자동으로 감지하고 정리된 완성 동영상을 출력합니다.", "vi-VN": "Tự động nhận diện phụ đề riêng hoặc phụ đề được đốt vào video và xuất video hoàn chỉnh đã làm sạch." },
  "模型列表": { "en-US": "Model list", "ja-JP": "モデル一覧", "ko-KR": "모델 목록", "vi-VN": "Danh sách mô hình" },
  "任务查询": { "en-US": "Task status", "ja-JP": "タスク照会", "ko-KR": "작업 조회", "vi-VN": "Tra cứu tác vụ" },
  "任务事件": { "en-US": "Task events", "ja-JP": "タスクイベント", "ko-KR": "작업 이벤트", "vi-VN": "Sự kiện tác vụ" },
  "OpenAI 兼容": { "en-US": "OpenAI compatible", "ja-JP": "OpenAI 互換", "ko-KR": "OpenAI 호환", "vi-VN": "Tương thích OpenAI" },
  "Anthropic 原生": { "en-US": "Anthropic native", "ja-JP": "Anthropic ネイティブ", "ko-KR": "Anthropic 네이티브", "vi-VN": "Anthropic gốc" },
  "Gemini 原生": { "en-US": "Gemini native", "ja-JP": "Gemini ネイティブ", "ko-KR": "Gemini 네이티브", "vi-VN": "Gemini gốc" },
  "复制 JSON": { "en-US": "Copy JSON", "ja-JP": "JSON をコピー", "ko-KR": "JSON 복사", "vi-VN": "Sao chép JSON" },
  "复制鉴权": { "en-US": "Copy auth", "ja-JP": "認証情報をコピー", "ko-KR": "인증 정보 복사", "vi-VN": "Sao chép xác thực" },
  "名称": { "en-US": "Name", "ja-JP": "名前", "ko-KR": "이름", "vi-VN": "Tên" },
  "类型": { "en-US": "Type", "ja-JP": "タイプ", "ko-KR": "유형", "vi-VN": "Loại" },
  "必填": { "en-US": "Required", "ja-JP": "必須", "ko-KR": "필수", "vi-VN": "Bắt buộc" },
  "说明": { "en-US": "Description", "ja-JP": "説明", "ko-KR": "설명", "vi-VN": "Mô tả" },
  "是": { "en-US": "Yes", "ja-JP": "はい", "ko-KR": "예", "vi-VN": "Có" },
  "否": { "en-US": "No", "ja-JP": "いいえ", "ko-KR": "아니요", "vi-VN": "Không" },
  "平台公告": { "en-US": "Platform announcement", "ja-JP": "プラットフォームのお知らせ", "ko-KR": "플랫폼 공지", "vi-VN": "Thông báo nền tảng" },
  "关闭公告": { "en-US": "Close announcement", "ja-JP": "お知らせを閉じる", "ko-KR": "공지 닫기", "vi-VN": "Đóng thông báo" },
  "我知道了": { "en-US": "Got it", "ja-JP": "了解しました", "ko-KR": "확인했습니다", "vi-VN": "Đã hiểu" },
  "缺少登录凭证，请重新登录": { "en-US": "Login credentials are missing. Please sign in again.", "ja-JP": "ログイン情報がありません。もう一度ログインしてください。", "ko-KR": "로그인 정보가 없습니다. 다시 로그인하세요.", "vi-VN": "Thiếu thông tin đăng nhập. Vui lòng đăng nhập lại." },
  "登录失败，请重试": { "en-US": "Login failed. Please try again.", "ja-JP": "ログインに失敗しました。もう一度お試しください。", "ko-KR": "로그인에 실패했습니다. 다시 시도하세요.", "vi-VN": "Đăng nhập thất bại. Vui lòng thử lại." },
  "登录失败": { "en-US": "Login failed", "ja-JP": "ログインに失敗しました", "ko-KR": "로그인 실패", "vi-VN": "Đăng nhập thất bại" },
  "返回首页重新登录": { "en-US": "Return home and sign in again", "ja-JP": "ホームに戻って再ログイン", "ko-KR": "홈으로 돌아가 다시 로그인", "vi-VN": "Về trang chủ và đăng nhập lại" },
  "正在完成登录，请稍候...": { "en-US": "Completing sign-in, please wait...", "ja-JP": "ログインを完了しています。お待ちください...", "ko-KR": "로그인을 완료하는 중입니다. 잠시만 기다려 주세요...", "vi-VN": "Đang hoàn tất đăng nhập, vui lòng chờ..." },
  "页面暂时无法加载": { "en-US": "This page cannot be loaded right now", "ja-JP": "ページを読み込めません", "ko-KR": "페이지를 불러올 수 없습니다", "vi-VN": "Không thể tải trang lúc này" },
  "可能是网络波动或服务正在更新，请稍后重试。": { "en-US": "There may be a network issue or a service update. Please try again later.", "ja-JP": "ネットワークの問題またはサービス更新の可能性があります。後でもう一度お試しください。", "ko-KR": "네트워크 문제이거나 서비스가 업데이트 중일 수 있습니다. 나중에 다시 시도하세요.", "vi-VN": "Có thể mạng không ổn định hoặc dịch vụ đang cập nhật. Vui lòng thử lại sau." },
  "错误编号": { "en-US": "Error ID", "ja-JP": "エラー番号", "ko-KR": "오류 번호", "vi-VN": "Mã lỗi" },
  "重新加载": { "en-US": "Reload", "ja-JP": "再読み込み", "ko-KR": "다시 로드", "vi-VN": "Tải lại" },
  "打开菜单": { "en-US": "Open menu", "ja-JP": "メニューを開く", "ko-KR": "메뉴 열기", "vi-VN": "Mở menu" },
  "关闭菜单": { "en-US": "Close menu", "ja-JP": "メニューを閉じる", "ko-KR": "메뉴 닫기", "vi-VN": "Đóng menu" },
  "页面加载中...": { "en-US": "Loading page...", "ja-JP": "ページを読み込んでいます...", "ko-KR": "페이지를 불러오는 중...", "vi-VN": "Đang tải trang..." },
  "模型价格查询": { "en-US": "Model pricing", "ja-JP": "モデル価格", "ko-KR": "모델 가격", "vi-VN": "Giá mô hình" },
  "搜索：模型名称 / 编码 / 标签": { "en-US": "Search: model name / code / tags", "ja-JP": "検索：モデル名 / コード / タグ", "ko-KR": "검색: 모델 이름 / 코드 / 태그", "vi-VN": "Tìm kiếm: tên / mã / thẻ mô hình" },
  "全部": { "en-US": "All", "ja-JP": "すべて", "ko-KR": "전체", "vi-VN": "Tất cả" },
  "聊天": { "en-US": "Chat", "ja-JP": "チャット", "ko-KR": "채팅", "vi-VN": "Trò chuyện" },
  "加载中...": { "en-US": "Loading...", "ja-JP": "読み込み中...", "ko-KR": "로드 중...", "vi-VN": "Đang tải..." },
  "没有匹配的模型": { "en-US": "No matching models", "ja-JP": "一致するモデルがありません", "ko-KR": "일치하는 모델이 없습니다", "vi-VN": "Không có mô hình phù hợp" },
  "请选择左侧模型": { "en-US": "Select a model on the left", "ja-JP": "左側のモデルを選択してください", "ko-KR": "왼쪽에서 모델을 선택하세요", "vi-VN": "Chọn một mô hình ở bên trái" },
  "计费方式": { "en-US": "Billing method", "ja-JP": "課金方式", "ko-KR": "청구 방식", "vi-VN": "Cách tính phí" },
  "展示口径": { "en-US": "Display basis", "ja-JP": "表示基準", "ko-KR": "표시 기준", "vi-VN": "Cơ sở hiển thị" },
  "价格": { "en-US": "Price", "ja-JP": "価格", "ko-KR": "가격", "vi-VN": "Giá" },
  "加载失败": { "en-US": "Loading failed", "ja-JP": "読み込みに失敗しました", "ko-KR": "로드 실패", "vi-VN": "Tải thất bại" },
  "创作资源库": { "en-US": "Creation library", "ja-JP": "クリエイティブライブラリ", "ko-KR": "창작 라이브러리", "vi-VN": "Thư viện sáng tạo" },
  "我的作品": { "en-US": "My works", "ja-JP": "マイ作品", "ko-KR": "내 작품", "vi-VN": "Tác phẩm của tôi" },
  "图片、视频、音频统一管理；批量生成会以拼图方式展示全部结果。": { "en-US": "Manage images, videos, and audio together; batch results are shown as a mosaic.", "ja-JP": "画像・動画・音声をまとめて管理し、バッチ結果はモザイクで表示します。", "ko-KR": "이미지, 동영상, 오디오를 통합 관리하며 일괄 결과는 모자이크로 표시됩니다.", "vi-VN": "Quản lý ảnh, video và âm thanh cùng lúc; kết quả hàng loạt hiển thị dạng ghép ảnh." },
  "请即时下载作品，保存到本地。": { "en-US": "Download your work now and save it locally.", "ja-JP": "作品を今すぐダウンロードしてローカルに保存してください。", "ko-KR": "작품을 지금 다운로드하여 로컬에 저장하세요.", "vi-VN": "Hãy tải tác phẩm xuống ngay và lưu vào máy." },
  "请即时下载作品，保存到本地，系统{days}天后自动删除！": { "en-US": "Download your work now and save it locally. The system will delete it automatically after {days} days!", "ja-JP": "作品を今すぐダウンロードしてローカルに保存してください。システムは{days}日後に自動削除します。", "ko-KR": "작품을 지금 다운로드하여 로컬에 저장하세요. 시스템이 {days}일 후 자동으로 삭제합니다!", "vi-VN": "Hãy tải tác phẩm xuống ngay và lưu vào máy. Hệ thống sẽ tự động xóa sau {days} ngày!" },
  "当前作品由系统永久保留，建议及时下载到本地备份。": { "en-US": "Works are currently retained permanently. We still recommend downloading a local backup.", "ja-JP": "現在、作品は無期限に保存されます。ローカルへのバックアップもおすすめします。", "ko-KR": "현재 작품은 영구 보관됩니다. 로컬 백업도 권장합니다.", "vi-VN": "Tác phẩm hiện được lưu giữ vĩnh viễn. Bạn vẫn nên tải bản sao lưu về máy." },
  "暂无作品，去生成一个新作品吧。": { "en-US": "No works yet. Create something new to get started.", "ja-JP": "作品はまだありません。新しい作品を作成しましょう。", "ko-KR": "아직 작품이 없습니다. 새 작품을 만들어 보세요.", "vi-VN": "Chưa có tác phẩm. Hãy tạo một tác phẩm mới." },
  "预览作品": { "en-US": "Preview work", "ja-JP": "作品をプレビュー", "ko-KR": "작품 미리보기", "vi-VN": "Xem trước tác phẩm" },
  "发布到广场": { "en-US": "Publish to gallery", "ja-JP": "ギャラリーに公開", "ko-KR": "갤러리에 게시", "vi-VN": "Đăng lên thư viện" },
  "删除": { "en-US": "Delete", "ja-JP": "削除", "ko-KR": "삭제", "vi-VN": "Xóa" },
  "暂无作品": { "en-US": "No work", "ja-JP": "作品なし", "ko-KR": "작품 없음", "vi-VN": "Chưa có tác phẩm" },
  "风格强度": { "en-US": "Style strength", "ja-JP": "スタイル強度", "ko-KR": "스타일 강도", "vi-VN": "Cường độ phong cách" },
  "风格参考图（可选）": { "en-US": "Style reference image (optional)", "ja-JP": "スタイル参照画像（任意）", "ko-KR": "스타일 참조 이미지(선택 사항)", "vi-VN": "Ảnh tham chiếu phong cách (tùy chọn)" },
  "上传图片": { "en-US": "Upload image", "ja-JP": "画像をアップロード", "ko-KR": "이미지 업로드", "vi-VN": "Tải ảnh lên" },
  "资产库": { "en-US": "Asset library", "ja-JP": "アセットライブラリ", "ko-KR": "에셋 라이브러리", "vi-VN": "Thư viện tài sản" },
  "新建项目": { "en-US": "New project", "ja-JP": "新規プロジェクト", "ko-KR": "새 프로젝트", "vi-VN": "Dự án mới" },
  "创建一个新的漫剧项目": { "en-US": "Create a new comic video project", "ja-JP": "新しいコミック動画プロジェクトを作成", "ko-KR": "새 만화 동영상 프로젝트 만들기", "vi-VN": "Tạo một dự án video truyện tranh mới" },
  "点击上传封面": { "en-US": "Click to upload cover", "ja-JP": "クリックしてカバーをアップロード", "ko-KR": "클릭하여 커버 업로드", "vi-VN": "Nhấn để tải ảnh bìa lên" },
  "从资产库选择封面": { "en-US": "Choose cover from assets", "ja-JP": "アセットからカバーを選択", "ko-KR": "에셋에서 커버 선택", "vi-VN": "Chọn ảnh bìa từ thư viện" },
  "项目名称": { "en-US": "Project name", "ja-JP": "プロジェクト名", "ko-KR": "프로젝트 이름", "vi-VN": "Tên dự án" },
  "请输入项目名称": { "en-US": "Enter project name", "ja-JP": "プロジェクト名を入力", "ko-KR": "프로젝트 이름을 입력하세요", "vi-VN": "Nhập tên dự án" },
  "项目描述": { "en-US": "Project description", "ja-JP": "プロジェクト説明", "ko-KR": "프로젝트 설명", "vi-VN": "Mô tả dự án" },
  "请输入项目描述（可选）": { "en-US": "Enter project description (optional)", "ja-JP": "プロジェクト説明を入力（任意）", "ko-KR": "프로젝트 설명을 입력하세요(선택 사항)", "vi-VN": "Nhập mô tả dự án (tùy chọn)" },
  "点击选择画面风格": { "en-US": "Click to choose visual style", "ja-JP": "クリックして画面スタイルを選択", "ko-KR": "클릭하여 화면 스타일 선택", "vi-VN": "Nhấn để chọn phong cách hình ảnh" },
  "取消": { "en-US": "Cancel", "ja-JP": "キャンセル", "ko-KR": "취소", "vi-VN": "Hủy" },
  "创建中...": { "en-US": "Creating...", "ja-JP": "作成中...", "ko-KR": "생성 중...", "vi-VN": "Đang tạo..." },
  "创建项目": { "en-US": "Create project", "ja-JP": "プロジェクトを作成", "ko-KR": "프로젝트 만들기", "vi-VN": "Tạo dự án" },
  "选择风格": { "en-US": "Choose style", "ja-JP": "スタイルを選択", "ko-KR": "스타일 선택", "vi-VN": "Chọn phong cách" },
  "为你的漫剧选择合适的画面风格": { "en-US": "Choose a visual style for your comic video", "ja-JP": "コミック動画に合う画面スタイルを選択", "ko-KR": "만화 동영상에 맞는 화면 스타일을 선택하세요", "vi-VN": "Chọn phong cách hình ảnh phù hợp cho video truyện tranh" },
  "系统风格": { "en-US": "System styles", "ja-JP": "システムスタイル", "ko-KR": "시스템 스타일", "vi-VN": "Phong cách hệ thống" },
  "我的风格": { "en-US": "My styles", "ja-JP": "マイスタイル", "ko-KR": "내 스타일", "vi-VN": "Phong cách của tôi" },
  "新增风格 - 智能识别": { "en-US": "Add style - smart detect", "ja-JP": "スタイルを追加 - 自動認識", "ko-KR": "스타일 추가 - 스마트 인식", "vi-VN": "Thêm phong cách - nhận diện thông minh" },
  "新增风格 - 手动添加": { "en-US": "Add style - manual", "ja-JP": "スタイルを追加 - 手動", "ko-KR": "스타일 추가 - 수동", "vi-VN": "Thêm phong cách - thủ công" },
  "已选择风格": { "en-US": "Style selected", "ja-JP": "スタイルを選択済み", "ko-KR": "스타일 선택됨", "vi-VN": "Đã chọn phong cách" },
  "尚未选择风格": { "en-US": "No style selected", "ja-JP": "スタイル未選択", "ko-KR": "선택한 스타일 없음", "vi-VN": "Chưa chọn phong cách" },
  "确认选择": { "en-US": "Confirm selection", "ja-JP": "選択を確定", "ko-KR": "선택 확인", "vi-VN": "Xác nhận lựa chọn" },
  "平台接口": { "en-US": "Platform APIs", "ja-JP": "プラットフォームAPI", "ko-KR": "플랫폼 API", "vi-VN": "API nền tảng" },
  "平台工具": { "en-US": "Platform tools", "ja-JP": "プラットフォームツール", "ko-KR": "플랫폼 도구", "vi-VN": "Công cụ nền tảng" },
  "OpenAI Chat Completions": { "en-US": "OpenAI Chat Completions", "ja-JP": "OpenAI Chat Completions", "ko-KR": "OpenAI Chat Completions", "vi-VN": "OpenAI Chat Completions" },
  "Anthropic Messages": { "en-US": "Anthropic Messages", "ja-JP": "Anthropic Messages", "ko-KR": "Anthropic Messages", "vi-VN": "Anthropic Messages" },
  "Gemini generateContent": { "en-US": "Gemini generateContent", "ja-JP": "Gemini generateContent", "ko-KR": "Gemini generateContent", "vi-VN": "Gemini generateContent" },
  "Anthropic 原生 Messages 格式，支持内容块、工具调用与流式事件。": { "en-US": "Native Anthropic Messages format with content blocks, tool calls, and streaming events.", "ja-JP": "コンテンツブロック、ツール呼び出し、ストリーミングイベントに対応したAnthropic Messagesネイティブ形式。", "ko-KR": "콘텐츠 블록, 도구 호출 및 스트리밍 이벤트를 지원하는 Anthropic Messages 네이티브 형식입니다.", "vi-VN": "Định dạng Anthropic Messages gốc, hỗ trợ content block, gọi công cụ và sự kiện streaming." },
  "Gemini 原生 contents/parts 格式，支持 candidates 响应与 SSE 流式输出。": { "en-US": "Native Gemini contents/parts format with candidates responses and SSE streaming.", "ja-JP": "candidatesレスポンスとSSEストリーミングに対応したGemini contents/partsネイティブ形式。", "ko-KR": "candidates 응답과 SSE 스트리밍을 지원하는 Gemini contents/parts 네이티브 형식입니다.", "vi-VN": "Định dạng contents/parts Gemini gốc, hỗ trợ response candidates và streaming SSE." },
  "列出当前 API Key 可用的已启用模型。": { "en-US": "List enabled models available to the current API key.", "ja-JP": "現在のAPIキーで利用できる有効なモデルを一覧表示します。", "ko-KR": "현재 API Key에서 사용할 수 있는 활성화된 모델을 나열합니다.", "vi-VN": "Liệt kê các model đã bật và khả dụng cho API Key hiện tại." },
  "查询图片、视频、音频等异步任务的状态和结果。": { "en-US": "Query the status and result of asynchronous image, video, and audio tasks.", "ja-JP": "画像・動画・音声などの非同期タスクの状態と結果を確認します。", "ko-KR": "이미지, 동영상, 오디오 등의 비동기 작업 상태와 결과를 조회합니다.", "vi-VN": "Tra cứu trạng thái và kết quả của các tác vụ ảnh, video và âm thanh bất đồng bộ." },
  "读取异步任务的进度事件，适合构建实时进度展示。": { "en-US": "Read progress events for asynchronous tasks to build real-time progress displays.", "ja-JP": "非同期タスクの進捗イベントを読み取り、リアルタイム表示を構築します。", "ko-KR": "비동기 작업의 진행 이벤트를 읽어 실시간 진행률 표시를 구축합니다.", "vi-VN": "Đọc sự kiện tiến độ của tác vụ bất đồng bộ để xây dựng hiển thị thời gian thực." },
  "根据文本提示词创建一张或多张图片。": { "en-US": "Create one or more images from a text prompt.", "ja-JP": "テキストプロンプトから1枚以上の画像を作成します。", "ko-KR": "텍스트 프롬프트로 하나 이상의 이미지를 생성합니다.", "vi-VN": "Tạo một hoặc nhiều ảnh từ prompt văn bản." },
  "启动一个异步视频生成任务，并通过任务接口查询进度。": { "en-US": "Start an asynchronous video generation task and query progress through the task API.", "ja-JP": "非同期動画生成タスクを開始し、タスクAPIで進捗を確認します。", "ko-KR": "비동기 동영상 생성 작업을 시작하고 작업 API로 진행률을 조회합니다.", "vi-VN": "Khởi động tác vụ tạo video bất đồng bộ và tra cứu tiến độ qua API tác vụ." },
  "将输入文本转换为语音音频，并返回异步任务信息。": { "en-US": "Convert input text to speech audio and return asynchronous task information.", "ja-JP": "入力テキストを音声に変換し、非同期タスク情報を返します。", "ko-KR": "입력 텍스트를 음성 오디오로 변환하고 비동기 작업 정보를 반환합니다.", "vi-VN": "Chuyển văn bản đầu vào thành âm thanh và trả về thông tin tác vụ bất đồng bộ." },
  "一个页面覆盖 OpenAI 兼容、Anthropic 原生和 Gemini 原生三种聊天协议。": { "en-US": "One page covering OpenAI-compatible, native Anthropic, and native Gemini chat protocols.", "ja-JP": "OpenAI互換、Anthropicネイティブ、Geminiネイティブの3つのチャットプロトコルを1ページで利用できます。", "ko-KR": "OpenAI 호환, Anthropic 네이티브 및 Gemini 네이티브 채팅 프로토콜을 한 페이지에서 지원합니다.", "vi-VN": "Một trang hỗ trợ ba giao thức chat: tương thích OpenAI, Anthropic gốc và Gemini gốc." },
  "一个页面统一查看模型列表、异步任务状态与任务进度事件。": { "en-US": "One page for model lists, asynchronous task status, and task progress events.", "ja-JP": "モデル一覧、非同期タスク状態、タスク進捗イベントを1ページで確認できます。", "ko-KR": "모델 목록, 비동기 작업 상태 및 작업 진행 이벤트를 한 페이지에서 확인합니다.", "vi-VN": "Một trang thống nhất để xem danh sách model, trạng thái tác vụ và sự kiện tiến độ." },
  "API 文档暂未开放": { "en-US": "API documentation is not available yet", "ja-JP": "APIドキュメントはまだ公開されていません", "ko-KR": "API 문서가 아직 공개되지 않았습니다", "vi-VN": "Tài liệu API chưa được mở" },
  "接口路径、请求字段和响应字段保持标准协议命名。": { "en-US": "Endpoint paths, request fields, and response fields follow standard protocol names.", "ja-JP": "エンドポイント、リクエストフィールド、レスポンスフィールドは標準プロトコル名に従います。", "ko-KR": "엔드포인트 경로와 요청·응답 필드는 표준 프로토콜 이름을 따릅니다.", "vi-VN": "Đường dẫn endpoint cùng các trường request và response tuân theo tên giao thức chuẩn." },
  "API 文档参考": { "en-US": "API documentation reference", "ja-JP": "APIドキュメントリファレンス", "ko-KR": "API 문서 레퍼런스", "vi-VN": "Tham khảo tài liệu API" },
  "值": { "en-US": "Value", "ja-JP": "値", "ko-KR": "값", "vi-VN": "Giá trị" },
  "用于 API 鉴权": { "en-US": "Used for API authentication", "ja-JP": "API認証に使用", "ko-KR": "API 인증에 사용", "vi-VN": "Dùng để xác thực API" },
  "指定原生协议版本": { "en-US": "Specifies the native protocol version", "ja-JP": "ネイティブプロトコルのバージョンを指定", "ko-KR": "네이티브 프로토콜 버전 지정", "vi-VN": "Chỉ định phiên bản giao thức gốc" },
  "请求体使用 JSON 格式": { "en-US": "The request body uses JSON format", "ja-JP": "リクエストボディはJSON形式", "ko-KR": "요청 본문은 JSON 형식입니다", "vi-VN": "Nội dung request sử dụng định dạng JSON" },
  "OpenAI 兼容的聊天补全格式，支持普通响应与 SSE 流式响应。": { "en-US": "OpenAI-compatible chat completions format with standard and SSE streaming responses.", "ja-JP": "通常レスポンスとSSEストリーミングに対応したOpenAI互換チャット補完形式。", "ko-KR": "일반 응답과 SSE 스트리밍을 지원하는 OpenAI 호환 채팅 완성 형식입니다.", "vi-VN": "Định dạng chat completions tương thích OpenAI, hỗ trợ response thường và streaming SSE." },
  "Claude Opus 4.6 标准兼容调用文档": { "en-US": "Standard-compatible API reference for Claude Opus 4.6", "ja-JP": "Claude Opus 4.6標準互換APIリファレンス", "ko-KR": "Claude Opus 4.6 표준 호환 API 문서", "vi-VN": "Tài liệu API tương thích chuẩn cho Claude Opus 4.6" },
  "当前版本未启用幂等键，请使用 task_no 追踪异步任务": { "en-US": "Idempotency keys are not enabled in this version. Use task_no to track asynchronous tasks.", "ja-JP": "現在のバージョンでは冪等キーは有効ではありません。非同期タスクの追跡にはtask_noを使用してください。", "ko-KR": "현재 버전에서는 멱등성 키가 활성화되지 않았습니다. 비동기 작업 추적에는 task_no를 사용하세요.", "vi-VN": "Phiên bản hiện tại chưa bật khóa idempotency. Hãy dùng task_no để theo dõi tác vụ bất đồng bộ." },
  "请求成功": { "en-US": "Request succeeded", "ja-JP": "リクエスト成功", "ko-KR": "요청 성공", "vi-VN": "Yêu cầu thành công" },
  "请求参数错误": { "en-US": "Invalid request parameters", "ja-JP": "リクエストパラメータエラー", "ko-KR": "요청 매개변수 오류", "vi-VN": "Tham số yêu cầu không hợp lệ" },
  "API Key 无效或已停用": { "en-US": "API key is invalid or disabled", "ja-JP": "APIキーが無効または無効化されています", "ko-KR": "API Key가 유효하지 않거나 비활성화되었습니다", "vi-VN": "API Key không hợp lệ hoặc đã bị tắt" },
  "上游模型服务异常": { "en-US": "Upstream model service error", "ja-JP": "上流モデルサービスエラー", "ko-KR": "상위 모델 서비스 오류", "vi-VN": "Lỗi dịch vụ model upstream" },
  "请求参数无效": { "en-US": "Invalid request parameters", "ja-JP": "無効なリクエストパラメータ", "ko-KR": "유효하지 않은 요청 매개변수", "vi-VN": "Tham số yêu cầu không hợp lệ" },
  "请求频率超过限制": { "en-US": "Rate limit exceeded", "ja-JP": "レート制限を超えました", "ko-KR": "요청 빈도 제한을 초과했습니다", "vi-VN": "Tần suất yêu cầu đã vượt giới hạn" },
  "模型服务异常": { "en-US": "Model service error", "ja-JP": "モデルサービスエラー", "ko-KR": "모델 서비스 오류", "vi-VN": "Lỗi dịch vụ model" },
  "HTTP 状态": { "en-US": "HTTP status", "ja-JP": "HTTPステータス", "ko-KR": "HTTP 상태", "vi-VN": "Trạng thái HTTP" },
  "已弃用": { "en-US": "Deprecated", "ja-JP": "非推奨", "ko-KR": "사용 중단됨", "vi-VN": "Đã ngừng sử dụng" },
  "文档版本": { "en-US": "Document version", "ja-JP": "ドキュメントバージョン", "ko-KR": "문서 버전", "vi-VN": "Phiên bản tài liệu" },
  "限流": { "en-US": "Rate limit", "ja-JP": "レート制限", "ko-KR": "요청 제한", "vi-VN": "Giới hạn tốc độ" },
  "以平台配置为准": { "en-US": "According to platform configuration", "ja-JP": "プラットフォーム設定に従います", "ko-KR": "플랫폼 설정에 따릅니다", "vi-VN": "Theo cấu hình nền tảng" },
  "幂等键": { "en-US": "Idempotency key", "ja-JP": "冪等キー", "ko-KR": "멱등성 키", "vi-VN": "Khóa idempotency" },
  "暂未启用": { "en-US": "Not enabled", "ja-JP": "未有効化", "ko-KR": "아직 활성화되지 않음", "vi-VN": "Chưa bật" },
  "管理 API Key": { "en-US": "Manage API keys", "ja-JP": "APIキーを管理", "ko-KR": "API 키 관리", "vi-VN": "Quản lý API Key" },
  "请求体不是有效 JSON。": { "en-US": "The request body is not valid JSON.", "ja-JP": "リクエストボディが有効なJSONではありません。", "ko-KR": "요청 본문이 올바른 JSON이 아닙니다.", "vi-VN": "Nội dung request không phải JSON hợp lệ." },
  "请求失败，请检查接口地址和跨域配置。": { "en-US": "Request failed. Check the endpoint and CORS configuration.", "ja-JP": "リクエストに失敗しました。エンドポイントとCORS設定を確認してください。", "ko-KR": "요청에 실패했습니다. 엔드포인트와 CORS 설정을 확인하세요.", "vi-VN": "Yêu cầu thất bại. Hãy kiểm tra endpoint và cấu hình CORS." },
  "请先填写 API Key。": { "en-US": "Enter an API key first.", "ja-JP": "先にAPIキーを入力してください。", "ko-KR": "먼저 API 키를 입력하세요.", "vi-VN": "Vui lòng nhập API Key trước." },
  "请填写接口地址。": { "en-US": "Enter an endpoint first.", "ja-JP": "先にエンドポイントを入力してください。", "ko-KR": "먼저 엔드포인트를 입력하세요.", "vi-VN": "Vui lòng nhập endpoint trước." },
  "一只赛博朋克风格的猫": { "en-US": "A cyberpunk-style cat", "ja-JP": "サイバーパンク風の猫", "ko-KR": "사이버펑크 스타일의 고양이", "vi-VN": "Một chú mèo phong cách cyberpunk" },
  "你好，欢迎使用": { "en-US": "Hello, welcome", "ja-JP": "こんにちは、ようこそ", "ko-KR": "안녕하세요, 환영합니다", "vi-VN": "Xin chào, chào mừng bạn" },
  "一段城市夜景视频": { "en-US": "A city night-view video", "ja-JP": "都市の夜景動画", "ko-KR": "도시 야경 동영상", "vi-VN": "Một video cảnh đêm thành phố" },
  "你好，请介绍你的能力": { "en-US": "Hello, please introduce your capabilities", "ja-JP": "こんにちは、機能を紹介してください", "ko-KR": "안녕하세요, 기능을 소개해 주세요", "vi-VN": "Xin chào, hãy giới thiệu khả năng của bạn" },
  "设置 stream=true 后接收 Anthropic Messages 事件。": { "en-US": "Set stream=true to receive Anthropic Messages events.", "ja-JP": "stream=trueを設定するとAnthropic Messagesイベントを受信できます。", "ko-KR": "stream=true로 설정하면 Anthropic Messages 이벤트를 받을 수 있습니다.", "vi-VN": "Đặt stream=true để nhận các sự kiện Anthropic Messages." },
  "使用 streamGenerateContent 操作通过 SSE 接收 Gemini candidates。": { "en-US": "Use streamGenerateContent to receive Gemini candidates over SSE.", "ja-JP": "streamGenerateContentを使用してSSE経由でGemini candidatesを受信します。", "ko-KR": "streamGenerateContent를 사용해 SSE로 Gemini candidates를 받습니다.", "vi-VN": "Dùng streamGenerateContent để nhận Gemini candidates qua SSE." },
  "设置 stream=true 后接收 OpenAI 兼容的 SSE 事件。": { "en-US": "Set stream=true to receive OpenAI-compatible SSE events.", "ja-JP": "stream=trueを設定するとOpenAI互換のSSEイベントを受信できます。", "ko-KR": "stream=true로 설정하면 OpenAI 호환 SSE 이벤트를 받을 수 있습니다.", "vi-VN": "Đặt stream=true để nhận sự kiện SSE tương thích OpenAI." },
  "复制事件": { "en-US": "Copy event", "ja-JP": "イベントをコピー", "ko-KR": "이벤트 복사", "vi-VN": "Sao chép sự kiện" },
  "生成接口返回任务状态后，请使用": { "en-US": "After the generation endpoint returns a task status, use", "ja-JP": "生成エンドポイントがタスク状態を返したら、次を使用してください：", "ko-KR": "생성 엔드포인트가 작업 상태를 반환하면 다음을 사용하세요:", "vi-VN": "Sau khi endpoint tạo trả về trạng thái tác vụ, hãy dùng" },
  "查询结果；进度事件使用": { "en-US": "to query the result; use", "ja-JP": "で結果を確認し、進捗イベントには", "ko-KR": "로 결과를 조회하고 진행 이벤트에는", "vi-VN": "để truy vấn kết quả; dùng" },
  "查看当前 API Key 可用模型": { "en-US": "View models available to the current API key", "ja-JP": "現在のAPIキーで利用可能なモデルを表示", "ko-KR": "현재 API 키에서 사용할 수 있는 모델 보기", "vi-VN": "Xem các model khả dụng cho API Key hiện tại" },
  "查询异步生成任务状态": { "en-US": "Query asynchronous generation task status", "ja-JP": "非同期生成タスクの状態を確認", "ko-KR": "비동기 생성 작업 상태 조회", "vi-VN": "Tra cứu trạng thái tác vụ tạo bất đồng bộ" },
  "读取实时进度事件": { "en-US": "Read real-time progress events", "ja-JP": "リアルタイム進捗イベントを取得", "ko-KR": "실시간 진행 이벤트 읽기", "vi-VN": "Đọc sự kiện tiến độ theo thời gian thực" },
  "3 种协议": { "en-US": "3 protocols", "ja-JP": "3つのプロトコル", "ko-KR": "3개 프로토콜", "vi-VN": "3 giao thức" },
  "3 个平台接口": { "en-US": "3 platform APIs", "ja-JP": "3つのプラットフォームAPI", "ko-KR": "3개 플랫폼 API", "vi-VN": "3 API nền tảng" },
  "新增风格": { "en-US": "Add style", "ja-JP": "スタイルを追加", "ko-KR": "스타일 추가", "vi-VN": "Thêm phong cách" },
  "参考图": { "en-US": "Reference image", "ja-JP": "参照画像", "ko-KR": "참조 이미지", "vi-VN": "Ảnh tham chiếu" },
  "点击选择图片": { "en-US": "Click to choose an image", "ja-JP": "クリックして画像を選択", "ko-KR": "클릭하여 이미지 선택", "vi-VN": "Nhấn để chọn ảnh" },
  "从资产库选择参考图": { "en-US": "Choose a reference image from assets", "ja-JP": "アセットから参照画像を選択", "ko-KR": "에셋에서 참조 이미지 선택", "vi-VN": "Chọn ảnh tham chiếu từ thư viện" },
  "风格名称": { "en-US": "Style name", "ja-JP": "スタイル名", "ko-KR": "스타일 이름", "vi-VN": "Tên phong cách" },
  "给这个风格起个名字": { "en-US": "Name this style", "ja-JP": "このスタイルに名前を付ける", "ko-KR": "이 스타일의 이름을 입력하세요", "vi-VN": "Đặt tên cho phong cách này" },
  "风格提示词": { "en-US": "Style prompt", "ja-JP": "スタイルプロンプト", "ko-KR": "스타일 프롬프트", "vi-VN": "Prompt phong cách" },
  "可留空，系统会根据参考图生成基础风格说明": { "en-US": "Optional; the system will generate a basic style description from the reference image", "ja-JP": "任意。システムが参照画像から基本スタイル説明を生成します", "ko-KR": "선택 사항이며 시스템이 참조 이미지에서 기본 스타일 설명을 생성합니다", "vi-VN": "Có thể để trống; hệ thống sẽ tạo mô tả phong cách cơ bản từ ảnh tham chiếu" },
  "例如：动漫风格，新海诚画风，赛璐璐上色...": { "en-US": "For example: anime style, Makoto Shinkai-inspired, cel shading...", "ja-JP": "例：アニメ風、新海誠風、セル画調の彩色...", "ko-KR": "예: 애니메이션 스타일, 신카이 마코토풍, 셀 채색...", "vi-VN": "Ví dụ: phong cách anime, cảm hứng Makoto Shinkai, tô màu cel..." },
  "保存中...": { "en-US": "Saving...", "ja-JP": "保存中...", "ko-KR": "저장 중...", "vi-VN": "Đang lưu..." },
  "保存": { "en-US": "Save", "ja-JP": "保存", "ko-KR": "저장", "vi-VN": "Lưu" },
  "从资产库选择图片": { "en-US": "Choose images from asset library", "ja-JP": "アセットライブラリから画像を選択", "ko-KR": "에셋 라이브러리에서 이미지 선택", "vi-VN": "Chọn ảnh từ thư viện tài sản" },
  "可选择最多 {max} 张角色、道具或场景参考图": { "en-US": "Choose up to {max} character, prop, or scene reference images", "ja-JP": "キャラクター・小道具・シーンの参照画像を最大{max}枚選択できます", "ko-KR": "캐릭터·소품·장면 참조 이미지를 최대 {max}개 선택할 수 있습니다", "vi-VN": "Có thể chọn tối đa {max} ảnh tham chiếu nhân vật, đạo cụ hoặc bối cảnh" },
  "选择一张图片作为项目封面或风格参考": { "en-US": "Choose an image as the project cover or style reference", "ja-JP": "プロジェクトカバーまたはスタイル参照として画像を1枚選択", "ko-KR": "프로젝트 커버 또는 스타일 참조로 사용할 이미지를 하나 선택하세요", "vi-VN": "Chọn một ảnh làm ảnh bìa dự án hoặc ảnh tham chiếu phong cách" },
  "资产库暂无图片": { "en-US": "No images in the asset library", "ja-JP": "アセットライブラリに画像がありません", "ko-KR": "에셋 라이브러리에 이미지가 없습니다", "vi-VN": "Thư viện tài sản chưa có ảnh" },
  "已选择 {count}/{max}": { "en-US": "Selected {count}/{max}", "ja-JP": "選択済み {count}/{max}", "ko-KR": "선택됨 {count}/{max}", "vi-VN": "Đã chọn {count}/{max}" },
  "偏好设置": { "en-US": "Preferences", "ja-JP": "環境設定", "ko-KR": "환경 설정", "vi-VN": "Tùy chọn" },
  "自定义你的漫剧创作偏好": { "en-US": "Customize your comic video creation preferences", "ja-JP": "コミック動画制作の環境設定をカスタマイズ", "ko-KR": "만화 동영상 제작 환경 설정을 사용자 지정하세요", "vi-VN": "Tùy chỉnh tùy chọn sáng tác video truyện tranh" },
  "自定义 AI 漫剧创作偏好": { "en-US": "Customize your AI comic video preferences", "ja-JP": "AIコミック動画の環境設定をカスタマイズ", "ko-KR": "AI 만화 동영상 환경 설정을 사용자 지정하세요", "vi-VN": "Tùy chỉnh tùy chọn sáng tác video truyện tranh AI" },
  "分镜图自动重试": { "en-US": "Automatic storyboard retry", "ja-JP": "絵コンテ画像の自動再試行", "ko-KR": "스토리보드 이미지 자동 재시도", "vi-VN": "Tự động thử lại ảnh storyboard" },
  "支持选择已启用的视频模型；每个分镜按所选模型生成并统一计费。": { "en-US": "Choose an enabled video model; each storyboard is generated with the selected model and billed consistently.", "ja-JP": "有効な動画モデルを選択できます。各絵コンテは選択モデルで生成され、同じ基準で課金されます。", "ko-KR": "활성화된 동영상 모델을 선택하세요. 각 스토리보드는 선택한 모델로 생성되며 동일한 기준으로 과금됩니다.", "vi-VN": "Chọn model video đã bật; mỗi storyboard được tạo bằng model đã chọn và tính phí thống nhất." },
  "资产图风格参考": { "en-US": "Asset image style reference", "ja-JP": "アセット画像のスタイル参照", "ko-KR": "에셋 이미지 스타일 참조", "vi-VN": "Tham chiếu phong cách ảnh tài sản" },
  "附带风格参考图": { "en-US": "Include style reference image", "ja-JP": "スタイル参照画像を添付", "ko-KR": "스타일 참조 이미지 포함", "vi-VN": "Kèm ảnh tham chiếu phong cách" },
  "仅文字描述": { "en-US": "Text description only", "ja-JP": "テキスト説明のみ", "ko-KR": "텍스트 설명만", "vi-VN": "Chỉ mô tả bằng văn bản" },
  "分镜时长模式": { "en-US": "Storyboard duration mode", "ja-JP": "絵コンテの長さモード", "ko-KR": "스토리보드 길이 모드", "vi-VN": "Chế độ thời lượng storyboard" },
  "紧凑": { "en-US": "Compact", "ja-JP": "コンパクト", "ko-KR": "간결", "vi-VN": "Gọn" },
  "常规": { "en-US": "Standard", "ja-JP": "標準", "ko-KR": "일반", "vi-VN": "Tiêu chuẩn" },
  "超长": { "en-US": "Long", "ja-JP": "ロング", "ko-KR": "매우 김", "vi-VN": "Dài" },
  "配音叙事模式": { "en-US": "Voice-over narrative mode", "ja-JP": "ナレーションモード", "ko-KR": "더빙 내레이션 모드", "vi-VN": "Chế độ kể chuyện lồng tiếng" },
  "分镜画宫格数": { "en-US": "Storyboard grid", "ja-JP": "絵コンテのコマ数", "ko-KR": "스토리보드 칸 수", "vi-VN": "Số ô storyboard" },
  "4宫格": { "en-US": "4-grid", "ja-JP": "4コマ", "ko-KR": "4칸", "vi-VN": "4 ô" },
  "6宫格": { "en-US": "6-grid", "ja-JP": "6コマ", "ko-KR": "6칸", "vi-VN": "6 ô" },
  "9宫格": { "en-US": "9-grid", "ja-JP": "9コマ", "ko-KR": "9칸", "vi-VN": "9 ô" },
  "自动重试": { "en-US": "Automatic retry", "ja-JP": "自動再試行", "ko-KR": "자동 재시도", "vi-VN": "Tự động thử lại" },
  "最大重试次数": { "en-US": "Maximum retries", "ja-JP": "最大再試行回数", "ko-KR": "최대 재시도 횟수", "vi-VN": "Số lần thử lại tối đa" },
  "资产一致性合格分": { "en-US": "Asset consistency passing score", "ja-JP": "アセット一貫性の合格スコア", "ko-KR": "에셋 일관성 통과 점수", "vi-VN": "Điểm đạt tính nhất quán tài sản" },
  "画面逻辑合格分": { "en-US": "Visual logic passing score", "ja-JP": "画面ロジックの合格スコア", "ko-KR": "화면 논리 통과 점수", "vi-VN": "Điểm đạt logic hình ảnh" },
  "图片模型": { "en-US": "Image model", "ja-JP": "画像モデル", "ko-KR": "이미지 모델", "vi-VN": "Model hình ảnh" },
  "视频模型": { "en-US": "Video model", "ja-JP": "動画モデル", "ko-KR": "동영상 모델", "vi-VN": "Model video" },
  "请选择图片模型": { "en-US": "Select an image model", "ja-JP": "画像モデルを選択", "ko-KR": "이미지 모델을 선택하세요", "vi-VN": "Chọn model hình ảnh" },
  "请选择视频模型": { "en-US": "Select a video model", "ja-JP": "動画モデルを選択", "ko-KR": "동영상 모델을 선택하세요", "vi-VN": "Chọn model video" },
  "兼容：会自动把每个分镜关键帧作为图生视频参考。": { "en-US": "Compatible: each storyboard keyframe will be used automatically as an image-to-video reference.", "ja-JP": "互換：各絵コンテのキーフレームを自動的に画像から動画への参照として使用します。", "ko-KR": "호환됨: 각 스토리보드 키프레임을 이미지-투-비디오 참조로 자동 사용합니다.", "vi-VN": "Tương thích: mỗi keyframe storyboard sẽ tự động được dùng làm tham chiếu image-to-video." },
  "不兼容：该模型未声明关键帧/参考图能力，运行前会要求更换模型。": { "en-US": "Incompatible: this model does not declare keyframe/reference-image support; you must change the model before running.", "ja-JP": "非互換：このモデルはキーフレーム/参照画像に対応していないため、実行前にモデルを変更する必要があります。", "ko-KR": "호환되지 않음: 이 모델은 키프레임/참조 이미지 기능을 지원하지 않으므로 실행 전에 모델을 바꿔야 합니다.", "vi-VN": "Không tương thích: model này không khai báo hỗ trợ keyframe/ảnh tham chiếu; cần đổi model trước khi chạy." },
  "AI 漫剧应选择支持图生视频或关键帧参考的视频模型。": { "en-US": "For AI comic videos, choose a video model that supports image-to-video or keyframe references.", "ja-JP": "AIコミック動画では画像から動画またはキーフレーム参照に対応した動画モデルを選択してください。", "ko-KR": "AI 만화 동영상에는 이미지-투-비디오 또는 키프레임 참조를 지원하는 동영상 모델을 선택하세요.", "vi-VN": "Với video truyện tranh AI, hãy chọn model video hỗ trợ image-to-video hoặc tham chiếu keyframe." },
  "保存设置": { "en-US": "Save settings", "ja-JP": "設定を保存", "ko-KR": "설정 저장", "vi-VN": "Lưu cài đặt" },
  "当前调试地址返回的是前端 HTML，不是 API 响应。请使用 API 服务地址（本地通常为 http://localhost:8080），不要使用前台页面地址。": { "en-US": "The debug endpoint returned frontend HTML instead of an API response. Use the API service address (usually http://localhost:8080 locally), not the frontend page address.", "ja-JP": "デバッグ先がAPIレスポンスではなくフロントエンドHTMLを返しました。フロントページのアドレスではなく、APIサービスのアドレス（ローカルでは通常 http://localhost:8080）を使用してください。", "ko-KR": "디버그 엔드포인트가 API 응답 대신 프런트엔드 HTML을 반환했습니다. 프런트엔드 페이지 주소가 아니라 API 서비스 주소(로컬은 보통 http://localhost:8080)를 사용하세요.", "vi-VN": "Endpoint debug trả về HTML frontend thay vì response API. Hãy dùng địa chỉ dịch vụ API (thường là http://localhost:8080 khi chạy local), không dùng địa chỉ trang frontend." },
  "模型名称或平台模型编码": { "en-US": "Model name or platform model code", "ja-JP": "モデル名またはプラットフォームモデルコード", "ko-KR": "모델 이름 또는 플랫폼 모델 코드", "vi-VN": "Tên model hoặc mã model nền tảng" },
  "本次请求允许生成的最大 Token 数": { "en-US": "Maximum tokens allowed for this request", "ja-JP": "このリクエストで生成できる最大トークン数", "ko-KR": "이번 요청에서 생성할 수 있는 최대 토큰 수", "vi-VN": "Số token tối đa được phép tạo cho request này" },
  "Anthropic Messages 内容数组": { "en-US": "Anthropic Messages content array", "ja-JP": "Anthropic Messagesのコンテンツ配列", "ko-KR": "Anthropic Messages 콘텐츠 배열", "vi-VN": "Mảng nội dung Anthropic Messages" },
  "系统提示词或系统内容块": { "en-US": "System prompt or system content blocks", "ja-JP": "システムプロンプトまたはシステムコンテンツブロック", "ko-KR": "시스템 프롬프트 또는 시스템 콘텐츠 블록", "vi-VN": "Prompt hệ thống hoặc các block nội dung hệ thống" },
  "是否通过 SSE 返回流式事件": { "en-US": "Whether to return streaming events over SSE", "ja-JP": "SSEでストリーミングイベントを返すかどうか", "ko-KR": "SSE로 스트리밍 이벤트를 반환할지 여부", "vi-VN": "Có trả về sự kiện streaming qua SSE hay không" },
  "工具定义，用于工具调用": { "en-US": "Tool definitions for tool calls", "ja-JP": "ツール呼び出し用のツール定義", "ko-KR": "도구 호출을 위한 도구 정의", "vi-VN": "Định nghĩa công cụ dùng cho gọi công cụ" },
  "Gemini contents 消息数组": { "en-US": "Gemini contents message array", "ja-JP": "Gemini contentsメッセージ配列", "ko-KR": "Gemini contents 메시지 배열", "vi-VN": "Mảng message Gemini contents" },
  "系统指令内容": { "en-US": "System instruction content", "ja-JP": "システム指示の内容", "ko-KR": "시스템 지시 내용", "vi-VN": "Nội dung chỉ dẫn hệ thống" },
  "温度、输出 Token 数等生成参数": { "en-US": "Generation parameters such as temperature and output tokens", "ja-JP": "温度や出力トークン数などの生成パラメータ", "ko-KR": "온도와 출력 토큰 수 등의 생성 매개변수", "vi-VN": "Các tham số tạo như temperature và số token đầu ra" },
  "函数声明和工具定义": { "en-US": "Function declarations and tool definitions", "ja-JP": "関数宣言とツール定義", "ko-KR": "함수 선언 및 도구 정의", "vi-VN": "Khai báo hàm và định nghĩa công cụ" },
  "平台模型编码或后台接入模型名": { "en-US": "Platform model code or backend-connected model name", "ja-JP": "プラットフォームモデルコードまたはバックエンド接続モデル名", "ko-KR": "플랫폼 모델 코드 또는 백엔드 연결 모델 이름", "vi-VN": "Mã model nền tảng hoặc tên model được kết nối ở backend" },
  "OpenAI Chat Completions 消息数组": { "en-US": "OpenAI Chat Completions message array", "ja-JP": "OpenAI Chat Completionsメッセージ配列", "ko-KR": "OpenAI Chat Completions 메시지 배열", "vi-VN": "Mảng message OpenAI Chat Completions" },
  "是否通过 SSE 返回流式片段": { "en-US": "Whether to return streaming chunks over SSE", "ja-JP": "SSEでストリーミングチャンクを返すかどうか", "ko-KR": "SSE로 스트리밍 청크를 반환할지 여부", "vi-VN": "Có trả về các đoạn streaming qua SSE hay không" },
  "采样温度，以接入模型支持范围为准": { "en-US": "Sampling temperature, within the connected model's supported range", "ja-JP": "サンプリング温度（接続モデルの対応範囲に準拠）", "ko-KR": "샘플링 온도(연결된 모델의 지원 범위 기준)", "vi-VN": "Temperature lấy mẫu, theo phạm vi hỗ trợ của model được kết nối" },
  "最大输出 Token 数": { "en-US": "Maximum output tokens", "ja-JP": "最大出力トークン数", "ko-KR": "최대 출력 토큰 수", "vi-VN": "Số token đầu ra tối đa" },
  "流式响应结束": { "en-US": "Streaming response ended", "ja-JP": "ストリーミングレスポンス終了", "ko-KR": "스트리밍 응답 종료", "vi-VN": "Đã kết thúc response streaming" },
  "文本片段：": { "en-US": "Text chunk: ", "ja-JP": "テキストチャンク：", "ko-KR": "텍스트 청크: ", "vi-VN": "Đoạn văn bản: " },
  "工具参数片段：": { "en-US": "Tool arguments chunk: ", "ja-JP": "ツール引数チャンク：", "ko-KR": "도구 인수 청크: ", "vi-VN": "Đoạn tham số công cụ: " },
  "结束原因：": { "en-US": "Finish reason: ", "ja-JP": "終了理由：", "ko-KR": "종료 이유: ", "vi-VN": "Lý do kết thúc: " },
  "工具调用：": { "en-US": "Tool call: ", "ja-JP": "ツール呼び出し：", "ko-KR": "도구 호출: ", "vi-VN": "Gọi công cụ: " },
  "函数调用：": { "en-US": "Function call: ", "ja-JP": "関数呼び出し：", "ko-KR": "함수 호출: ", "vi-VN": "Gọi hàm: " },
  "工具调用片段": { "en-US": "Tool call chunk", "ja-JP": "ツール呼び出しチャンク", "ko-KR": "도구 호출 청크", "vi-VN": "Đoạn gọi công cụ" },
  "协议事件：": { "en-US": "Protocol event: ", "ja-JP": "プロトコルイベント：", "ko-KR": "프로토콜 이벤트: ", "vi-VN": "Sự kiện giao thức: " },
  "解析：": { "en-US": "Parsed: ", "ja-JP": "解析：", "ko-KR": "파싱됨: ", "vi-VN": "Đã phân tích: " },
  "谷歌": { "en-US": "Google", "ja-JP": "Google", "ko-KR": "Google", "vi-VN": "Google" },
  "注册用户": { "en-US": "Registered user", "ja-JP": "登録ユーザー", "ko-KR": "가입 사용자", "vi-VN": "Người dùng đã đăng ký" },
  "修改密码": { "en-US": "Change password", "ja-JP": "パスワードを変更", "ko-KR": "비밀번호 변경", "vi-VN": "Đổi mật khẩu" },
  "原密码": { "en-US": "Current password", "ja-JP": "現在のパスワード", "ko-KR": "현재 비밀번호", "vi-VN": "Mật khẩu hiện tại" },
  "新密码（至少 6 位）": { "en-US": "New password (at least 6 characters)", "ja-JP": "新しいパスワード（6文字以上）", "ko-KR": "새 비밀번호(6자 이상)", "vi-VN": "Mật khẩu mới (ít nhất 6 ký tự)" },
  "密码修改成功": { "en-US": "Password changed successfully", "ja-JP": "パスワードを変更しました", "ko-KR": "비밀번호가 변경되었습니다", "vi-VN": "Đổi mật khẩu thành công" },
  "修改失败": { "en-US": "Update failed", "ja-JP": "変更に失敗しました", "ko-KR": "변경에 실패했습니다", "vi-VN": "Cập nhật thất bại" },
  "提交中...": { "en-US": "Submitting...", "ja-JP": "送信中...", "ko-KR": "제출 중...", "vi-VN": "Đang gửi..." },
  "签到功能当前未开启": { "en-US": "Daily check-in is currently disabled", "ja-JP": "毎日のチェックインは現在無効です", "ko-KR": "매일 출석 기능이 현재 비활성화되어 있습니다", "vi-VN": "Tính năng điểm danh hiện đang tắt" },
  "今日已签到": { "en-US": "Checked in today", "ja-JP": "本日はチェックイン済み", "ko-KR": "오늘 출석 완료", "vi-VN": "Đã điểm danh hôm nay" },
  "立即签到": { "en-US": "Check in now", "ja-JP": "今すぐチェックイン", "ko-KR": "지금 출석", "vi-VN": "Điểm danh ngay" },
  "API 密钥": { "en-US": "API keys", "ja-JP": "APIキー", "ko-KR": "API 키", "vi-VN": "API Key" },
  "默认创建一个密钥即可；如需分业务调用，也可以继续新增。": { "en-US": "One default key is enough; create more if you need separate keys for different services.", "ja-JP": "通常はデフォルトのキー1つで十分です。用途別に分ける場合は追加できます。", "ko-KR": "기본 키 하나면 충분합니다. 업무별로 분리하려면 더 만들 수 있습니다.", "vi-VN": "Một key mặc định là đủ; hãy tạo thêm nếu cần tách theo từng dịch vụ." },
  "新密钥名称（可选）": { "en-US": "New key name (optional)", "ja-JP": "新しいキー名（任意）", "ko-KR": "새 키 이름(선택 사항)", "vi-VN": "Tên key mới (tùy chọn)" },
  "默认密钥名称（可选）": { "en-US": "Default key name (optional)", "ja-JP": "デフォルトキー名（任意）", "ko-KR": "기본 키 이름(선택 사항)", "vi-VN": "Tên key mặc định (tùy chọn)" },
  "新增密钥": { "en-US": "Add key", "ja-JP": "キーを追加", "ko-KR": "키 추가", "vi-VN": "Thêm key" },
  "创建密钥": { "en-US": "Create key", "ja-JP": "キーを作成", "ko-KR": "키 생성", "vi-VN": "Tạo key" },
  "密钥已创建，请点击复制后妥善保存": { "en-US": "Key created. Copy and store it securely.", "ja-JP": "キーを作成しました。コピーして安全に保管してください。", "ko-KR": "키가 생성되었습니다. 복사하여 안전하게 보관하세요.", "vi-VN": "Key đã được tạo. Hãy sao chép và lưu trữ an toàn." },
  "复制 API 密钥": { "en-US": "Copy API key", "ja-JP": "APIキーをコピー", "ko-KR": "API 키 복사", "vi-VN": "Sao chép API Key" },
  "复制": { "en-US": "Copy", "ja-JP": "コピー", "ko-KR": "복사", "vi-VN": "Sao chép" },
  "暂无密钥": { "en-US": "No API keys", "ja-JP": "APIキーはありません", "ko-KR": "API 키가 없습니다", "vi-VN": "Chưa có API Key" },
  "旧密钥仅可显示前缀，请重新创建后复制完整密钥": { "en-US": "Only the prefix of an old key is available. Create a new key to copy the full value.", "ja-JP": "古いキーはプレフィックスのみ表示できます。完全なキーをコピーするには再作成してください。", "ko-KR": "이전 키는 접두사만 표시됩니다. 전체 키를 복사하려면 새로 생성하세요.", "vi-VN": "Key cũ chỉ hiển thị tiền tố. Hãy tạo lại để sao chép đầy đủ." },
  "旧密钥不可复制完整值": { "en-US": "Old keys cannot be copied in full", "ja-JP": "古いキーの完全な値はコピーできません", "ko-KR": "이전 키는 전체 값을 복사할 수 없습니다", "vi-VN": "Không thể sao chép đầy đủ key cũ" },
  "预览": { "en-US": "Preview", "ja-JP": "プレビュー", "ko-KR": "미리보기", "vi-VN": "Xem trước" },
  "共 {count} 个作品": { "en-US": "{count} works", "ja-JP": "全{count}作品", "ko-KR": "총 {count}개 작품", "vi-VN": "Tổng {count} tác phẩm" },
  "创建于": { "en-US": "Created", "ja-JP": "作成日時", "ko-KR": "생성일", "vi-VN": "Tạo lúc" },
  "支付已取消，订单不会入账。": { "en-US": "Payment canceled. The order will not be credited.", "ja-JP": "支払いがキャンセルされました。注文は反映されません。", "ko-KR": "결제가 취소되었습니다. 주문 금액이 반영되지 않습니다.", "vi-VN": "Thanh toán đã hủy. Đơn hàng sẽ không được ghi có." },
  "支付订单未完成。如已扣款，请联系客服核对订单。": { "en-US": "The payment order was not completed. Contact support if you were charged.", "ja-JP": "支払い注文が完了していません。引き落とし済みの場合はサポートにお問い合わせください。", "ko-KR": "결제 주문이 완료되지 않았습니다. 결제되었다면 고객지원에 문의하세요.", "vi-VN": "Đơn thanh toán chưa hoàn tất. Nếu đã bị trừ tiền, hãy liên hệ hỗ trợ." },
  "支付结果确认中，请稍候……": { "en-US": "Confirming payment result, please wait…", "ja-JP": "支払い結果を確認中です。しばらくお待ちください…", "ko-KR": "결제 결과를 확인하는 중입니다. 잠시 기다려 주세요…", "vi-VN": "Đang xác nhận kết quả thanh toán, vui lòng chờ…" },
  "暂时无法查询支付结果，请稍后刷新钱包。": { "en-US": "Unable to check the payment result. Refresh the wallet later.", "ja-JP": "支払い結果を確認できません。後でもう一度ウォレットを更新してください。", "ko-KR": "결제 결과를 확인할 수 없습니다. 나중에 지갑을 새로 고침하세요.", "vi-VN": "Tạm thời không thể tra cứu kết quả thanh toán. Hãy tải lại ví sau." },
  "提现申请已提交": { "en-US": "Withdrawal request submitted", "ja-JP": "出金申請を送信しました", "ko-KR": "출금 신청이 제출되었습니다", "vi-VN": "Đã gửi yêu cầu rút tiền" },
  "提现申请提交失败": { "en-US": "Failed to submit withdrawal request", "ja-JP": "出金申請の送信に失敗しました", "ko-KR": "출금 신청 제출 실패", "vi-VN": "Gửi yêu cầu rút tiền thất bại" },
  "钱包": { "en-US": "Wallet", "ja-JP": "ウォレット", "ko-KR": "지갑", "vi-VN": "Ví" },
  "充值算力": { "en-US": "Recharge credits", "ja-JP": "クレジットをチャージ", "ko-KR": "크레딧 충전", "vi-VN": "Nạp credit" },
  "申请提现": { "en-US": "Request withdrawal", "ja-JP": "出金を申請", "ko-KR": "출금 신청", "vi-VN": "Yêu cầu rút tiền" },
  "算力余额": { "en-US": "Credit balance", "ja-JP": "クレジット残高", "ko-KR": "크레딧 잔액", "vi-VN": "Số dư credit" },
  "现金余额": { "en-US": "Cash balance", "ja-JP": "現金残高", "ko-KR": "현금 잔액", "vi-VN": "Số dư tiền mặt" },
  "可以申请提现": { "en-US": "Available for withdrawal", "ja-JP": "出金申請が可能", "ko-KR": "출금 신청 가능", "vi-VN": "Có thể yêu cầu rút tiền" },
  "推荐信息": { "en-US": "Referral information", "ja-JP": "紹介情報", "ko-KR": "추천 정보", "vi-VN": "Thông tin giới thiệu" },
  "新用户注册时填写你的推荐码，充值成功后会得到奖励。": { "en-US": "New users can enter your referral code at signup; you receive a reward after a successful recharge.", "ja-JP": "新規ユーザーが登録時に紹介コードを入力すると、チャージ成功後に報酬を受け取れます。", "ko-KR": "신규 사용자가 가입 시 추천 코드를 입력하면 충전 성공 후 보상을 받습니다.", "vi-VN": "Người dùng mới nhập mã giới thiệu khi đăng ký; bạn sẽ nhận thưởng sau khi họ nạp tiền thành công." },
  "直属下级": { "en-US": "Direct referrals", "ja-JP": "直属の紹介者", "ko-KR": "직접 추천", "vi-VN": "Người được giới thiệu trực tiếp" },
  "算力奖励": { "en-US": "Credit reward", "ja-JP": "クレジット報酬", "ko-KR": "크레딧 보상", "vi-VN": "Thưởng credit" },
  "现金奖励": { "en-US": "Cash reward", "ja-JP": "現金報酬", "ko-KR": "현금 보상", "vi-VN": "Thưởng tiền mặt" },
  "我的上级": { "en-US": "My referrer", "ja-JP": "紹介者", "ko-KR": "내 추천인", "vi-VN": "Người giới thiệu tôi" },
  "无": { "en-US": "None", "ja-JP": "なし", "ko-KR": "없음", "vi-VN": "Không có" },
  "算力流水": { "en-US": "Credit transactions", "ja-JP": "クレジット履歴", "ko-KR": "크레딧 내역", "vi-VN": "Lịch sử credit" },
  "现金流水": { "en-US": "Cash transactions", "ja-JP": "現金履歴", "ko-KR": "현금 내역", "vi-VN": "Lịch sử tiền mặt" },
  "提现记录": { "en-US": "Withdrawal history", "ja-JP": "出金履歴", "ko-KR": "출금 기록", "vi-VN": "Lịch sử rút tiền" },
  "卡密充值": { "en-US": "Card recharge", "ja-JP": "カードチャージ", "ko-KR": "카드 충전", "vi-VN": "Nạp bằng mã thẻ" },
  "在线充值": { "en-US": "Online recharge", "ja-JP": "オンラインチャージ", "ko-KR": "온라인 충전", "vi-VN": "Nạp trực tuyến" },
  "管理员调整": { "en-US": "Admin adjustment", "ja-JP": "管理者調整", "ko-KR": "관리자 조정", "vi-VN": "Điều chỉnh bởi quản trị viên" },
  "每日签到": { "en-US": "Daily check-in", "ja-JP": "毎日のチェックイン", "ko-KR": "매일 출석", "vi-VN": "Điểm danh hằng ngày" },
  "注册赠送": { "en-US": "Signup bonus", "ja-JP": "登録ボーナス", "ko-KR": "가입 보너스", "vi-VN": "Thưởng đăng ký" },
  "推荐奖励": { "en-US": "Referral reward", "ja-JP": "紹介報酬", "ko-KR": "추천 보상", "vi-VN": "Thưởng giới thiệu" },
  "提现退回": { "en-US": "Withdrawal refund", "ja-JP": "出金返金", "ko-KR": "출금 환불", "vi-VN": "Hoàn tiền rút" },
  "对话消费": { "en-US": "Chat usage", "ja-JP": "チャット利用", "ko-KR": "채팅 사용량", "vi-VN": "Chi phí trò chuyện" },
  "提现": { "en-US": "Withdrawal", "ja-JP": "出金", "ko-KR": "출금", "vi-VN": "Rút tiền" },
  "银行卡": { "en-US": "Bank card", "ja-JP": "銀行カード", "ko-KR": "은행 카드", "vi-VN": "Thẻ ngân hàng" },
  "微信": { "en-US": "WeChat", "ja-JP": "WeChat", "ko-KR": "WeChat", "vi-VN": "WeChat" },
  "支付宝": { "en-US": "Alipay", "ja-JP": "Alipay", "ko-KR": "Alipay", "vi-VN": "Alipay" },
  "暂无记录": { "en-US": "No records", "ja-JP": "記録はありません", "ko-KR": "기록이 없습니다", "vi-VN": "Chưa có bản ghi" },
  "暂无提现记录": { "en-US": "No withdrawal records", "ja-JP": "出金記録はありません", "ko-KR": "출금 기록이 없습니다", "vi-VN": "Chưa có lịch sử rút tiền" },
  "累计充值金额会随被推荐人后续充值自动累加。": { "en-US": "Cumulative recharge increases automatically when your referrals recharge.", "ja-JP": "紹介者が追加チャージすると累計チャージ額も自動的に増えます。", "ko-KR": "추천인이 추가 충전하면 누적 충전 금액도 자동으로 증가합니다.", "vi-VN": "Tổng tiền nạp sẽ tự động tăng khi người được giới thiệu tiếp tục nạp tiền." },
  "关闭": { "en-US": "Close", "ja-JP": "閉じる", "ko-KR": "닫기", "vi-VN": "Đóng" },
  "暂无直属下级": { "en-US": "No direct referrals", "ja-JP": "直属の紹介者はいません", "ko-KR": "직접 추천 사용자가 없습니다", "vi-VN": "Chưa có người được giới thiệu trực tiếp" },
  "用户": { "en-US": "User", "ja-JP": "ユーザー", "ko-KR": "사용자", "vi-VN": "Người dùng" },
  "邮箱": { "en-US": "Email", "ja-JP": "メール", "ko-KR": "이메일", "vi-VN": "Email" },
  "累计充值": { "en-US": "Total recharge", "ja-JP": "累計チャージ", "ko-KR": "누적 충전", "vi-VN": "Tổng tiền nạp" },
  "注册时间": { "en-US": "Signup time", "ja-JP": "登録日時", "ko-KR": "가입 시간", "vi-VN": "Thời gian đăng ký" },
  "未设置昵称": { "en-US": "No nickname", "ja-JP": "ニックネーム未設定", "ko-KR": "닉네임 없음", "vi-VN": "Chưa đặt biệt danh" },
  "提现金额": { "en-US": "Withdrawal amount", "ja-JP": "出金額", "ko-KR": "출금 금액", "vi-VN": "Số tiền rút" },
  "收款人姓名": { "en-US": "Payee name", "ja-JP": "受取人名", "ko-KR": "수취인 이름", "vi-VN": "Tên người nhận" },
  "账号 / 手机号 / PayPal 邮箱": { "en-US": "Account / phone / PayPal email", "ja-JP": "口座 / 電話番号 / PayPalメール", "ko-KR": "계좌 / 전화번호 / PayPal 이메일", "vi-VN": "Tài khoản / điện thoại / email PayPal" },
  "开户行": { "en-US": "Bank name", "ja-JP": "銀行名", "ko-KR": "은행명", "vi-VN": "Tên ngân hàng" },
  "提交": { "en-US": "Submit", "ja-JP": "送信", "ko-KR": "제출", "vi-VN": "Gửi" },
  "输入价格（Prompt）": { "en-US": "Input price (Prompt)", "ja-JP": "入力価格（Prompt）", "ko-KR": "입력 가격(Prompt)", "vi-VN": "Giá đầu vào (Prompt)" },
  "输出价格（Completion）": { "en-US": "Output price (Completion)", "ja-JP": "出力価格（Completion）", "ko-KR": "출력 가격(Completion)", "vi-VN": "Giá đầu ra (Completion)" },
  "缓存读取价格（命中）": { "en-US": "Cache read price (hit)", "ja-JP": "キャッシュ読み取り価格（ヒット）", "ko-KR": "캐시 읽기 가격(적중)", "vi-VN": "Giá đọc cache (hit)" },
  "缓存写入价格": { "en-US": "Cache write price", "ja-JP": "キャッシュ書き込み価格", "ko-KR": "캐시 쓰기 가격", "vi-VN": "Giá ghi cache" },
  "平台附加费": { "en-US": "Platform surcharge", "ja-JP": "プラットフォーム追加料金", "ko-KR": "플랫폼 추가 요금", "vi-VN": "Phụ phí nền tảng" },
  "按 Token 计费": { "en-US": "Billed per token", "ja-JP": "トークン単位で課金", "ko-KR": "토큰당 과금", "vi-VN": "Tính phí theo token" },
  "按次计费": { "en-US": "Billed per request", "ja-JP": "リクエスト単位で課金", "ko-KR": "요청당 과금", "vi-VN": "Tính phí theo lần gọi" },
  "按张计费": { "en-US": "Billed per image", "ja-JP": "画像単位で課金", "ko-KR": "이미지당 과금", "vi-VN": "Tính phí theo ảnh" },
  "按秒计费": { "en-US": "Billed per second", "ja-JP": "秒単位で課金", "ko-KR": "초당 과금", "vi-VN": "Tính phí theo giây" },
  "按输出与参考素材动态计费": { "en-US": "Dynamic billing by output and reference media", "ja-JP": "出力と参照素材に基づく動的課金", "ko-KR": "출력 및 참조 자료에 따른 동적 과금", "vi-VN": "Tính phí động theo đầu ra và tài liệu tham chiếu" },
  "按 Seedance 输出 Token 动态计费": { "en-US": "Dynamic billing by Seedance output tokens", "ja-JP": "Seedance出力トークンによる動的課金", "ko-KR": "Seedance 출력 토큰 기준 동적 과금", "vi-VN": "Tính phí động theo token đầu ra Seedance" },
  "未知": { "en-US": "Unknown", "ja-JP": "不明", "ko-KR": "알 수 없음", "vi-VN": "Không rõ" },
  "查看当前模型的计费方式、展示口径与单价。": { "en-US": "View this model's billing method, display basis, and unit price.", "ja-JP": "モデルの課金方式、表示基準、単価を確認します。", "ko-KR": "현재 모델의 과금 방식, 표시 기준 및 단가를 확인하세요.", "vi-VN": "Xem phương thức tính phí, cách hiển thị và đơn giá của model hiện tại." },
  "动态估算": { "en-US": "Dynamic estimate", "ja-JP": "動的見積もり", "ko-KR": "동적 추정", "vi-VN": "Ước tính động" },
  "每 1M Tokens": { "en-US": "Per 1M tokens", "ja-JP": "100万トークンあたり", "ko-KR": "1M 토큰당", "vi-VN": "Mỗi 1M token" },
  "算力": { "en-US": "Credits", "ja-JP": "クレジット", "ko-KR": "크레딧", "vi-VN": "Credit" },
  "价格以系统算力度量为准，充值后即可直接调用。": { "en-US": "Prices use the system credit unit; recharge to call models directly.", "ja-JP": "価格はシステムのクレジット単位で表示され、チャージ後すぐに利用できます。", "ko-KR": "가격은 시스템 크레딧 단위이며 충전 후 바로 호출할 수 있습니다.", "vi-VN": "Giá dùng đơn vị credit của hệ thống; nạp tiền để gọi model trực tiếp." },
  "请选择视频文件": { "en-US": "Select a video file", "ja-JP": "動画ファイルを選択してください", "ko-KR": "동영상 파일을 선택하세요", "vi-VN": "Hãy chọn tệp video" },
  "视频上传失败": { "en-US": "Video upload failed", "ja-JP": "動画のアップロードに失敗しました", "ko-KR": "동영상 업로드 실패", "vi-VN": "Tải video thất bại" },
  "请选择图片文件作为风格参考": { "en-US": "Select an image file as the style reference", "ja-JP": "スタイル参照用の画像ファイルを選択してください", "ko-KR": "스타일 참조로 사용할 이미지 파일을 선택하세요", "vi-VN": "Hãy chọn tệp ảnh làm tham chiếu phong cách" },
  "风格参考图上传失败": { "en-US": "Style reference image upload failed", "ja-JP": "スタイル参照画像のアップロードに失敗しました", "ko-KR": "스타일 참조 이미지 업로드 실패", "vi-VN": "Tải ảnh tham chiếu phong cách thất bại" },
  "图片资产库加载失败": { "en-US": "Failed to load image assets", "ja-JP": "画像アセットの読み込みに失敗しました", "ko-KR": "이미지 에셋을 불러오지 못했습니다", "vi-VN": "Không thể tải tài sản hình ảnh" },
  "请先上传或从资产库选择源视频": { "en-US": "Upload or choose a source video from the asset library first", "ja-JP": "先に動画をアップロードするか、アセットライブラリから選択してください", "ko-KR": "먼저 동영상을 업로드하거나 에셋 라이브러리에서 선택하세요", "vi-VN": "Trước tiên hãy tải lên hoặc chọn video nguồn từ thư viện tài sản" },
  "任务启动失败": { "en-US": "Failed to start task", "ja-JP": "タスクの開始に失敗しました", "ko-KR": "작업 시작 실패", "vi-VN": "Không thể bắt đầu tác vụ" },
  "重试失败": { "en-US": "Retry failed", "ja-JP": "再試行に失敗しました", "ko-KR": "재시도 실패", "vi-VN": "Thử lại thất bại" },
  "取消任务失败": { "en-US": "Failed to cancel task", "ja-JP": "タスクのキャンセルに失敗しました", "ko-KR": "작업 취소 실패", "vi-VN": "Không thể hủy tác vụ" },
  "项目": { "en-US": "Projects", "ja-JP": "プロジェクト", "ko-KR": "프로젝트", "vi-VN": "Dự án" },
  "控制剧本中的旁白视角与角色对白结构": { "en-US": "Control the narration perspective and character dialogue structure in the script", "ja-JP": "脚本のナレーション視点とキャラクター台詞の構成を制御", "ko-KR": "대본의 내레이션 관점과 캐릭터 대화 구조를 제어합니다", "vi-VN": "Điều khiển góc nhìn dẫn chuyện và cấu trúc thoại nhân vật trong kịch bản" },
  "当前视频模型不支持参考图": { "en-US": "The current video model does not support reference images", "ja-JP": "現在の動画モデルは参照画像に対応していません", "ko-KR": "현재 동영상 모델은 참조 이미지를 지원하지 않습니다", "vi-VN": "Model video hiện tại không hỗ trợ ảnh tham chiếu" },
  "对话模型": { "en-US": "Chat model", "ja-JP": "チャットモデル", "ko-KR": "채팅 모델", "vi-VN": "Model trò chuyện" },
  "多个模型用英文逗号分隔，首个为主模型。": { "en-US": "Separate multiple models with English commas; the first is the primary model.", "ja-JP": "複数モデルは英語カンマで区切り、先頭をメインモデルにします。", "ko-KR": "여러 모델은 영문 쉼표로 구분하며 첫 번째 모델이 기본 모델입니다.", "vi-VN": "Phân tách nhiều model bằng dấu phẩy tiếng Anh; model đầu tiên là model chính." },
  "上传失败": { "en-US": "Upload failed", "ja-JP": "アップロードに失敗しました", "ko-KR": "업로드 실패", "vi-VN": "Tải lên thất bại" },
  "参考音频": { "en-US": "Reference audio", "ja-JP": "参照音声", "ko-KR": "참조 오디오", "vi-VN": "Âm thanh tham chiếu" },
  "移除": { "en-US": "Remove", "ja-JP": "削除", "ko-KR": "제거", "vi-VN": "Xóa" },
  "上传中...": { "en-US": "Uploading...", "ja-JP": "アップロード中…", "ko-KR": "업로드 중...", "vi-VN": "Đang tải lên..." },
  "上传参考音频": { "en-US": "Upload reference audio", "ja-JP": "参照音声をアップロード", "ko-KR": "참조 오디오 업로드", "vi-VN": "Tải âm thanh tham chiếu lên" },
  "暂无渠道预设": { "en-US": "No channel presets", "ja-JP": "チャンネルプリセットはありません", "ko-KR": "채널 프리셋이 없습니다", "vi-VN": "Chưa có preset kênh" },
  "暂无灵感作品": { "en-US": "No inspiration works", "ja-JP": "インスピレーション作品はありません", "ko-KR": "영감 작품이 없습니다", "vi-VN": "Chưa có tác phẩm cảm hứng" },
  "转绘设置": { "en-US": "Style transfer settings", "ja-JP": "スタイル変換設定", "ko-KR": "스타일 변환 설정", "vi-VN": "Cài đặt chuyển phong cách" },
  "去字幕设置": { "en-US": "Subtitle removal settings", "ja-JP": "字幕除去設定", "ko-KR": "자막 제거 설정", "vi-VN": "Cài đặt xóa phụ đề" },
  "保留动作": { "en-US": "Preserve motion", "ja-JP": "動きを保持", "ko-KR": "동작 유지", "vi-VN": "Giữ chuyển động" },
  "保留人物": { "en-US": "Preserve subjects", "ja-JP": "人物を保持", "ko-KR": "인물 유지", "vi-VN": "Giữ nhân vật" },
  "处理模式": { "en-US": "Processing mode", "ja-JP": "処理モード", "ko-KR": "처리 모드", "vi-VN": "Chế độ xử lý" },
  "字幕区域": { "en-US": "Subtitle region", "ja-JP": "字幕領域", "ko-KR": "자막 영역", "vi-VN": "Khu vực phụ đề" },
  "保护水印与 Logo": { "en-US": "Protect watermark and logo", "ja-JP": "ウォーターマークとロゴを保護", "ko-KR": "워터마크 및 로고 보호", "vi-VN": "Bảo vệ watermark và logo" },
  "限制 AI 只修复指定字幕区域": { "en-US": "Limit AI restoration to the specified subtitle region", "ja-JP": "AIの修復範囲を指定した字幕領域に限定", "ko-KR": "AI 복원을 지정된 자막 영역으로 제한합니다", "vi-VN": "Giới hạn AI chỉ khôi phục khu vực phụ đề đã chọn" },
  "转绘结果": { "en-US": "Style transfer result", "ja-JP": "スタイル変換結果", "ko-KR": "스타일 변환 결과", "vi-VN": "Kết quả chuyển phong cách" },
  "无字幕视频": { "en-US": "Subtitle-free video", "ja-JP": "字幕なし動画", "ko-KR": "자막 없는 동영상", "vi-VN": "Video không phụ đề" },
  "选择风格参考图": { "en-US": "Choose a style reference image", "ja-JP": "スタイル参照画像を選択", "ko-KR": "스타일 참조 이미지 선택", "vi-VN": "Chọn ảnh tham chiếu phong cách" },
  "只显示当前账号可访问的图片资产": { "en-US": "Only show image assets accessible to the current account", "ja-JP": "現在のアカウントがアクセスできる画像アセットのみ表示", "ko-KR": "현재 계정에서 접근할 수 있는 이미지만 표시", "vi-VN": "Chỉ hiển thị tài sản hình ảnh mà tài khoản hiện tại có thể truy cập" },
  "暂无可用图片资产": { "en-US": "No available image assets", "ja-JP": "利用可能な画像アセットはありません", "ko-KR": "사용 가능한 이미지 에셋이 없습니다", "vi-VN": "Chưa có tài sản hình ảnh khả dụng" },
  "生成数量": { "en-US": "Generation count", "ja-JP": "生成数", "ko-KR": "생성 수량", "vi-VN": "Số lượng tạo" },
  "选择生成内容的数量": { "en-US": "Choose how many items to generate", "ja-JP": "生成するコンテンツの数を選択", "ko-KR": "생성할 콘텐츠 수를 선택하세요", "vi-VN": "Chọn số lượng nội dung cần tạo" },
  "自定义数量": { "en-US": "Custom quantity", "ja-JP": "カスタム数", "ko-KR": "사용자 지정 수량", "vi-VN": "Số lượng tùy chỉnh" },
  "确定": { "en-US": "Confirm", "ja-JP": "確定", "ko-KR": "확인", "vi-VN": "Xác nhận" },
  "精选": { "en-US": "Featured", "ja-JP": "おすすめ", "ko-KR": "추천", "vi-VN": "Nổi bật" },
  "未命名作品": { "en-US": "Untitled work", "ja-JP": "無題の作品", "ko-KR": "제목 없는 작품", "vi-VN": "Tác phẩm chưa đặt tên" },
  "从社区作品中提取提示词和模型配置，一键生成同款。": { "en-US": "Extract prompts and model settings from community works and generate a similar result in one click.", "ja-JP": "コミュニティ作品からプロンプトとモデル設定を抽出し、ワンクリックで同様の作品を生成します。", "ko-KR": "커뮤니티 작품에서 프롬프트와 모델 설정을 추출해 한 번에 비슷한 결과를 생성합니다.", "vi-VN": "Trích xuất prompt và cấu hình model từ tác phẩm cộng đồng để tạo kết quả tương tự chỉ với một lần nhấp." },
  "客服微信二维码": { "en-US": "Customer service WeChat QR code", "ja-JP": "カスタマーサポートWeChat QRコード", "ko-KR": "고객지원 WeChat QR 코드", "vi-VN": "Mã QR WeChat hỗ trợ khách hàng" },
  "确认删除这个作品？作品记录和已转存文件都会被清理。": { "en-US": "Delete this work? Its record and stored files will be removed.", "ja-JP": "この作品を削除しますか？記録と保存済みファイルも削除されます。", "ko-KR": "이 작품을 삭제할까요? 기록과 저장된 파일도 삭제됩니다.", "vi-VN": "Xóa tác phẩm này? Bản ghi và tệp đã lưu cũng sẽ bị xóa." },
  "请填写有效的算力点价格": { "en-US": "Enter a valid credit price", "ja-JP": "有効なクレジット価格を入力してください", "ko-KR": "유효한 크레딧 가격을 입력하세요", "vi-VN": "Hãy nhập giá credit hợp lệ" },
  "已提交发布，审核通过后会出现在灵感广场。": { "en-US": "Submitted for publishing. It will appear in the inspiration gallery after approval.", "ja-JP": "公開申請を送信しました。審査後にインスピレーションギャラリーに表示されます。", "ko-KR": "게시 요청을 제출했습니다. 승인 후 영감 갤러리에 표시됩니다.", "vi-VN": "Đã gửi để đăng. Tác phẩm sẽ xuất hiện trong thư viện cảm hứng sau khi được duyệt." },
  "发布失败": { "en-US": "Publish failed", "ja-JP": "公開に失敗しました", "ko-KR": "게시 실패", "vi-VN": "Đăng thất bại" },
  "全部作品": { "en-US": "All works", "ja-JP": "すべての作品", "ko-KR": "모든 작품", "vi-VN": "Tất cả tác phẩm" },
  "查看原视频": { "en-US": "View original video", "ja-JP": "元の動画を表示", "ko-KR": "원본 동영상 보기", "vi-VN": "Xem video gốc" },
  "打开原音频": { "en-US": "Open original audio", "ja-JP": "元の音声を開く", "ko-KR": "원본 오디오 열기", "vi-VN": "Mở âm thanh gốc" },
  "查看原图": { "en-US": "View original image", "ja-JP": "元の画像を表示", "ko-KR": "원본 이미지 보기", "vi-VN": "Xem ảnh gốc" },
  "下载作品": { "en-US": "Download work", "ja-JP": "作品をダウンロード", "ko-KR": "작품 다운로드", "vi-VN": "Tải tác phẩm" },
  "未命名": { "en-US": "Untitled", "ja-JP": "無題", "ko-KR": "제목 없음", "vi-VN": "Chưa đặt tên" },
  "开始": { "en-US": "Start", "ja-JP": "開始", "ko-KR": "시작", "vi-VN": "Bắt đầu" },
  "方案确认": { "en-US": "Plan confirmation", "ja-JP": "プラン確認", "ko-KR": "계획 확인", "vi-VN": "Xác nhận kế hoạch" },
  "已完成": { "en-US": "Completed", "ja-JP": "完了", "ko-KR": "완료", "vi-VN": "Đã hoàn thành" },
  "失败": { "en-US": "Failed", "ja-JP": "失敗", "ko-KR": "실패", "vi-VN": "Thất bại" },
  "分镜规划中...": { "en-US": "Planning storyboard...", "ja-JP": "絵コンテを計画中…", "ko-KR": "스토리보드 계획 중...", "vi-VN": "Đang lập storyboard..." },
  "分段视频生成中...": { "en-US": "Generating video segments...", "ja-JP": "動画セグメントを生成中…", "ko-KR": "동영상 세그먼트 생성 중...", "vi-VN": "Đang tạo các đoạn video..." },
  "最终成片合成中...": { "en-US": "Compositing final video...", "ja-JP": "最終動画を合成中…", "ko-KR": "최종 동영상 합성 중...", "vi-VN": "Đang ghép video cuối..." },
  "成片整理中...": { "en-US": "Organizing final output...", "ja-JP": "完成品を整理中…", "ko-KR": "최종 결과 정리 중...", "vi-VN": "Đang hoàn thiện sản phẩm..." },
  "关键帧生成中...": { "en-US": "Generating keyframes...", "ja-JP": "キーフレームを生成中…", "ko-KR": "키프레임 생성 중...", "vi-VN": "Đang tạo keyframe..." },
  "AI漫剧规划中...": { "en-US": "Planning AI comic video...", "ja-JP": "AIコミック動画を計画中…", "ko-KR": "AI 만화 동영상 계획 중...", "vi-VN": "Đang lập kế hoạch video truyện tranh AI..." },
  "视频生成中...": { "en-US": "Generating video...", "ja-JP": "動画を生成中…", "ko-KR": "동영상 생성 중...", "vi-VN": "Đang tạo video..." },
  "图片生成中...": { "en-US": "Generating images...", "ja-JP": "画像を生成中…", "ko-KR": "이미지 생성 중...", "vi-VN": "Đang tạo hình ảnh..." },
  "AI分析中...": { "en-US": "AI is analyzing...", "ja-JP": "AIが分析中…", "ko-KR": "AI 분석 중...", "vi-VN": "AI đang phân tích..." },
};

function translateBuiltinSource(source: string, locale: string) {
  const direct = BUILTIN_SOURCE_TRANSLATIONS[source]?.[locale];
  if (direct) return direct;
  const sourceDictionary = dictionaries["zh-CN"] || {};
  const targetDictionary = dictionaries[locale] || dictionaries["en-US"] || {};
  const englishDictionary = dictionaries["en-US"] || {};
  const key = Object.keys(sourceDictionary).find((candidate) => sourceDictionary[candidate] === source);
  if (!key) return "";
  const value = targetDictionary[key] || englishDictionary[key];
  return value && value !== source ? value : "";
}

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
        const next = normalizeUILanguages(cfg?.ui_languages);
        setLanguages(next);
        setOverrides(normalizeTranslationOverrides(cfg?.ui_translation_overrides));
        const stored = localStorage.getItem("site_locale") || "";
        const userLocale = user?.locale || "";
        setLocaleState((current) => matchLocale([stored, current, userLocale, cfg?.default_locale || "", navigator.language], next));
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
      const keyCurrent = usableTranslation(BUILTIN_KEY_TRANSLATIONS[key as string]?.[locale]);
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
      const sourceFallback = locale !== "zh-CN" ? translateBuiltinSource(String(key), locale) : "";
      return interpolate(String(overrideCurrent || extraCurrent || keyCurrent || current || sourceFallback || overrideEn || extraEn || fallbackEn || overrideZh || extraZh || fallbackZh || key), vars);
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
      const translatedFallback = locale !== "zh-CN" ? translateBuiltinSource(fallback, locale) : "";
      return interpolate(translatedFallback || fallback, vars);
    },
    [locale, overrides]
  );

  const ts = useCallback((source: string) => {
    if (locale === "zh-CN" || !source.trim()) return source;
    return usableTranslation(overrides[locale]?.[sourceTranslationKey(source.trim())]) || translateBuiltinSource(source.trim(), locale) || source;
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
