"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ImageIcon, Shirt, UserRound, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n/I18nProvider";

export function TryOnPlayGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ts } = useI18n();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm dark:bg-black/80" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="tryon-guide-title" className="relative mx-4 max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700/50 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <div className="text-sm font-medium text-rose-600 dark:text-rose-300">{ts("AI 试衣间使用说明")}</div>
            <h2 id="tryon-guide-title" className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{ts("上传人物照和服装图，生成自然试穿效果")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={ts("关闭使用说明")} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"><X size={22} /></button>
        </div>

        <div className="max-h-[calc(90vh-82px)] space-y-7 overflow-y-auto px-5 py-5">
          <div className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm leading-6 text-gray-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-gray-200">
            {ts("AI 会把服装图片中的款式、颜色和纹理应用到人物照片上，同时尽量保留人物身份、姿态和背景。结果用于视觉预览，不代表真实尺码和实际穿着效果。")}
          </div>

          <section>
            <h3 className="mb-4 text-lg font-bold text-gray-900 dark:text-white">{ts("准备两张图片")}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <GuideCard icon={<UserRound size={20} />} title={ts("人物照片")} text={ts("建议使用光线充足、身体轮廓完整、无遮挡的正面或轻微侧身照。")} />
              <GuideCard icon={<Shirt size={20} />} title={ts("服装图片")} text={ts("平铺图或模特商品图均可，服装主体要完整，避免遮挡和复杂拼图。")} />
            </div>
          </section>

          <section>
            <h3 className="mb-4 text-lg font-bold text-gray-900 dark:text-white">{ts("使用流程")}</h3>
            <div className="space-y-3">
              {[
                ["选择图片", "本地上传，或先选择人物/服装目标，再从资产库引入。"],
                ["设置参数", "选择服装类型、商品图类型、试衣模型、清晰度和生成张数。"],
                ["确认授权", "确认人物照片为本人或已获得合法使用授权。"],
                ["开始试衣", "点击发送按钮，完成后可在结果页查看和下载图片。"],
              ].map(([title, text], index) => <div key={title} className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-sm font-bold text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">{index + 1}</span><div><div className="font-semibold text-gray-900 dark:text-white">{ts(title)}</div><p className="mt-0.5 text-sm leading-6 text-gray-500 dark:text-gray-400">{ts(text)}</p></div></div>)}
            </div>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/20 dark:bg-amber-500/10">
            <h3 className="mb-3 flex items-center gap-2 font-bold text-gray-900 dark:text-white"><ImageIcon size={18} className="text-amber-600" />{ts("提高成功率")}</h3>
            <ul className="grid gap-2 text-sm text-gray-700 dark:text-gray-200 sm:grid-cols-2">
              {["人物与服装图片都保持清晰", "人物身体区域不要被包或手臂大面积遮挡", "服装尽量单件展示", "补充要求只描述穿法，不要要求改变人物身份"].map((item) => <li key={item} className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" />{ts(item)}</li>)}
            </ul>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}

function GuideCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  const { ts } = useI18n();
  return <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700/50"><div className="mb-2 flex items-center gap-2 font-bold text-gray-900 dark:text-white"><span className="text-rose-500">{icon}</span>{ts(title)}</div><p className="text-sm leading-6 text-gray-500 dark:text-gray-400">{ts(text)}</p></div>;
}
