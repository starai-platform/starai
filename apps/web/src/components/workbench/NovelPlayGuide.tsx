"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n/I18nProvider";

type NovelPlayGuideProps = {
  open: boolean;
  onClose: () => void;
};

export function NovelPlayGuide({ open, onClose }: NovelPlayGuideProps) {
  const { ts } = useI18n();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* 弹窗内容 */}
      <div className="relative w-full max-w-4xl max-h-[90vh] mx-4 bg-gray-900 rounded-2xl border border-gray-700/50 shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-gray-900/95 backdrop-blur border-b border-gray-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-indigo-400 px-2 py-0.5 bg-indigo-500/10 rounded">
                {ts("你的专属 AI 编辑部")}
              </span>
            </div>
            <h2 className="text-2xl font-bold text-white">
              {ts("一句话创意，让 AI 帮你写完一整本书")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* 滚动内容 */}
        <div className="overflow-y-auto max-h-[calc(90vh-88px)] px-6 py-6">
          {/* 核心卖点 */}
          <div className="mb-8 p-6 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-xl border border-indigo-500/20">
            <p className="text-lg text-gray-200 leading-relaxed">
              {ts("总编领队，故事策划、节奏编排师、章节写手、文学润色师、审校员、档案员多位 AI 专家协同作战——大纲逐章确认、设定全程追踪、写完自动润色审校，几十万字也不崩设定、不漂文风。")}
            </p>
            <div className="grid grid-cols-3 gap-4 mt-6">
              <div className="text-center">
                <div className="text-indigo-400 font-bold text-lg">{ts("设定台账全程追踪")}</div>
              </div>
              <div className="text-center">
                <div className="text-indigo-400 font-bold text-lg">{ts("文风指纹全书统一")}</div>
              </div>
              <div className="text-center">
                <div className="text-indigo-400 font-bold text-lg">{ts("全程对话可控")}</div>
              </div>
            </div>
          </div>

          {/* 认识你的AI编辑部 */}
          <section className="mb-8">
            <h3 className="text-xl font-bold text-white mb-4">{ts("认识你的 AI 编辑部")}</h3>
            <p className="text-gray-300 mb-6">
              {ts("像一家真实的出版编辑部：总编统筹全局，多位专家各司其职，每一章都经过策划、节奏编排、写作、润色、审校与归档才交到你手上。")}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ROLES_INFO.map((role, index) => (
                <div key={role.id} className="p-4 bg-gray-800/50 rounded-xl border border-gray-700/50">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 flex items-center justify-center text-2xl bg-indigo-500/10 rounded-lg">
                        {role.avatar}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-gray-500 font-mono">0{index + 1}</span>
                        <h4 className="font-bold text-white">{ts(role.name)}</h4>
                      </div>
                      <p className="text-sm text-gray-400 leading-relaxed">{ts(role.description)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 最重要的一点 */}
          <section className="mb-8 p-6 bg-gradient-to-r from-amber-500/10 to-orange-500/10 rounded-xl border border-amber-500/20">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold rounded">HOT</span>
              <h3 className="text-xl font-bold text-white">{ts("最重要的一点：动嘴就行")}</h3>
            </div>
            <p className="text-gray-200 mb-4">
              {ts("对任何一章、任何一个情节不满意，都不用手动操作。直接在聊天框说：哪章不满意、想改成什么样，AI 编辑部自动帮你重写。全程只用聊、只用说，零手动。")}
            </p>
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-16 text-center">
                  <span className="text-xs text-indigo-400 font-medium">YOU</span>
                </div>
                <div className="flex-1 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                  <p className="text-gray-300">{ts("“第3章节奏太慢，冲突再激烈一点”")}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-16 text-center">
                  <span className="text-xs text-green-400 font-medium">AI</span>
                </div>
                <div className="flex-1 p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                  <p className="text-gray-300">{ts("AI 自动重写，新版立即呈现")}</p>
                </div>
              </div>
            </div>
          </section>

          {/* 使用流程 */}
          <section className="mb-8">
            <h3 className="text-xl font-bold text-white mb-4">{ts("使用流程")}</h3>
            <p className="text-gray-400 mb-6">{ts("六步走完，全程说人话")}</p>
            <div className="space-y-4">
              {WORKFLOW_STEPS.map((step) => (
                <div key={step.number} className="flex gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 flex items-center justify-center bg-indigo-500/20 text-indigo-400 font-bold rounded-full">
                      {step.number}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-bold text-white">{ts(step.title)}</h4>
                      <span className="text-xs text-gray-500">{ts(step.stage)}</span>
                    </div>
                    <p className="text-sm text-gray-400">{ts(step.description)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 更多亮点 */}
          <section>
            <h3 className="text-xl font-bold text-white mb-4">{ts("更多亮点")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {HIGHLIGHTS.map((item) => (
                <div key={item.title} className="p-4 bg-gray-800/30 rounded-xl border border-gray-700/30">
                  <h4 className="font-bold text-white mb-2">{ts(item.title)}</h4>
                  <p className="text-sm text-gray-400">{ts(item.description)}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 底部CTA */}
          <div className="mt-8 p-6 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-xl border border-indigo-500/30 text-center">
            <p className="text-lg text-white font-medium">
              {ts("说出你的故事创意，剩下的交给你的 AI 编辑部。")}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const ROLES_INFO = [
  {
    id: "chief_editor",
    name: "总编主管",
    avatar: "👔",
    description: "统筹整本书的创作，调度团队、把控节奏与整体质量",
  },
  {
    id: "story_planner",
    name: "故事策划",
    avatar: "📋",
    description: "出故事方向、搭故事圣经、排卷章大纲，一章章写什么安排得明明白白",
  },
  {
    id: "rhythm_editor",
    name: "节奏编排师",
    avatar: "📊",
    description: "排一卷的张力曲线：钩子、爆点、留悬念怎么落位，让读者一章接一章停不下来",
  },
  {
    id: "chapter_writer",
    name: "章节写手",
    avatar: "✍️",
    description: "按大纲和设定档案逐章写正文，上一章结尾接得天衣无缝",
  },
  {
    id: "polish_writer",
    name: "文学润色师",
    avatar: "✨",
    description: "只改语言不改情节，把套话换成画面，让文字更有质感",
  },
  {
    id: "proofreader",
    name: "审校员",
    avatar: "✅",
    description: "每章写完对照设定台账查矛盾：时间线、人物状态、提前泄密一条条把关",
  },
  {
    id: "archivist",
    name: "档案员",
    avatar: "📁",
    description: "每章定稿后更新人物状态与摘要，几十万字后设定照样不崩",
  },
];

const WORKFLOW_STEPS = [
  {
    number: "01",
    stage: "准备",
    title: "说出创意，或贴上旧稿",
    description: "从头创作就说一句话创意；续写就贴上已有书稿——选好题材和篇幅，编辑部立即开工。",
  },
  {
    number: "02",
    stage: "准备",
    title: "策划出方向，你来挑",
    description: "故事策划给出几个故事方向供你选择，再搭好人物、世界观等核心设定，全书的地基先打牢。",
  },
  {
    number: "03",
    stage: "AI 协作",
    title: "确认规模与大纲",
    description: "先确认全书章数（涉及消耗，只确认一次），再逐章过大纲：章名、梗概、预计字数都可以改、可以增删。",
  },
  {
    number: "04",
    stage: "AI 协作",
    title: "逐章开写，边写边审",
    description: "写手按大纲和设定台账逐章写作，文学润色师打磨语言，审校员每章把关，档案员同步更新人物状态——右侧书画布实时看到每一章长出来。",
  },
  {
    number: "05",
    stage: "成书交付",
    title: "不满意？动嘴就行",
    description: "随时在对话里提要求：重写某章、调整情节、加人物线，团队立刻响应，历史版本都留着可以回看。",
  },
  {
    number: "06",
    stage: "成书交付",
    title: "整本导出带走",
    description: "写完一键导出 Word/TXT 文档，设定档案和大纲也一并留档，随时回来续写下一卷。",
  },
];

const HIGHLIGHTS = [
  {
    title: "设定永不崩",
    description: "人物的伤势、位置、关系逐章记台账，写到第 200 章也不会出现断腿复活、死人说话。",
  },
  {
    title: "生成中随时插话",
    description: "团队写作时你随时发消息，需求会排队转达给总编，不打断进度也不会漏掉。",
  },
  {
    title: "整本打包下载",
    description: "全书写完一键导出 Word/TXT 文档，单章正文也能随时复制带走。",
  },
];
