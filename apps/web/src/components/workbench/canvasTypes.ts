import type { Node, Edge, Viewport } from "@xyflow/react";
import type { FramePairShot, FramePairShotState } from "./framePairWorkflow";

export type CanvasNodeKind = "textInput" | "framePairInput" | "imageInput" | "generator" | "compositor" | "contentResult";
export type GeneratorKind = "text" | "image" | "video" | "audio";
export type StoryNarrationMode = "none" | "narration" | "first_person" | "third_person" | "character_dialogue" | "smart";
export type StorySubtitleMode = "auto" | "none";
export type StorySubtitleStyle = "clean" | "soft_box" | "bold";
export type StorySubtitleTiming = "speech" | "script";
export type StoryCreationType = "story" | "knowledge" | "product" | "brand" | "talking_head" | "custom";
export type StoryPlatform = "douyin" | "wechat_channels" | "xiaohongshu" | "tiktok" | "youtube";
export type StoryAspectRatio = "9:16" | "16:9" | "1:1";
export type StorySpeechItem = {
  segment_index: number;
  speaker_code: string;
  speaker_name: string;
  speech_type: "narration" | "dialogue" | "inner_monologue";
  text: string;
  voice_hint?: string;
};
export type NewNodeKind =
  | "text"
  | "textGenerator"
  | "imageGenerator"
  | "videoGenerator"
  | "audioGenerator"
  | "compositor";
export type CanvasNodeData = Record<string, unknown> & {
  label: string;
  prompt?: string;
  modelCode?: string;
  mediaKind?: GeneratorKind;
  mode?: string;
  assetUrl?: string;
  assetId?: string;
  assetUrls?: string[];
  assetIds?: string[];
  referenceImageUrls?: string[];
  referenceImageIds?: string[];
  referenceVideoUrls?: string[];
  referenceVideoIds?: string[];
  referenceAudioUrls?: string[];
  referenceAudioIds?: string[];
  firstFrameUrl?: string;
  firstFrameId?: string;
  firstFrameSourceNodeId?: string;
  lastFrameUrl?: string;
  lastFrameId?: string;
  lastFrameSourceNodeId?: string;
  framePairShots?: FramePairShot[];
  framePairTargetDuration?: number;
  framePairVideoSize?: string;
  framePairBatch?: boolean;
  framePairGroupID?: string;
  framePairRole?: "input" | "shot" | "final";
  framePairSegmentIndex?: number;
  framePairSegmentDuration?: number;
  framePairShotStates?: Record<string, FramePairShotState>;
  framePairTaskMap?: Record<string, string>;
  framePairOutputMap?: Record<string, string>;
  framePairShotSignatures?: Record<string, string>;
  framePairRerunShotID?: string;
  outputUrl?: string;
  outputUrls?: string[];
  outputText?: string;
  outputKind?: GeneratorKind;
  taskNo?: string;
  taskNos?: string[];
  attemptTaskNos?: string[];
  status?: "idle" | "pending" | "running" | "succeeded" | "failed" | "stale" | "blocked";
  progress?: number;
  progressStage?: string;
  error?: string;
  warning?: string;
  reuseWarning?: string;
  dirty?: boolean;
  lastRunSignature?: string;
  activeRunSignature?: string;
  count?: number;
  ratio?: string;
  quality?: string;
  duration?: string;
  seed?: number;
  negativePrompt?: string;
  params?: Record<string, unknown>;
  estimatedCost?: number;
  actualCost?: number;
  composeMode?: string;
  outputSize?: string;
  referenceImageLabel?: string;
  referenceVideoLabel?: string;
  referenceAudioLabel?: string;
  storyGroupID?: string;
  storyPipelineVersion?: number;
  storyRole?: "input" | "copy" | "script" | "storyboard" | "asset" | "keyframe" | "video" | "narrationText" | "narration" | "final";
  qualityStatus?: string;
  storyAssetCode?: string;
  storyAssetType?: string;
  storyAssetDefinition?: string;
  storySegmentIndex?: number;
  storySegmentCount?: number;
  storySegmentDuration?: number;
  storyDurationOptions?: number[];
  storyNarrationMode?: StoryNarrationMode;
  storySubtitleMode?: StorySubtitleMode;
  storySubtitleStyle?: StorySubtitleStyle;
  storySubtitleTiming?: StorySubtitleTiming;
  storyCreationType?: StoryCreationType;
  storyPlatform?: StoryPlatform;
  storyAspectRatio?: StoryAspectRatio;
  storyReviewRequired?: boolean;
  storyStoryboardApproved?: boolean;
  storyApproved?: boolean;
  storyScriptProvided?: boolean;
  storyGenerationStrategy?: "auto" | "shots";
  storyContinuityMode?: "parallel" | "video_tail";
  storyWholeVideo?: boolean;
  storyTargetDuration?: number;
  storyDurationPromptSeconds?: number;
  storyRetryError?: string;
  storyRetryDraft?: string;
  storyConstraintRepair?: boolean;
  storyTailFrameURL?: string;
  storyTailFrameSource?: string;
  storyAnalysisModelCode?: string;
  storyImageModelCode?: string;
  storyVideoModelCode?: string;
  storyAudioModelCode?: string;
  storyQualityModelCode?: string;
  storyQualityMode?: "advisory" | "strict";
  useAudioModel?: boolean;
  storySpeechPlan?: StorySpeechItem[];
  storyVoiceAssignments?: Record<string, string>;
  storyVoiceOverrides?: Record<string, string>;
  contentRole?: "source" | "publish_copy" | "page_copy" | "publish_image" | "result";
  contentSourceURL?: string;
  contentSourcePlatform?: string;
  contentSourceTitle?: string;
  contentSourceAuthor?: string;
  contentSourceText?: string;
  contentSourceTruncated?: boolean;
  contentIndex?: number;
  contentCopyNodeID?: string;
  contentImageNodeIDs?: string[];
  viralGroupID?: string;
  viralRole?: "brief" | "reference" | "brand" | "audio" | "analysis" | "keyframe" | "video" | "final";
  viralVariant?: "viral" | "video" | "one_click";
  viralSegmentIndex?: number;
  viralSegmentCount?: number;
  viralSegmentDuration?: number;
  viralDurationOptions?: number[];
  viralAnalysisModelCode?: string;
  viralImageModelCode?: string;
  viralVideoModelCode?: string;
  viralAudioModelCode?: string;
  referenceVideoDuration?: number;
  viralTimingMode?: "auto" | "manual" | "prompt";
  viralTargetDuration?: number;
  viralTimingSourceDuration?: number;
};
export type CanvasNode = Node<CanvasNodeData, CanvasNodeKind>;
export type CanvasEdge = Edge;

export type AgentCanvasRequest = { template_id: string; kind: string; prompt: string; params: Record<string, unknown> };

export type CanvasDocument = {
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
  submitted_at?: string;
  execution_mode?: "auto" | "step";
  execution_paused?: boolean;
  agent_request?: AgentCanvasRequest;
};

export type CanvasSummary = {
  public_id: string;
  workflow_code?: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type CanvasDetail = CanvasSummary & {
  document: CanvasDocument;
};

export type CanvasTemplate = {
  id: string;
  name: string;
  description?: string;
  template_id?: string;
  document?: CanvasDocument;
};

export type CanvasWorkflow = {
  display_config?: {
    canvas_templates?: CanvasTemplate[];
  };
  runtime_config?: {
    quality_model_code?: string;
    image_concurrency?: number;
    video_concurrency?: number;
    default_template_id?: string;
    default_segment_count?: number;
    default_segment_duration?: number;
    default_story_review_required?: boolean;
    default_story_use_audio_model?: boolean;
    default_story_subtitle_mode?: StorySubtitleMode;
    default_story_creation_type?: StoryCreationType;
    preset_code?: string;
    pipeline_version?: number;
    analysis_model_code?: string;
    generation_model_code?: string;
    image_model_code?: string;
    video_model_code?: string;
    audio_model_code?: string;
    default_count?: number;
  };
};

export type CanvasAsset = {
  public_id: string;
  url: string;
  name?: string;
  kind?: string;
  mime_type?: string;
  duration_seconds?: number;
};

export type CanvasResultPreview = {
  url: string;
  kind: Exclude<GeneratorKind, "text">;
  title: string;
};
