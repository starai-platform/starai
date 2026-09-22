type VideoAnalysisModel = {
  code: string;
  display_name?: string;
  tags?: string[];
  runtime_rule?: Record<string, unknown>;
};

export function supportsVideoAnalysis(model?: VideoAnalysisModel) {
  return supportsMediaAnalysis(model, "video");
}

export type AnalysisMediaKind = "image" | "video" | "audio";

export function supportsMediaAnalysis(model: VideoAnalysisModel | undefined, kind: AnalysisMediaKind) {
  if (!model) return false;
  const capabilities = (model.runtime_rule?.capabilities || {}) as Record<string, unknown>;
  // Match the admin checkboxes and API media validation: canonical switches win,
  // including false; legacy aliases only apply when the switch is absent.
  const keys = kind === "image"
    ? ["vision", "image_input", "multimodal"]
    : [`${kind}_analysis`, `${kind}_input`, `${kind}_understanding`];
  for (const key of keys) {
    if (typeof capabilities[key] === "boolean") return capabilities[key] === true;
  }
  return false;
}

export function canvasAnalysisMediaKinds(nodes: { data: Record<string, unknown> }[]): AnalysisMediaKind[] {
  return (["image", "video", "audio"] as const).filter(kind => nodes.some(({ data }) => {
    const refs = data[{ image: "referenceImageUrls", video: "referenceVideoUrls", audio: "referenceAudioUrls" }[kind]];
    return (Array.isArray(refs) && refs.some(Boolean))
      || (data.mediaKind === kind && (Boolean(data.assetUrl) || Array.isArray(data.assetUrls) && data.assetUrls.some(Boolean)))
      || (data.outputKind === kind && Boolean(data.outputUrl));
  }));
}
