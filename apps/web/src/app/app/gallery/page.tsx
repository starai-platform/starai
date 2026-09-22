"use client";

import { useRouter } from "next/navigation";
import { GalleryPanel } from "@/components/workbench/GalleryPanel";

export default function GalleryPage() {
  const router = useRouter();
  return (
    <GalleryPanel
      activeTag="all"
      onUseTemplate={(modelCode, prompt) => {
        const target = modelCode ? `/app/models/${modelCode}` : "/app";
        router.push(`${target}?prompt=${encodeURIComponent(prompt)}`);
      }}
    />
  );
}
