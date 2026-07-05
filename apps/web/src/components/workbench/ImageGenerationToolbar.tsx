"use client";

import { useMemo, useState } from "react";
import { FileText, Grid3X3, Settings } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { MediaMenuOption, MediaOptionMenu } from "./MediaOptionMenu";

export type ImageSizeTier = "1K" | "2K" | "4K";

export const IMAGE_SIZE_TIERS: ImageSizeTier[] = ["1K", "2K", "4K"];

export const IMAGE_RATIO_SIZE_TABLE = {
  "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" },
  "16:9": { "1K": "1280x720", "2K": "2560x1440", "4K": "3840x2160" },
  "9:16": { "1K": "720x1280", "2K": "1440x2560", "4K": "2160x3840" },
  "3:2": { "1K": "1248x832", "2K": "2496x1664", "4K": "3504x2336" },
  "2:3": { "1K": "832x1248", "2K": "1664x2496", "4K": "2336x3504" },
  "4:3": { "1K": "1152x864", "2K": "2304x1728", "4K": "3264x2448" },
  "3:4": { "1K": "864x1152", "2K": "1728x2304", "4K": "2448x3264" },
  "5:4": { "1K": "1120x896", "2K": "2240x1792", "4K": "3200x2560" },
  "4:5": { "1K": "896x1120", "2K": "1792x2240", "4K": "2560x3200" },
  "7:3": { "1K": "1456x624", "2K": "3024x1296", "4K": "3696x1584" },
  "3:7": { "1K": "624x1456", "2K": "1296x3024", "4K": "1584x3696" },
  "21:9": { "1K": "1456x624", "2K": "3024x1296", "4K": "3696x1584" },
  "9:21": { "1K": "624x1456", "2K": "1296x3024", "4K": "1584x3696" },
  "2:1": { "1K": "1440x720", "2K": "2880x1440", "4K": "3840x1920" },
  "1:2": { "1K": "720x1440", "2K": "1440x2880", "4K": "1920x3840" },
  "3:1": { "1K": "1440x480", "2K": "2880x960", "4K": "3840x1280" },
  "1:3": { "1K": "480x1440", "2K": "960x2880", "4K": "1280x3840" },
} as const;

export type ImageAspectRatio = keyof typeof IMAGE_RATIO_SIZE_TABLE;

export const ALL_RATIOS = Object.keys(IMAGE_RATIO_SIZE_TABLE) as ImageAspectRatio[];
export const COMMON_RATIOS: ImageAspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2"];
const COUNT_OPTIONS = [1, 2, 3, 4];

export function normalizeRatio(value?: string): ImageAspectRatio {
  return ALL_RATIOS.includes(value as ImageAspectRatio) ? (value as ImageAspectRatio) : "1:1";
}

export function normalizeTier(value?: string): ImageSizeTier {
  return IMAGE_SIZE_TIERS.includes(value as ImageSizeTier) ? (value as ImageSizeTier) : "1K";
}

export function getImagePixelSize(ratio?: string, tier?: string) {
  return IMAGE_RATIO_SIZE_TABLE[normalizeRatio(ratio)][normalizeTier(tier)];
}

export function buildImageGenerationParams({
  count,
  ratio,
  imageSize,
}: {
  count?: number;
  ratio?: string;
  imageSize?: string;
}) {
  const aspect_ratio = normalizeRatio(ratio);
  const image_size = normalizeTier(imageSize);
  const size = getImagePixelSize(aspect_ratio, image_size);
  const n = Math.max(1, Math.min(50, Number(count || 1) || 1));
  return { n, count: n, aspect_ratio, image_size, size };
}

export function ImageGenerationToolbar({
  count,
  onCountChange,
  ratio,
  onRatioChange,
  imageSize,
  onImageSizeChange,
}: {
  count: number;
  onCountChange: (value: number) => void;
  ratio: string;
  onRatioChange: (value: string) => void;
  imageSize: string;
  onImageSizeChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [customDraft, setCustomDraft] = useState(String(count || 1));
  const activeRatio = normalizeRatio(ratio);
  const activeTier = normalizeTier(imageSize);
  const completeRatios = useMemo(() => ALL_RATIOS.filter((item) => !COMMON_RATIOS.includes(item)), []);
  const imageUnit = t("unit.image");

  return (
    <>
      <MediaOptionMenu
        icon={<Grid3X3 size={16} />}
        activeLabel={`${count || 1} ${imageUnit}`}
        title={t("imageToolbar.count")}
        subtitle={t("imageToolbar.countDesc")}
        tone="yellow"
        compactOnMobile
      >
        {(close) => (
          <div className="space-y-2">
            {COUNT_OPTIONS.map((n) => (
              <MediaMenuOption
                key={n}
                selected={count === n}
                onClick={() => {
                  onCountChange(n);
                  setCustomDraft(String(n));
                  close();
                }}
              >
                {n} {imageUnit}
              </MediaMenuOption>
            ))}
            <div className="mt-3 border-t border-gray-100 pt-3 dark:border-white/10">
              <div className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t("imageToolbar.customCount")}</div>
              <div className="flex items-center gap-3">
                <input
                  value={customDraft}
                  type="number"
                  min={1}
                  max={50}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-primary focus:outline-none dark:border-white/10 dark:bg-gray-900 dark:text-gray-100 dark:[color-scheme:dark]"
                />
                <button
                  type="button"
                  className="h-10 rounded-xl border border-gray-900 bg-white px-4 text-sm font-semibold text-gray-900 dark:border-primary/30 dark:bg-primary/10 dark:text-gray-100"
                  onClick={() => {
                    const n = Math.min(50, Math.max(1, parseInt(customDraft, 10) || 1));
                    onCountChange(n);
                    setCustomDraft(String(n));
                    close();
                  }}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}
      </MediaOptionMenu>

      <MediaOptionMenu
        icon={<FileText size={16} />}
        activeLabel={activeRatio}
        title={t("imageToolbar.ratio")}
        subtitle={t("imageToolbar.ratioDesc")}
        compactOnMobile
      >
        {(close) => (
          <div className="space-y-2">
            <div className="px-1 text-[11px] font-semibold text-gray-400">{t("imageToolbar.commonRatios")}</div>
            {COMMON_RATIOS.map((item) => (
              <MediaMenuOption
                key={item}
                selected={activeRatio === item}
                onClick={() => {
                  onRatioChange(item);
                  close();
                }}
              >
                {item} · {getImagePixelSize(item, activeTier)}
              </MediaMenuOption>
            ))}
            <div className="mt-2 border-t border-gray-100 px-1 pt-2 text-[11px] font-semibold text-gray-400 dark:border-white/10">{t("imageToolbar.allRatios")}</div>
            {completeRatios.map((item) => (
              <MediaMenuOption
                key={item}
                selected={activeRatio === item}
                onClick={() => {
                  onRatioChange(item);
                  close();
                }}
              >
                {item} · {getImagePixelSize(item, activeTier)}
              </MediaMenuOption>
            ))}
          </div>
        )}
      </MediaOptionMenu>

      <MediaOptionMenu
        icon={<Settings size={16} />}
        activeLabel={activeTier}
        title={t("imageToolbar.quality")}
        subtitle={t("imageToolbar.qualityDesc")}
        compactOnMobile
      >
        {(close) => (
          <div className="space-y-2">
            {IMAGE_SIZE_TIERS.map((tier) => (
              <MediaMenuOption
                key={tier}
                selected={activeTier === tier}
                onClick={() => {
                  onImageSizeChange(tier);
                  close();
                }}
              >
                {tier} · {getImagePixelSize(activeRatio, tier)}
              </MediaMenuOption>
            ))}
          </div>
        )}
      </MediaOptionMenu>
    </>
  );
}
