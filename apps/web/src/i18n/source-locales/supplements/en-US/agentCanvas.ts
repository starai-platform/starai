const agentCanvas: Record<string, string> = {
  "Agent 通用智能体": "General Creative Agent",
  "新任务": "New task", "Agent 模式": "Agent mode", "智能搜索": "Smart search", "玩法说明": "How to use",
  "智能混合": "Smart mix", "AI 根据分镜自动安排旁白和角色对白": "AI automatically arranges narration and character dialogue from the storyboard",
  "第一人称": "First person", "以主角“我”的视角进行内心独白或讲述": "Use the protagonist's first-person perspective for inner monologue or narration",
  "第三人称": "Third person", "由画外旁白以角色姓名、他或她讲述故事": "Use off-screen narration with character names or third-person pronouns",
  "角色对白": "Character dialogue", "以角色间对白推动剧情，尽量减少画外旁白": "Advance the story through character dialogue with minimal off-screen narration",
  "全能创作 Agent": "All-in-one Creative Agent",
  "一句话理解创作目标，连续完成图片、视频、语音与音乐任务；上一轮结果可直接衔接下一轮。": "Describe your goal in one sentence and complete image, video, speech, and music tasks continuously; each result can feed into the next step.",
  "说出目标，连续完成图片、视频、语音或音乐创作。": "Describe your goal and create images, videos, speech, or music continuously.",
  "生成一套小红书图文笔记和 4 张配图": "Create a Xiaohongshu post with 4 images",
  "根据角色参考图生成 40-50 秒完整短剧": "Create a complete 40–50 second short drama from character references",
  "生成一张产品主图": "Create a product hero image",
  "做一个 10 秒产品展示视频": "Create a 10-second product showcase video",
  "理解并连续创作": "Understand and create continuously",
  "从自然语言识别目标，自动整理提示词并衔接上一轮结果": "Understand goals from natural language, organize prompts, and continue from the previous result",
  "图片与内容图文": "Images and illustrated content",
  "支持单图、连续改图，以及标题正文与多张配图的一体化生成": "Create single images, make iterative edits, or generate titles, body copy, and multiple illustrations together",
  "短剧工作流": "Short drama workflow",
  "自动完成剧本、分镜、分段生成与成片合成": "Complete scripts, storyboards, segments, and final composition automatically",
  "语音与音乐": "Speech and music",
  "分别调用文本转语音或歌曲音乐模型完成创作": "Use text-to-speech or music models to complete audio creation",
  "AI 漫剧 - S2.0": "AI Comic Video - S2.0",
  "输入故事或角色参考图，AI 自动完成剧本、分镜、关键帧、分段视频、配音和成片合成。": "Enter a story or character references and AI will create the script, storyboard, keyframes, video segments, voiceover, and final video.",
  "意图分析": "Intent analysis",
  "理解故事方向、角色关系和风格参考": "Understand the story direction, character relationships, and style references",
  "剧本与分镜": "Script and storyboard",
  "生成大纲、分场剧本和可执行分镜": "Create an outline, scene script, and production-ready storyboard",
  "关键帧生成": "Keyframe generation",
  "按分镜生成统一画风的关键帧": "Generate visually consistent keyframes for each shot",
  "视频合成": "Video composition",
  "生成分段视频并合成为单个成片": "Generate video segments and combine them into one final video",
  "创意方向": "Creative direction", "创作大纲": "Story outline", "小说创作": "Story writing", "剧本转换": "Script adaptation",
  "主体创建": "Character creation", "分镜规划": "Storyboard planning", "主体匹配": "Character matching", "分镜脚本": "Storyboard script",
  "关键帧": "Keyframe", "生成视频": "Generate video",
  "输入是已有剧本／原文：按原文定位分镜，保留来源供核对": "Existing script/source text: align shots to the source and retain references for verification",
  "长视频规划": "Long video planning", "批量首尾帧视频": "Batch first/last-frame video", "长视频合成": "Long video composition",
  "韩剧审美": "K-drama aesthetic"
  ,"文字生图片": "Text to image", "文本提示词连接图片生成节点": "Connect a text prompt to an image generation node"
  ,"图片生图片": "Image to image", "文本需求连接带参考图入口的图片生成节点": "Connect a text request to an image generation node with reference image input"
  ,"文案与配图": "Copy and illustrations", "文本需求先生成文案，再生成配图": "Generate copy from the request, then create matching illustrations"
  ,"内容创作": "Content creation", "面向公众号、小红书和今日头条生成文字内容与多张配图": "Create written content and multiple illustrations for WeChat, Xiaohongshu, and Toutiao"
  ,"多图对比": "Image variations", "同一文本需求并行生成两套图片方案": "Generate two image concepts from the same request in parallel"
  ,"文字生视频": "Text to video", "文本提示词连接视频生成节点": "Connect a text prompt to a video generation node"
  ,"首帧生视频": "First frame to video", "文本需求连接支持人像形象和首帧素材的视频生成节点": "Connect a request to a video node that supports character and first-frame references"
  ,"首尾帧长视频": "First/last-frame long video", "已有文案与首尾帧批量生成视频片段并顺序合成": "Generate video clips in batches from copy and first/last frames, then merge them in order"
  ,"电商视觉套图": "E-commerce visual set", "商品信息与参考图同时生成主图和详情海报": "Generate product hero images and detail posters from product information and references"
  ,"社媒图文视频": "Social media campaign", "一份营销文案同时生成社媒配图和短视频": "Create social images and a short video from one marketing brief"
  ,"商品展示视频": "Product showcase video", "商品图先生成关键视觉，再延展为展示视频": "Create a key visual from product images, then extend it into a showcase video"
  ,"品牌视觉套件": "Brand visual kit", "品牌需求并行生成标志创意和视觉海报": "Generate logo concepts and visual posters from a brand brief in parallel"
  ,"老照片修复": "Photo restoration", "参考照片经过修复、上色与高清增强生成新图": "Restore, colorize, and enhance a reference photo"
  ,"视频创作": "Video creation", "创作需求生成视频脚本、分镜、关键帧、视频片段与完整成片": "Create a script, storyboard, keyframes, clips, and a finished video from a creative brief"
  ,"爆款复刻": "Viral remake", "多模态拆解爆款参考，生成多关键帧、多片段并合成为原创短视频": "Analyze a viral reference across media, generate keyframes and clips, then assemble an original short video"
  ,"一键爆款复刻": "One-click viral remake", "导入 TikTok 视频和商品素材，一键拆解并生成原创带货短视频": "Import a TikTok video and product assets to create an original shoppable short video in one click"
  ,"视频复刻": "Video remake", "智能拆镜、替换商品或主体、分段生成并合成原片节奏的新视频": "Split shots, replace the product or subject, generate clips, and assemble a new video with the source rhythm"
  ,"正在打开工作流记录…": "Opening workflow history…", "按当前模型续传": "Continue with current models", "停止": "Stop", "素材生成后会逐步显示在这里。": "Generated assets will appear here as they become available."
  ,"Agent · 无限画布工作流": "Agent · Infinite Canvas workflow", "返回对话（工作流继续运行）": "Return to chat (workflow keeps running)"
  ,"确认继续工作流": "Confirm workflow continuation", "保留已成功素材，只补未完成部分；未完成生成使用当前模型配置，可能产生生成费用。仅重新合成不会调用生成模型。": "Keep successful assets and generate only unfinished parts. Unfinished generation uses the current model settings and may incur charges. Reassembly alone does not call generation models."
  ,"确认续传": "Confirm continuation", "取消续传": "Cancel continuation", "同步并更新当前方案，无需重述需求": "Sync and update the current plan without restating the request", "已选素材": "Selected assets"
  ,"Agent 通用智能体玩法说明": "How to use the General Creative Agent", "直接描述想生成的图片、视频、配音或歌曲音乐，也可以先上传参考文件或从资产库选择素材。": "Describe the image, video, voiceover, or music you want. You can also upload references or choose assets from the library first."
  ,"Agent 先区分聊天、文案与生成需求。生成前会展示方案和所用模型，点击“确认并开始生成”后才执行；视频按模型支持的时长规划分段。": "The agent first distinguishes chat, copywriting, and generation requests. It shows the plan and models before running; generation starts only after confirmation. Video segments follow the supported model duration."
  ,"会话会记住当前需求、角色和文案；仅在明确要求使用上一轮素材时才引用。换模型会保留需求并更新待确认方案，不自动重新生成。": "The conversation remembers the current request, roles, and copy. Previous assets are reused only when explicitly requested. Changing models keeps the request and updates the pending plan without regenerating automatically."
  ,"需要指定模型时开启“自定义”，选择一种生成类型后只会显示该类型的模型。": "Turn on Custom to select a model. After choosing a generation type, only models for that type are shown."
  ,"主聊天模型按实际对话用量计费，生成任务按所选图片、视频或音频模型计费；不额外收取智能体工作流费。": "The main chat model is billed by actual usage, while generation tasks are billed by the selected image, video, or audio model. There is no additional agent workflow fee."
  ,"下载": "Download", "已整理的生成提示词 · 尚未执行": "Prepared generation prompt · Not run", "复制完整提示词": "Copy full prompt", "查看完整方案 / 文案": "View full plan / copy"
  ,"尚未形成可执行正文，请先完善需求": "No executable content yet; please complete the request", "确认并开始生成": "Confirm and start generation", "取消": "Cancel", "修改需求可直接在下方输入": "Enter changes to the request below"
  ,"按最新配置更新方案（保留需求）": "Update the plan with the latest settings (keep request)", "停止后续生成": "Stop remaining generation", "查看本步内容": "View this step", "查看工作流记录": "View workflow history"
};

export default agentCanvas;
