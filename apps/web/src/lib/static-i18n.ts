const STATIC_TRANSLATIONS: Record<string, Record<string, string>> = {
  "zh-CN": {
    "common.backHome": "返回首页",
    "legal.terms": "服务协议",
    "legal.privacy": "隐私政策",
    "legal.termsEmpty": "暂未配置服务协议内容，请联系平台管理员。",
    "legal.privacyEmpty": "暂未配置隐私政策内容，请联系平台管理员。",
  },
  "en-US": {
    "common.backHome": "Back to home",
    "legal.terms": "Terms of Service",
    "legal.privacy": "Privacy Policy",
    "legal.termsEmpty": "No Terms of Service content is configured yet. Please contact the platform administrator.",
    "legal.privacyEmpty": "No Privacy Policy content is configured yet. Please contact the platform administrator.",
  },
  "ja-JP": {
    "common.backHome": "ホームへ戻る",
    "legal.terms": "利用規約",
    "legal.privacy": "プライバシーポリシー",
    "legal.termsEmpty": "利用規約の内容はまだ設定されていません。管理者にお問い合わせください。",
    "legal.privacyEmpty": "プライバシーポリシーの内容はまだ設定されていません。管理者にお問い合わせください。",
  },
  "ko-KR": {
    "common.backHome": "홈으로 돌아가기",
    "legal.terms": "서비스 약관",
    "legal.privacy": "개인정보 처리방침",
    "legal.termsEmpty": "서비스 약관 내용이 아직 설정되지 않았습니다. 플랫폼 관리자에게 문의하세요.",
    "legal.privacyEmpty": "개인정보 처리방침 내용이 아직 설정되지 않았습니다. 플랫폼 관리자에게 문의하세요.",
  },
  "vi-VN": {
    "common.backHome": "Về trang chủ",
    "legal.terms": "Điều khoản dịch vụ",
    "legal.privacy": "Chính sách quyền riêng tư",
    "legal.termsEmpty": "Chưa cấu hình nội dung Điều khoản dịch vụ. Vui lòng liên hệ quản trị viên nền tảng.",
    "legal.privacyEmpty": "Chưa cấu hình nội dung Chính sách quyền riêng tư. Vui lòng liên hệ quản trị viên nền tảng.",
  },
};

export function staticT(locale: unknown, key: string) {
  const code = String(locale || "zh-CN");
  return STATIC_TRANSLATIONS[code]?.[key] || STATIC_TRANSLATIONS["en-US"]?.[key] || STATIC_TRANSLATIONS["zh-CN"]?.[key] || key;
}
