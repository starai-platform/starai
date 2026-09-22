"use client";

import { useState } from "react";
import { ArrowRight, Film, Music2, Plus, UserRound, X } from "lucide-react";
import type { VideoMediaItem, VideoMediaState, VideoRuntimeConfig } from "@starai/shared-types";
import { uploadAsset } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff";
const VIDEO_ACCEPT = "video/mp4,video/quicktime";
const AUDIO_ACCEPT = "audio/mpeg,audio/wav,audio/x-wav";

function readMediaDuration(file: File, kind: "video" | "audio"): Promise<number | undefined> {
  return new Promise((resolve) => {
    const element = document.createElement(kind);
    const objectURL = URL.createObjectURL(file);
    const finish = (value?: number) => {
      URL.revokeObjectURL(objectURL);
      resolve(value && Number.isFinite(value) && value > 0 ? value : undefined);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () => finish(element.duration);
    element.onerror = () => finish();
    element.src = objectURL;
  });
}

function EmptyUploadBox({
  label,
  onUpload,
  uploading,
  tilt,
  compact,
  accept = IMAGE_ACCEPT,
}: {
  label: string;
  onUpload: (files: FileList | null) => void;
  uploading?: boolean;
  tilt?: boolean;
  compact?: boolean;
  accept?: string;
}) {
  return (
    <label
      className={`relative flex shrink-0 cursor-pointer flex-col items-center justify-center border border-dashed border-gray-200 bg-white shadow-sm transition hover:border-primary/40 hover:bg-primary/5 dark:border-white/10 dark:bg-white/5 dark:hover:bg-primary/10 ${
        compact ? "h-14 w-16 gap-0.5 rounded-xl" : "h-16 w-20 gap-1 rounded-2xl"
      } ${
        tilt ? "max-lg:rotate-0 lg:rotate-[-8deg]" : ""
      }`}
    >
      <Plus size={18} className="text-gray-400 dark:text-gray-300" />
      <span className="text-[10px] text-gray-400 dark:text-gray-300 text-center leading-tight px-1">{label}</span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          onUpload(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function AddMoreButton({
  onUpload,
  uploading,
  multiple,
  accept = IMAGE_ACCEPT,
}: {
  onUpload: (files: FileList | null) => void;
  uploading?: boolean;
  multiple?: boolean;
  accept?: string;
}) {
  return (
    <label className="w-9 h-9 rounded-full border border-dashed border-gray-200 bg-white text-gray-400 flex items-center justify-center cursor-pointer hover:border-primary/40 hover:text-primary transition shrink-0 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
      <Plus size={16} />
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          onUpload(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function FilledImageCard({
  image,
  badge,
  onRemove,
  compact,
}: {
  image: VideoMediaItem;
  badge?: string;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={`group/img relative shrink-0 overflow-hidden border-2 border-white bg-gray-100 shadow-lg ${compact ? "h-14 w-14 rounded-xl" : "h-16 w-16 rounded-2xl"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={image.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
      {badge ? (
        <span className="pointer-events-none absolute left-1 top-1 px-1.5 py-0.5 rounded-md bg-black/55 text-white text-[10px]">
          {badge}
        </span>
      ) : null}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition"
          title={t("common.remove")}
        >
          <X size={12} />
        </button>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 px-1.5 py-1 text-[10px] text-white opacity-0 group-hover/img:opacity-100 transition whitespace-nowrap truncate">
        {image.name}
      </div>
    </div>
  );
}

function FilledFileCard({
  item,
  kind,
  onRemove,
}: {
  item: VideoMediaItem;
  kind: "video" | "audio";
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const Icon = kind === "video" ? Film : Music2;
  return (
    <div className="group/file relative flex h-14 w-[4.5rem] shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl border border-gray-200 bg-white px-1.5 shadow-sm dark:border-white/10 dark:bg-white/5">
      <Icon size={18} className="text-primary" />
      <span className="w-full truncate text-center text-[10px] text-gray-500 dark:text-gray-300">{item.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover/file:opacity-100"
        title={t("common.remove")}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function ReferenceImageStack({
  images,
  max,
  uploading,
  onUpload,
  onRemove,
  compact,
}: {
  images: VideoMediaItem[];
  max: number;
  uploading?: boolean;
  onUpload: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const canAdd = images.length < max;

  if (images.length === 0) {
    if (max <= 0) return null;
    return (
      <EmptyUploadBox label={`${t("video.referenceImage")} 0/${max}`} uploading={uploading} tilt={!compact} compact={compact} onUpload={onUpload} />
    );
  }

  return (
    <div className={compact ? "flex min-h-14 max-w-full flex-wrap items-center gap-1.5" : "scroll-x-only flex h-16 w-full shrink-0 flex-nowrap items-center gap-2"}>
      {images.map((img, i) => (
        <FilledImageCard key={img.url} image={img} compact={compact} onRemove={() => onRemove(i)} />
      ))}
      {canAdd && <AddMoreButton uploading={uploading} multiple onUpload={onUpload} />}
    </div>
  );
}

function FrameSlot({
  label,
  image,
  uploading,
  onUpload,
  onRemove,
}: {
  label: string;
  image: VideoMediaItem | null;
  uploading?: boolean;
  onUpload: (files: FileList | null) => void;
  onRemove?: () => void;
}) {
  if (image) {
    return <FilledImageCard image={image} badge={label} onRemove={onRemove} />;
  }
  return <EmptyUploadBox label={label} uploading={uploading} onUpload={onUpload} />;
}

export function VideoUploadArea({
  config,
  media,
  onChange,
  mode,
  portraitAssetId,
  portraitAssetType,
  onPortraitAssetIdChange,
  onPortraitAssetTypeChange,
  draftTaskId,
  onDraftTaskIdChange,
}: {
  config: VideoRuntimeConfig;
  media: VideoMediaState;
  onChange: (next: VideoMediaState) => void;
  mode?: string;
  portraitAssetId?: string;
  portraitAssetType?: "image" | "video";
  onPortraitAssetIdChange?: (value: string) => void;
  onPortraitAssetTypeChange?: (value: "image" | "video") => void;
  draftTaskId?: string;
  onDraftTaskIdChange?: (value: string) => void;
}) {
  const { t } = useI18n();
  const [uploading, setUploading] = useState(false);
  const [portraitEditing, setPortraitEditing] = useState(false);
  const profile = config.upload_profile || "single_ref";

  const uploadOne = async (files: FileList | null, apply: (item: VideoMediaItem) => void) => {
    const f = files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const asset = await uploadAsset(f, { name: f.name, kind: "image", asset_type: "prop" });
      apply({ url: asset.url, name: asset.name || f.name, public_id: asset.public_id });
    } catch (err) {
      alert(err instanceof Error ? err.message : t("asset.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const uploadFiles = async (
    files: FileList | null,
    kind: "video" | "audio",
    current: VideoMediaItem[],
    max: number,
    apply: (items: VideoMediaItem[]) => void
  ) => {
    if (!files?.length) return;
    const room = max - current.length;
    if (room <= 0) return;
    setUploading(true);
    try {
      const next: VideoMediaItem[] = [];
      for (const f of Array.from(files).slice(0, room)) {
        const durationSeconds = await readMediaDuration(f, kind);
        const asset = await uploadAsset(f, { name: f.name, kind, asset_type: "prop" });
        next.push({
          url: asset.url,
          name: asset.name || f.name,
          public_id: asset.public_id,
          duration_seconds: durationSeconds,
        });
      }
      apply([...current, ...next]);
    } catch (err) {
      alert(err instanceof Error ? err.message : t("asset.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const uploadMany = async (files: FileList | null, max: number) => {
    if (!files?.length) return;
    const room = max - media.reference_images.length;
    if (room <= 0) {
      alert(t("video.maxReferenceImages", { max }));
      return;
    }
    setUploading(true);
    try {
      const next: VideoMediaItem[] = [];
      for (const f of Array.from(files).slice(0, room)) {
        const asset = await uploadAsset(f, { name: f.name, kind: "image", asset_type: "prop" });
        next.push({ url: asset.url, name: asset.name || f.name, public_id: asset.public_id });
      }
      onChange({ ...media, reference_images: [...media.reference_images, ...next] });
    } catch (err) {
      alert(err instanceof Error ? err.message : t("asset.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const refMax = () => {
    if (profile === "frame_pair") return config.reference_images?.max ?? 4;
    return config.max_reference_images ?? 1;
  };

  const removeRef = (index: number) => {
    onChange({ ...media, reference_images: media.reference_images.filter((_, idx) => idx !== index) });
  };

  if (profile === "veo_reference" || profile === "omni_reference") {
    const activeMode = mode || "text";
    if (activeMode === "text") return null;
    const profileLimit = profile === "omni_reference" ? 7 : 3;
    const max = Math.min(profileLimit, config.reference_images?.max ?? config.max_reference_images ?? profileLimit);
    return (
      <ReferenceImageStack
        images={media.reference_images}
        max={max}
        uploading={uploading}
        onUpload={(files) => uploadMany(files, max)}
        onRemove={removeRef}
        compact
      />
    );
  }

  if (profile === "minimax_h3" || profile === "aliyun_multimodal" || profile.startsWith("aliyun_happyhorse_")) {
    const profileMode = profile === "aliyun_happyhorse_first_frame" ? "first_frame" : profile === "aliyun_happyhorse_reference" || profile === "aliyun_happyhorse_edit" ? "reference" : "text";
    const activeMode = mode || profileMode;
    if (activeMode === "text") return null;
    if (activeMode === "first_frame" || activeMode === "last_frame" || activeMode === "first_last") {
      const showFirst = activeMode === "first_frame" || activeMode === "first_last";
      const showLast = activeMode === "last_frame" || activeMode === "first_last";
      return (
        <div className="flex min-h-16 w-fit max-w-full flex-nowrap items-center gap-2">
          {showFirst && (
            <FrameSlot
              label={t("video.firstFrame")}
              image={media.first_frame}
              uploading={uploading}
              onUpload={(files) => uploadOne(files, (item) => onChange({ ...media, first_frame: item }))}
              onRemove={() => onChange({ ...media, first_frame: null })}
            />
          )}
          {showFirst && showLast && <ArrowRight size={15} className="shrink-0 text-gray-300" />}
          {showLast && (
            <FrameSlot
              label={t("video.lastFrame")}
              image={media.last_frame}
              uploading={uploading}
              onUpload={(files) => uploadOne(files, (item) => onChange({ ...media, last_frame: item }))}
              onRemove={() => onChange({ ...media, last_frame: null })}
            />
          )}
        </div>
      );
    }
    if (profile === "aliyun_happyhorse_reference") {
      return (
        <ReferenceImageStack
          images={media.reference_images}
          max={config.reference_images?.max ?? 9}
          uploading={uploading}
          onUpload={(files) => uploadMany(files, config.reference_images?.max ?? 9)}
          onRemove={removeRef}
          compact
        />
      );
    }
    return (
      <div className="flex min-h-14 w-fit max-w-full flex-wrap items-center gap-1.5">
        <ReferenceImageStack
          images={media.reference_images}
          max={config.reference_images?.max ?? 9}
          uploading={uploading}
          onUpload={(files) => uploadMany(files, config.reference_images?.max ?? 9)}
          onRemove={removeRef}
          compact
        />
        <ArrowRight size={13} className="shrink-0 text-gray-300" />
        <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-1.5">
          {media.reference_videos.map((item, index) => (
            <FilledFileCard
              key={item.url}
              item={item}
              kind="video"
              onRemove={() => onChange({ ...media, reference_videos: media.reference_videos.filter((_, i) => i !== index) })}
            />
          ))}
          {media.reference_videos.length < (config.reference_videos?.max ?? 3) && (
            <EmptyUploadBox
              label={`${t("video.referenceVideo")} ${media.reference_videos.length}/${config.reference_videos?.max ?? 3}`}
              compact
              accept={VIDEO_ACCEPT}
              uploading={uploading}
              onUpload={(files) =>
                uploadFiles(files, "video", media.reference_videos, config.reference_videos?.max ?? 3, (items) =>
                  onChange({ ...media, reference_videos: items })
                )
              }
            />
          )}
        </div>
        {profile !== "aliyun_happyhorse_edit" && <ArrowRight size={13} className="shrink-0 text-gray-300" />}
        {profile !== "aliyun_happyhorse_edit" && <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-1.5">
          {media.reference_audios.map((item, index) => (
            <FilledFileCard
              key={item.url}
              item={item}
              kind="audio"
              onRemove={() => onChange({ ...media, reference_audios: media.reference_audios.filter((_, i) => i !== index) })}
            />
          ))}
          {media.reference_audios.length < (config.reference_audios?.max ?? 3) && (
            <EmptyUploadBox
              label={`${t("video.referenceAudio")} ${media.reference_audios.length}/${config.reference_audios?.max ?? 3}`}
              compact
              accept={AUDIO_ACCEPT}
              uploading={uploading}
              onUpload={(files) =>
                uploadFiles(files, "audio", media.reference_audios, config.reference_audios?.max ?? 3, (items) =>
                  onChange({ ...media, reference_audios: items })
                )
              }
            />
          )}
        </div>}
      </div>
    );
  }

  if (profile === "seedance_2") {
    const activeMode = mode || "text";
    const imageModes = new Set(["image", "image_audio", "image_video", "image_video_audio"]);
    const videoModes = new Set(["video", "video_audio", "image_video", "image_video_audio"]);
    const audioModes = new Set(["image_audio", "video_audio", "image_video_audio"]);
    const showImages = imageModes.has(activeMode);
    const showVideos = videoModes.has(activeMode);
    const showAudios = audioModes.has(activeMode);
    const showPortrait = showImages || showVideos;
    if (activeMode === "text") return null;
    if (activeMode === "draft_task") {
      return (
        <div className="flex min-h-16 w-full items-center">
          <div className="flex h-16 w-full min-w-56 items-center gap-2 rounded-2xl border border-dashed border-violet-300 bg-violet-50/70 px-3 dark:border-violet-400/30 dark:bg-violet-400/10">
            <Film size={18} className="shrink-0 text-violet-500" />
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[10px] font-medium text-violet-600 dark:text-violet-300">{t("video.draftTask")}</div>
              <input
                value={draftTaskId || ""}
                onChange={(e) => onDraftTaskIdChange?.(e.target.value)}
                placeholder="cgt-..."
                className="h-7 w-full rounded-lg border border-violet-200 bg-white px-2 text-xs outline-none focus:border-violet-400 dark:border-white/10 dark:bg-white/5"
              />
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-14 w-fit max-w-full flex-wrap items-center gap-1.5">
        {showPortrait && (
          <div className="shrink-0">
            {portraitEditing || portraitAssetId ? (
              <div className="flex h-14 w-44 items-center gap-1.5 rounded-xl border border-dashed border-cyan-300 bg-cyan-50/70 px-2 dark:border-cyan-400/30 dark:bg-cyan-400/10">
                <UserRound size={16} className="shrink-0 text-cyan-600" />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-1">
                    <select
                      value={portraitAssetType || "image"}
                      onChange={(e) => onPortraitAssetTypeChange?.(e.target.value as "image" | "video")}
                      className="h-5 rounded border border-cyan-200 bg-white px-1 text-[10px] outline-none dark:border-white/10 dark:bg-gray-900"
                    >
                      <option value="image">{t("video.portraitImage")}</option>
                      <option value="video">{t("video.portraitVideo")}</option>
                    </select>
                    <button
                      type="button"
                      className="ml-auto text-[10px] text-gray-400 hover:text-red-500"
                      onClick={() => {
                        onPortraitAssetIdChange?.("");
                        setPortraitEditing(false);
                      }}
                    >
                      {t("common.clear")}
                    </button>
                  </div>
                  <input
                    autoFocus={portraitEditing && !portraitAssetId}
                    value={portraitAssetId || ""}
                    onChange={(e) => onPortraitAssetIdChange?.(e.target.value)}
                    placeholder="asset://ASSET_ID"
                    className="h-7 w-full rounded-lg border border-cyan-200 bg-white px-2 text-xs outline-none focus:border-cyan-400 dark:border-white/10 dark:bg-white/5"
                    title={t("video.portraitAssetHint")}
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPortraitEditing(true)}
                title={t("video.portraitAssetHint")}
                className="flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-cyan-300 bg-cyan-50/60 text-cyan-700 transition hover:bg-cyan-50 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-300"
              >
                <Plus size={17} />
                <span className="text-[10px]">{t("video.portraitAsset")}</span>
              </button>
            )}
          </div>
        )}
        {showPortrait && <ArrowRight size={13} className="shrink-0 text-gray-300" />}
        {showImages && (
          <ReferenceImageStack
            images={media.reference_images}
            max={config.reference_images?.max ?? 9}
            uploading={uploading}
            onUpload={(files) => uploadMany(files, config.reference_images?.max ?? 9)}
            onRemove={removeRef}
            compact
          />
        )}
        {showImages && (showVideos || showAudios) && <ArrowRight size={13} className="shrink-0 text-gray-300" />}
        {showVideos && (
          <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-1.5">
            {media.reference_videos.map((item, index) => (
              <FilledFileCard
                key={item.url}
                item={item}
                kind="video"
                onRemove={() => onChange({ ...media, reference_videos: media.reference_videos.filter((_, i) => i !== index) })}
              />
            ))}
            {media.reference_videos.length < (config.reference_videos?.max ?? 3) && (
              <EmptyUploadBox
                label={`${t("video.referenceVideo")} ${media.reference_videos.length}/${config.reference_videos?.max ?? 3}`}
                compact
                accept={VIDEO_ACCEPT}
                uploading={uploading}
                onUpload={(files) =>
                  uploadFiles(files, "video", media.reference_videos, config.reference_videos?.max ?? 3, (items) =>
                    onChange({ ...media, reference_videos: items })
                  )
                }
              />
            )}
          </div>
        )}
        {showVideos && showAudios && <ArrowRight size={13} className="shrink-0 text-gray-300" />}
        {showAudios && (
          <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-1.5">
            {media.reference_audios.map((item, index) => (
              <FilledFileCard
                key={item.url}
                item={item}
                kind="audio"
                onRemove={() => onChange({ ...media, reference_audios: media.reference_audios.filter((_, i) => i !== index) })}
              />
            ))}
            {media.reference_audios.length < (config.reference_audios?.max ?? 3) && (
              <EmptyUploadBox
                label={`${t("video.referenceAudio")} ${media.reference_audios.length}/${config.reference_audios?.max ?? 3}`}
                compact
                accept={AUDIO_ACCEPT}
                uploading={uploading}
                onUpload={(files) =>
                  uploadFiles(files, "audio", media.reference_audios, config.reference_audios?.max ?? 3, (items) =>
                    onChange({ ...media, reference_audios: items })
                  )
                }
              />
            )}
          </div>
        )}
      </div>
    );
  }

  if (profile === "veo_frame_pair") {
    return (
      <div className="scroll-x-only flex h-16 w-full flex-nowrap items-center gap-2">
        <FrameSlot
          label={t("video.firstFrame")}
          image={media.first_frame}
          uploading={uploading}
          onUpload={(files) => uploadOne(files, (item) => onChange({ ...media, first_frame: item }))}
          onRemove={() => onChange({ ...media, first_frame: null })}
        />
        <div className="flex h-16 items-center self-center text-gray-300">
          <ArrowRight size={16} />
        </div>
        <FrameSlot
          label={t("video.lastFrame")}
          image={media.last_frame}
          uploading={uploading}
          onUpload={(files) => uploadOne(files, (item) => onChange({ ...media, last_frame: item }))}
          onRemove={() => onChange({ ...media, last_frame: null })}
        />
      </div>
    );
  }

  if (profile === "frame_pair") {
    const firstLabel = t("video.firstFrame");
    const lastLabel = t("video.lastFrame");
    const max = refMax();
    return (
      <div className="scroll-x-only flex flex-nowrap items-center gap-2 w-full h-16">
        <FrameSlot
          label={firstLabel}
          image={media.first_frame}
          uploading={uploading}
          onUpload={(files) => uploadOne(files, (item) => onChange({ ...media, first_frame: item }))}
          onRemove={() => onChange({ ...media, first_frame: null })}
        />
        <div className="flex items-center self-center text-gray-300 h-16">
          <ArrowRight size={16} />
        </div>
        <FrameSlot
          label={lastLabel}
          image={media.last_frame}
          uploading={uploading}
          onUpload={(files) => uploadOne(files, (item) => onChange({ ...media, last_frame: item }))}
          onRemove={() => onChange({ ...media, last_frame: null })}
        />
        {max > 0 && (
          <ReferenceImageStack
            images={media.reference_images}
            max={max}
            uploading={uploading}
            onUpload={(files) => uploadMany(files, max)}
            onRemove={removeRef}
          />
        )}
      </div>
    );
  }

  if (profile === "multi_ref") {
    const max = config.max_reference_images ?? 9;
    return (
      <ReferenceImageStack
        images={media.reference_images}
        max={max}
        uploading={uploading}
        onUpload={(files) => uploadMany(files, max)}
        onRemove={removeRef}
      />
    );
  }

  const max = config.max_reference_images ?? 1;
  if (max <= 0) return null;

  return (
    <ReferenceImageStack
      images={media.reference_images}
      max={max}
      uploading={uploading}
      onUpload={(files) => {
        if (max === 1 && media.reference_images.length === 0) {
          uploadOne(files, (item) => onChange({ ...media, reference_images: [item] }));
        } else {
          uploadMany(files, max);
        }
      }}
      onRemove={removeRef}
    />
  );
}
