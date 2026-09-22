const agentCanvas: Record<string, string> = {
  "Agent 通用智能体": "Trợ lý sáng tạo đa năng",
  "新任务": "Tác vụ mới", "Agent 模式": "Chế độ trợ lý", "智能搜索": "Tìm kiếm thông minh", "玩法说明": "Cách sử dụng",
  "智能混合": "Kết hợp thông minh", "AI 根据分镜自动安排旁白和角色对白": "AI tự sắp xếp lời dẫn và hội thoại nhân vật theo storyboard",
  "第一人称": "Ngôi thứ nhất", "以主角“我”的视角进行内心独白或讲述": "Kể chuyện hoặc độc thoại nội tâm từ góc nhìn ngôi thứ nhất của nhân vật chính",
  "第三人称": "Ngôi thứ ba", "由画外旁白以角色姓名、他或她讲述故事": "Lời dẫn ngoài hình kể chuyện bằng tên nhân vật hoặc ngôi thứ ba",
  "角色对白": "Hội thoại nhân vật", "以角色间对白推动剧情，尽量减少画外旁白": "Dùng hội thoại giữa các nhân vật để phát triển cốt truyện và hạn chế lời dẫn ngoài hình",
  "全能创作 Agent": "Trợ lý sáng tạo toàn năng",
  "一句话理解创作目标，连续完成图片、视频、语音与音乐任务；上一轮结果可直接衔接下一轮。": "Hiểu mục tiêu sáng tạo từ một câu và liên tục hoàn thành tác vụ hình ảnh, video, giọng nói và âm nhạc; kết quả trước có thể dùng ngay cho bước tiếp theo.",
  "说出目标，连续完成图片、视频、语音或音乐创作。": "Hãy nêu mục tiêu để liên tục tạo hình ảnh, video, giọng nói hoặc âm nhạc.",
  "生成一套小红书图文笔记和 4 张配图": "Tạo một bài Xiaohongshu kèm 4 hình minh họa",
  "根据角色参考图生成 40-50 秒完整短剧": "Tạo phim ngắn hoàn chỉnh 40–50 giây từ ảnh tham chiếu nhân vật",
  "生成一张产品主图": "Tạo một ảnh sản phẩm chính",
  "做一个 10 秒产品展示视频": "Tạo video giới thiệu sản phẩm 10 giây",
  "理解并连续创作": "Hiểu và sáng tạo liên tục",
  "从自然语言识别目标，自动整理提示词并衔接上一轮结果": "Nhận biết mục tiêu từ ngôn ngữ tự nhiên, tự sắp xếp prompt và tiếp nối kết quả trước",
  "图片与内容图文": "Hình ảnh và nội dung minh họa",
  "支持单图、连续改图，以及标题正文与多张配图的一体化生成": "Hỗ trợ tạo một ảnh, chỉnh sửa liên tục, hoặc tạo đồng bộ tiêu đề, nội dung và nhiều ảnh minh họa",
  "短剧工作流": "Quy trình phim ngắn",
  "自动完成剧本、分镜、分段生成与成片合成": "Tự động hoàn thành kịch bản, storyboard, tạo từng đoạn và ghép phim",
  "语音与音乐": "Giọng nói và âm nhạc",
  "分别调用文本转语音或歌曲音乐模型完成创作": "Dùng model chuyển văn bản thành giọng nói hoặc model âm nhạc để hoàn thành tác phẩm",
  "AI 漫剧 - S2.0": "Video truyện tranh AI - S2.0",
  "输入故事或角色参考图，AI 自动完成剧本、分镜、关键帧、分段视频、配音和成片合成。": "Nhập câu chuyện hoặc ảnh tham chiếu nhân vật; AI sẽ tự động hoàn thành kịch bản, storyboard, keyframe, các đoạn video, lồng tiếng và ghép phim.",
  "意图分析": "Phân tích ý tưởng",
  "理解故事方向、角色关系和风格参考": "Hiểu hướng câu chuyện, quan hệ nhân vật và phong cách tham chiếu",
  "剧本与分镜": "Kịch bản và storyboard",
  "生成大纲、分场剧本和可执行分镜": "Tạo dàn ý, kịch bản theo cảnh và storyboard có thể sản xuất",
  "关键帧生成": "Tạo keyframe",
  "按分镜生成统一画风的关键帧": "Tạo keyframe có phong cách nhất quán cho từng cảnh",
  "视频合成": "Ghép video",
  "生成分段视频并合成为单个成片": "Tạo các đoạn video và ghép thành một video hoàn chỉnh",
  "创意方向": "Hướng sáng tạo", "创作大纲": "Dàn ý", "小说创作": "Viết truyện", "剧本转换": "Chuyển thể kịch bản",
  "主体创建": "Tạo nhân vật", "分镜规划": "Lập storyboard", "主体匹配": "Đối chiếu nhân vật", "分镜脚本": "Kịch bản phân cảnh",
  "关键帧": "Keyframe", "生成视频": "Tạo video",
  "输入是已有剧本／原文：按原文定位分镜，保留来源供核对": "Đã có kịch bản/nguyên văn: căn cảnh theo nguyên văn và giữ nguồn để đối chiếu",
  "长视频规划": "Lập kế hoạch video dài", "批量首尾帧视频": "Tạo hàng loạt video từ khung đầu/cuối", "长视频合成": "Ghép video dài",
  "韩剧审美": "Thẩm mỹ phim Hàn"
  ,"文字生图片": "Văn bản thành hình ảnh", "文本提示词连接图片生成节点": "Kết nối prompt văn bản với nút tạo hình ảnh"
  ,"图片生图片": "Hình ảnh thành hình ảnh", "文本需求连接带参考图入口的图片生成节点": "Kết nối yêu cầu văn bản với nút tạo ảnh có đầu vào ảnh tham chiếu"
  ,"文案与配图": "Nội dung và hình minh họa", "文本需求先生成文案，再生成配图": "Tạo nội dung từ yêu cầu trước, sau đó tạo hình minh họa"
  ,"内容创作": "Sáng tạo nội dung", "面向公众号、小红书和今日头条生成文字内容与多张配图": "Tạo nội dung và nhiều hình minh họa cho WeChat, Xiaohongshu và Toutiao"
  ,"多图对比": "So sánh nhiều hình", "同一文本需求并行生成两套图片方案": "Tạo song song hai phương án hình ảnh từ cùng một yêu cầu"
  ,"文字生视频": "Văn bản thành video", "文本提示词连接视频生成节点": "Kết nối prompt văn bản với nút tạo video"
  ,"首帧生视频": "Khung đầu thành video", "文本需求连接支持人像形象和首帧素材的视频生成节点": "Kết nối yêu cầu với nút video hỗ trợ nhân vật và khung hình đầu"
  ,"首尾帧长视频": "Video dài từ khung đầu/cuối", "已有文案与首尾帧批量生成视频片段并顺序合成": "Tạo hàng loạt đoạn video từ nội dung và khung đầu/cuối, rồi ghép theo thứ tự"
  ,"电商视觉套图": "Bộ hình thương mại điện tử", "商品信息与参考图同时生成主图和详情海报": "Tạo ảnh chính và poster chi tiết từ thông tin sản phẩm cùng ảnh tham chiếu"
  ,"社媒图文视频": "Chiến dịch mạng xã hội", "一份营销文案同时生成社媒配图和短视频": "Tạo hình mạng xã hội và video ngắn từ một nội dung tiếp thị"
  ,"商品展示视频": "Video giới thiệu sản phẩm", "商品图先生成关键视觉，再延展为展示视频": "Tạo hình ảnh chủ đạo từ ảnh sản phẩm rồi phát triển thành video giới thiệu"
  ,"品牌视觉套件": "Bộ nhận diện thương hiệu", "品牌需求并行生成标志创意和视觉海报": "Tạo song song ý tưởng logo và poster từ yêu cầu thương hiệu"
  ,"老照片修复": "Phục chế ảnh cũ", "参考照片经过修复、上色与高清增强生成新图": "Phục chế, tô màu và tăng độ nét cho ảnh tham chiếu"
  ,"视频创作": "Sáng tạo video", "创作需求生成视频脚本、分镜、关键帧、视频片段与完整成片": "Tạo kịch bản, storyboard, keyframe, các đoạn video và thành phẩm từ yêu cầu sáng tạo"
  ,"爆款复刻": "Tái tạo nội dung thịnh hành", "多模态拆解爆款参考，生成多关键帧、多片段并合成为原创短视频": "Phân tích đa phương thức nội dung thịnh hành, tạo keyframe và các đoạn rồi ghép thành video ngắn nguyên bản"
  ,"一键爆款复刻": "Tái tạo thịnh hành một chạm", "导入 TikTok 视频和商品素材，一键拆解并生成原创带货短视频": "Nhập video TikTok và tài liệu sản phẩm để tạo video bán hàng nguyên bản chỉ với một chạm"
  ,"视频复刻": "Tái tạo video", "智能拆镜、替换商品或主体、分段生成并合成原片节奏的新视频": "Tự động tách cảnh, thay sản phẩm hoặc chủ thể, tạo từng đoạn và ghép video mới theo nhịp bản gốc"
  ,"正在打开工作流记录…": "Đang mở lịch sử quy trình…", "按当前模型续传": "Tiếp tục bằng model hiện tại", "停止": "Dừng", "素材生成后会逐步显示在这里。": "Tài nguyên đã tạo sẽ lần lượt xuất hiện tại đây."
  ,"Agent · 无限画布工作流": "Trợ lý · Quy trình canvas vô hạn", "返回对话（工作流继续运行）": "Quay lại trò chuyện (quy trình vẫn tiếp tục)"
  ,"确认继续工作流": "Xác nhận tiếp tục quy trình", "保留已成功素材，只补未完成部分；未完成生成使用当前模型配置，可能产生生成费用。仅重新合成不会调用生成模型。": "Giữ lại tài nguyên đã thành công và chỉ hoàn tất phần còn thiếu. Phần chưa tạo sẽ dùng cấu hình model hiện tại và có thể phát sinh chi phí. Chỉ ghép lại sẽ không gọi model tạo sinh."
  ,"确认续传": "Xác nhận tiếp tục", "取消续传": "Hủy tiếp tục", "同步并更新当前方案，无需重述需求": "Đồng bộ và cập nhật phương án hiện tại, không cần mô tả lại yêu cầu", "已选素材": "Tài nguyên đã chọn"
  ,"Agent 通用智能体玩法说明": "Cách dùng trợ lý sáng tạo đa năng", "直接描述想生成的图片、视频、配音或歌曲音乐，也可以先上传参考文件或从资产库选择素材。": "Mô tả trực tiếp hình ảnh, video, lồng tiếng hoặc âm nhạc bạn muốn tạo. Bạn cũng có thể tải tệp tham chiếu hoặc chọn tài nguyên trong thư viện trước."
  ,"Agent 先区分聊天、文案与生成需求。生成前会展示方案和所用模型，点击“确认并开始生成”后才执行；视频按模型支持的时长规划分段。": "Trợ lý trước tiên phân biệt trò chuyện, nội dung và yêu cầu tạo sinh. Phương án cùng model sẽ được hiển thị trước; chỉ chạy sau khi bạn xác nhận. Video được chia đoạn theo thời lượng model hỗ trợ."
  ,"会话会记住当前需求、角色和文案；仅在明确要求使用上一轮素材时才引用。换模型会保留需求并更新待确认方案，不自动重新生成。": "Cuộc trò chuyện ghi nhớ yêu cầu, vai trò và nội dung hiện tại. Tài nguyên lượt trước chỉ được dùng khi bạn yêu cầu rõ ràng. Đổi model sẽ giữ yêu cầu và cập nhật phương án chờ xác nhận, không tự tạo lại."
  ,"需要指定模型时开启“自定义”，选择一种生成类型后只会显示该类型的模型。": "Bật “Tùy chỉnh” khi cần chọn model. Sau khi chọn loại tạo sinh, hệ thống chỉ hiển thị model thuộc loại đó."
  ,"主聊天模型按实际对话用量计费，生成任务按所选图片、视频或音频模型计费；不额外收取智能体工作流费。": "Model trò chuyện chính được tính theo mức dùng thực tế; tác vụ tạo sinh tính theo model hình ảnh, video hoặc âm thanh đã chọn. Không thu thêm phí quy trình trợ lý."
  ,"下载": "Tải xuống", "已整理的生成提示词 · 尚未执行": "Prompt đã chuẩn bị · Chưa chạy", "复制完整提示词": "Sao chép toàn bộ prompt", "查看完整方案 / 文案": "Xem toàn bộ phương án / nội dung"
  ,"尚未形成可执行正文，请先完善需求": "Chưa có nội dung có thể thực thi; hãy hoàn thiện yêu cầu", "确认并开始生成": "Xác nhận và bắt đầu tạo", "取消": "Hủy", "修改需求可直接在下方输入": "Nhập thay đổi yêu cầu ở bên dưới"
  ,"按最新配置更新方案（保留需求）": "Cập nhật phương án theo cấu hình mới nhất (giữ yêu cầu)", "停止后续生成": "Dừng các bước tạo tiếp theo", "查看本步内容": "Xem nội dung bước này", "查看工作流记录": "Xem lịch sử quy trình"
};

export default agentCanvas;
