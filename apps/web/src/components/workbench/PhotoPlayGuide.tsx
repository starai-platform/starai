"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n/I18nProvider";

type PhotoPlayGuideProps = {
  open: boolean;
  onClose: () => void;
};

export function PhotoPlayGuide({ open, onClose }: PhotoPlayGuideProps) {
  const { ts } = useI18n();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm dark:bg-black/80" onClick={onClose} />

      <div className="relative mx-4 max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700/50 dark:bg-gray-900">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/95 px-6 py-4 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded bg-fuchsia-50 px-2 py-0.5 text-sm font-medium text-fuchsia-600 dark:bg-fuchsia-500/10 dark:text-fuchsia-400">
                {ts("你的专属 AI 编辑部 · 摄影团队")}
              </span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              {ts("上传一张照片，产出一整套杂志级写真")}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="max-h-[calc(90vh-88px)] overflow-y-auto px-6 py-6">
          <div className="mb-8 rounded-xl border border-fuchsia-100 bg-gradient-to-br from-fuchsia-50 to-purple-50 p-6 dark:border-fuchsia-500/20 dark:from-fuchsia-500/10 dark:to-purple-500/10">
            <p className="text-lg leading-relaxed text-gray-700 dark:text-gray-200">
              {ts("摄影总监领队，造型师、摄影师、修图师多位 AI 专家协同作战——上传一张清晰的本人正面照片，选好写真类型与风格倾向，几分钟即可拿到一整套人像保真的写真。")}
            </p>
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-lg font-bold text-fuchsia-600 dark:text-fuchsia-400">{ts("人像特征保真")}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-fuchsia-600 dark:text-fuchsia-400">{ts("38 种主流风格")}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-fuchsia-600 dark:text-fuchsia-400">{ts("影棚级光影质感")}</div>
              </div>
            </div>
          </div>

          <section className="mb-8">
            <h3 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">{ts("认识你的 AI 编辑部")}</h3>
            <p className="mb-6 text-gray-600 dark:text-gray-300">
              {ts("像一家真实的摄影工作室：总监统筹全局，造型师设计方案，摄影师负责出片，修图师精修交付，每一步都为你把关。")}
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {ROLES_INFO.map((role, index) => (
                <div key={role.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700/50 dark:bg-gray-800/50">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img loading="lazy" decoding="async" src={role.avatar} alt={ts(role.name)} className="h-12 w-12 rounded-lg bg-fuchsia-50 object-cover dark:bg-fuchsia-500/10" />
                    </div>
                    <div className="flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-400 dark:text-gray-500">0{index + 1}</span>
                        <h4 className="font-bold text-gray-900 dark:text-white">{ts(role.name)}</h4>
                      </div>
                      <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">{ts(role.description)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-8 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-6 dark:border-amber-500/20 dark:from-amber-500/10 dark:to-orange-500/10">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">TIP</span>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">{ts("照片选得好，出片更惊艳")}</h3>
            </div>
            <ul className="space-y-2 text-gray-700 dark:text-gray-200">
              <li>{ts("· 优先选择光线充足、五官清晰的正面半身照")}</li>
              <li>{ts("· 避免大逆光、过度美颜或遮挡面部的照片")}</li>
              <li>{ts("· 证件照会选择白/蓝/红纯色背景与标准构图")}</li>
              <li>{ts("· 有服装、场景或动作想法，写在“额外要求”里即可")}</li>
            </ul>
          </section>

          <section className="mb-8">
            <h3 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">{ts("使用流程")}</h3>
            <p className="mb-6 text-gray-500 dark:text-gray-400">{ts("四步走完，全程点选")}</p>
            <div className="space-y-4">
              {WORKFLOW_STEPS.map((step) => (
                <div key={step.number} className="flex gap-4">
                  <div className="flex-shrink-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-100 font-bold text-fuchsia-600 dark:bg-fuchsia-500/20 dark:text-fuchsia-400">
                      {step.number}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <h4 className="font-bold text-gray-900 dark:text-white">{ts(step.title)}</h4>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{ts(step.stage)}</span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{ts(step.description)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">{ts("更多亮点")}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {HIGHLIGHTS.map((item) => (
                <div key={item.title} className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700/30 dark:bg-gray-800/30">
                  <h4 className="mb-2 font-bold text-gray-900 dark:text-white">{ts(item.title)}</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{ts(item.description)}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-8 rounded-xl border border-fuchsia-200 bg-gradient-to-r from-fuchsia-50 to-purple-50 p-6 text-center dark:border-fuchsia-500/30 dark:from-fuchsia-500/20 dark:to-purple-500/20">
            <p className="text-lg font-medium text-gray-900 dark:text-white">
              {ts("上传一张照片，剩下的交给你的 AI 编辑部。")}
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
    id: "photo_director",
    name: "摄影总监",
    avatar: "/assets/photo-studio/photo-director.png",
    description: "统筹整场拍摄，把控写真类型、风格与出片质量",
  },
  {
    id: "stylist",
    name: "造型师",
    avatar: "/assets/photo-studio/stylist.png",
    description: "根据照片与风格倾向设计妆造、服装与拍摄方案",
  },
  {
    id: "photographer",
    name: "摄影师",
    avatar: "/assets/photo-studio/photographer.png",
    description: "按拍摄方案出片，影棚级布光与构图",
  },
  {
    id: "retoucher",
    name: "修图师",
    avatar: "/assets/photo-studio/retoucher.png",
    description: "保留人像特征的精修质感，皮肤与光影自然通透",
  },
];

const WORKFLOW_STEPS = [
  {
    number: "01",
    stage: "准备",
    title: "上传本人照片",
    description: "上传或从资产库选择一张清晰的本人正面照片，系统全程保留你的人像特征。",
  },
  {
    number: "02",
    stage: "准备",
    title: "选择类型与风格",
    description: "写真、职业照、证件照三种类型；38 种主流风格倾向，决定妆造、场景与色调。",
  },
  {
    number: "03",
    stage: "AI 协作",
    title: "造型设计与开拍",
    description: "造型师先产出拍摄方案，摄影师按方案调用你挑选的图片大模型批量出片。",
  },
  {
    number: "04",
    stage: "交付",
    title: "精修交付",
    description: "修图师完成自然精修，整套写真在结果页查看原图，可随时下载。",
  },
];

const HIGHLIGHTS = [
  {
    title: "人像保真",
    description: "以你的照片为参考图生成，五官与脸型特征全程保留，越看越像你。",
  },
  {
    title: "模型自由选",
    description: "出图模型由你决定，不同图片大模型的画质与价格透明可比。",
  },
  {
    title: "证件照模式",
    description: "白/蓝/红三色底色任选，标准构图与纯色背景，拿来即用。",
  },
];
