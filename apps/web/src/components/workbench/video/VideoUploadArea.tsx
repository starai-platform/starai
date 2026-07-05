"use client";

import { useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import type { VideoMediaItem, VideoMediaState, VideoRuntimeConfig } from "@starai/shared-types";
import { uploadAsset } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff";

function EmptyUploadBox({
  label,
  onUpload,
  uploading,
  tilt,
}: {
  label: string;
  onUpload: (files: FileList | null) => void;
  uploading?: boolean;
  tilt?: boolean;
}) {
  return (
    <label
      className={`relative w-20 h-16 rounded-2xl border border-dashed border-gray-200 bg-white shadow-sm flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition shrink-0 dark:border-white/10 dark:bg-white/5 dark:hover:bg-primary/10 ${
        tilt ? "max-lg:rotate-0 lg:rotate-[-8deg]" : ""
      }`}
    >
      <Plus size={18} className="text-gray-400 dark:text-gray-300" />
      <span className="text-[10px] text-gray-400 dark:text-gray-300 text-center leading-tight px-1">{label}</span>
      <input
        type="file"
        accept={ACCEPT}
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
}: {
  onUpload: (files: FileList | null) => void;
  uploading?: boolean;
  multiple?: boolean;
}) {
  return (
    <label className="w-9 h-9 rounded-full border border-dashed border-gray-200 bg-white text-gray-400 flex items-center justify-center cursor-pointer hover:border-primary/40 hover:text-primary transition shrink-0 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
      <Plus size={16} />
      <input
        type="file"
        accept={ACCEPT}
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
}: {
  image: VideoMediaItem;
  badge?: string;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="group/img relative w-16 h-16 rounded-2xl overflow-hidden border-2 border-white shadow-lg bg-gray-100 shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={image.name} className="w-full h-full object-cover" />
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

function ReferenceImageStack({
  images,
  max,
  uploading,
  onUpload,
  onRemove,
}: {
  images: VideoMediaItem[];
  max: number;
  uploading?: boolean;
  onUpload: (files: FileList | null) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  const canAdd = images.length < max;

  if (images.length === 0) {
    if (max <= 0) return null;
    return (
      <EmptyUploadBox label={`${t("video.referenceImage")} 0/${max}`} uploading={uploading} tilt onUpload={onUpload} />
    );
  }

  return (
    <div className="scroll-x-only flex flex-nowrap items-center gap-2 w-full h-16 shrink-0">
      {images.map((img, i) => (
        <FilledImageCard key={img.url} image={img} onRemove={() => onRemove(i)} />
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
}: {
  config: VideoRuntimeConfig;
  media: VideoMediaState;
  onChange: (next: VideoMediaState) => void;
}) {
  const { t } = useI18n();
  const [uploading, setUploading] = useState(false);
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
