import type { UILanguage } from "@starai/shared-types";

export const BUILTIN_LANGUAGE_META: Record<string, Pick<UILanguage, "short" | "name" | "flag">> = {
  "zh-CN": { short: "ZH", name: "\u4e2d\u6587\uff08\u7b80\u4f53\uff09", flag: "\u{1F1E8}\u{1F1F3}" },
  "en-US": { short: "EN", name: "English", flag: "\u{1F1FA}\u{1F1F8}" },
  "ja-JP": { short: "JA", name: "\u65e5\u672c\u8a9e", flag: "\u{1F1EF}\u{1F1F5}" },
  "ko-KR": { short: "KO", name: "\ud55c\uad6d\uc5b4", flag: "\u{1F1F0}\u{1F1F7}" },
  "vi-VN": { short: "VI", name: "Ti\u1ebfng Vi\u1ec7t", flag: "\u{1F1FB}\u{1F1F3}" },
};

export const BUILTIN_KEY_TRANSLATIONS: Record<string, Record<string, string>> = {
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
  "category.chat": { "en-US": "Chat", "ja-JP": "チャット", "ko-KR": "채팅", "vi-VN": "Trò chuyện" },
  "category.image": { "en-US": "Image", "ja-JP": "画像", "ko-KR": "이미지", "vi-VN": "Hình ảnh" },
  "category.video": { "en-US": "Video", "ja-JP": "動画", "ko-KR": "동영상", "vi-VN": "Video" },
  "category.audio": { "en-US": "Audio", "ja-JP": "音声", "ko-KR": "오디오", "vi-VN": "Âm thanh" },
};
