import assert from "node:assert/strict";
import test from "node:test";
import { viralShotContext, stampViralSource } from "./videoCreationWorkflow.ts";
import { storyUserContext, STORY_CHARACTER_INSTRUCTION, storyLocksSpeech } from "./videoCreationWorkflow.ts";

test("story requirements survive sliced shots and fictional defaults respect explicit identities", () => {
  const node = role => ({ data: { storyRole: role } });
  const incoming = [
    { data: { storyRole: "input", prompt: "原创虚构女主播，蓝色衣服" } },
    { data: { storyRole: "storyboard", prompt: "用中景，不使用面部特写" } },
  ];
  for (const role of ["asset", "keyframe", "video"]) {
    const context = storyUserContext(node(role), incoming);
    assert.ok(context.includes(incoming[0].data.prompt));
    assert.ok(context.includes(incoming[1].data.prompt));
    assert.ok(context.includes(STORY_CHARACTER_INSTRUCTION));
  }
  incoming[0].data.prompt = "这是真实演员的照片，保留真实身份";
  assert.ok(storyUserContext(node("video"), incoming).includes(incoming[0].data.prompt));
  assert.match(STORY_CHARACTER_INSTRUCTION, /不得自动宣称为虚构人物/);
  assert.equal(storyUserContext(node(undefined), incoming), "");
  assert.equal(storyUserContext(node("narration"), incoming), "");
  assert.equal(canvasManagedRetryableTask({ status: "failed", error_code: "MODEL_PROVIDER_ERROR", error_message: "线路错误：图片中可能包含人物肖像，请修改图片内容后重试" }), false);
});

import { canvasStrictQuality, storyReviewBlock, storyReviewBlockForMode, storyWholeGeneration, storyVideoSamples, storyTimingInstruction, storyShotDurations, storyPromptTargetDuration, storyVideoMode, storyV2VideoFrameLimit, syncStoryAssetNodes, storyAssetPlan, storyAssets, storyShotAssets, storySubtitleCues, canvasEnhanceTarget, canvasNodeConfiguration, pauseCanvasAfterStep, canvasTemplateEnabled, changedStoryboardIndexes, configureVideoAudio, storyStoryboardSegments, canvasJSONValue, viralStoryboardSegments, canvasManagedRetryableTask } from "./videoCreationWorkflow.ts";

const shot = (index) => ({
  segment_index: index,
  scene: `scene ${index}`,
  camera: "medium shot",
  image_prompt: `image ${index}`,
  video_prompt: `video ${index}`,
});

test("accepts a fenced, continuously numbered storyboard", () => {
  const result = storyStoryboardSegments(`\`\`\`json\n${JSON.stringify([shot(1), shot(2)])}\n\`\`\``, 2);
  assert.equal(result.length, 2);
});

test("reads only an explicit final duration from the creative brief", () => {
  assert.equal(storyPromptTargetDuration("生成一段8秒的视频"), 8);
  assert.equal(storyPromptTargetDuration("成片总时长 1.5 分钟，由3段各8秒素材剪辑"), 90);
  assert.equal(storyPromptTargetDuration("由3段各8秒素材组成"), 0);
  assert.equal(storyPromptTargetDuration("视频时长700秒"), 0);
  assert.equal(storyPromptTargetDuration("请生成一段15秒的美国虚构美女TK财经博主讲解nvidia股票的口播短视频"), 15);
  assert.equal(storyPromptTargetDuration("制作一条二十五秒的财经视频"), 25);
  assert.equal(storyPromptTargetDuration("Generate a 20 second video"), 20);
  assert.equal(storyPromptTargetDuration("生成30-50秒的视频"), 0);
  assert.equal(storyPromptTargetDuration("生成30秒到50秒的视频"), 0);
  assert.equal(storyPromptTargetDuration("Make a 15-second video"), 15);
  assert.equal(storyPromptTargetDuration("成片时长30至50秒"), 0);
  assert.equal(storyPromptTargetDuration("生成15秒的视频，成片总时长20秒"), 0);
  assert.equal(storyPromptTargetDuration("生成15秒的视频，成片总时长15秒，模型单段8秒"), 15);
});

test("only an explicit verbatim requirement or supplied final script locks speech", () => {
  const board = { data: { storyRole: "storyboard", prompt: "生成分镜" } };
  for (const prompt of ["逐字保留台词", "原文不变", "禁止删改字数", "对白必须完整保留", "不增删台词"]) {
    assert.equal(storyLocksSpeech(board, [{ data: { storyRole: "input", prompt } }]), true, prompt);
  }
  for (const prompt of ["请精简台词", "不必逐字保留", "生成15秒的视频"]) {
    assert.equal(storyLocksSpeech(board, [{ data: { storyRole: "input", prompt } }]), false, prompt);
  }
});

test("accepts a storyboard wrapped in a segments object", () => {
  assert.equal(storyStoryboardSegments(JSON.stringify({ segments: [shot(1)] }), 1).length, 1);
});

test("builds timed subtitle cues from storyboard captions", () => {
  const cues = storySubtitleCues([
    { ...shot(1), duration_seconds: 8, caption: "English line", caption_secondary: "中文字幕" },
    { ...shot(2), duration_seconds: 8, caption: "  ", dialogue: "Fallback speech" },
    { ...shot(3), duration_seconds: 8, captions: ["Final", "收尾"] },
  ], 20);
  assert.deepEqual(cues, [
    { start_sec: 0, end_sec: 8, text: "English line", secondary_text: "中文字幕" },
    { start_sec: 8, end_sec: 16, text: "Fallback speech" },
    { start_sec: 16, end_sec: 20, text: "Final", secondary_text: "收尾" },
  ]);
});

test("subtitle cues follow the declared speech window", () => {
  assert.deepEqual(storySubtitleCues([{
    duration_seconds: 10,
    caption: "Spoken line",
    speeches: [{ text: "Spoken line", start_sec: 0.4, end_sec: 9.1 }],
  }]), [{ start_sec: 0.4, end_sec: 9.1, text: "Spoken line", speech_start_sec: 0.4, speech_end_sec: 9.1 }]);
});

test("long bilingual subtitles follow speech in safe phrase-sized cues", () => {
  const cues = storySubtitleCues([{
    duration_seconds: 10,
    caption: "If you are watching NVIDIA stock right now, AI demand is reshaping how the technology market moves.",
    caption_secondary: "如果你正在关注英伟达股票，人工智能需求正在重塑科技市场走势。",
    speeches: [{ text: "spoken", start_sec: 1, end_sec: 9, caption_segments: [
      { text: "If you are watching NVIDIA stock right now,", secondary_text: "如果你正在关注英伟达股票，" },
      { text: "AI demand is reshaping", secondary_text: "人工智能需求正在重塑" },
      { text: "how the technology market moves.", secondary_text: "科技市场走势。" },
    ] }],
  }]);
  assert.ok(cues.length > 1);
  assert.equal(cues[0].start_sec, 1);
  assert.equal(cues.at(-1).end_sec, 9);
  assert.ok(cues.every((cue, index) => index === 0 || cue.start_sec === cues[index - 1].end_sec));
  assert.ok(cues.every(cue => cue.text.split("\n").every(line => Array.from(line).length <= 45)));
  assert.equal(cues[1].secondary_text, "人工智能需求正在重塑");
});

test("legacy bilingual captions retain complete translations and malformed pairs fall back", () => {
  const speech = { text: "Complete English sentence.", caption: "Complete English sentence.", caption_secondary: "完整句子，不猜译文对齐。", start_sec: 0, end_sec: 5, caption_segments: [{ text: "Missing text", secondary_text: "错误" }] };
  const cues = storySubtitleCues([{ duration_seconds: 5, speeches: [speech] }]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].secondary_text, speech.caption_secondary);
  assert.equal(cues[0].text, speech.caption);
});

test("Chinese phrase splitting never cuts a segmented word", () => {
  const text = "市场变化正在持续改变公司的竞争位置和未来增长空间";
  const cues = storySubtitleCues([{ duration_seconds: 8, speeches: [{ text, start_sec: 0, end_sec: 7 }] }]);
  assert.equal(cues.map(c => c.text).join(""), text);
  assert.ok(cues.every(c => !c.text.endsWith("竞") && !c.text.startsWith("争")));
});

test("accepts the saved Agent storyboard shape and a 7-second cut from an 8-second clip", () => {
  const generated = { ...shot(1), duration_seconds: 7,
    scene: { code: "SCENE_OFFICE", type: "location", name: "现代简约办公室", visual_prompt: "明亮整洁的办公桌" },
    camera: { type: "sequence", description: "手机特写拉远至人物面部" },
  };
  const raw = JSON.stringify([generated]);
  const [parsed] = storyStoryboardSegments(raw, 1, 8, 7);
  assert.equal(parsed.scene, "现代简约办公室；明亮整洁的办公桌");
  assert.equal(parsed.camera, "手机特写拉远至人物面部");
  assert.equal(parsed.duration_seconds, 7);
  assert.equal(storyStoryboardSegments(JSON.stringify([{ ...generated, duration_seconds: 8 }]), 1, 8, 7).length, 1);
  assert.deepEqual(storyStoryboardSegments(raw, 1, 8), []);
  assert.deepEqual(storyStoryboardSegments(raw, 1, 8, 6), []);
  assert.deepEqual(storyStoryboardSegments(JSON.stringify([{ ...generated, scene: { code: "OFFICE" } }]), 1, 8, 7), []);
  assert.deepEqual(storyStoryboardSegments(JSON.stringify([generated, null]), 1, 8, 7), []);
  const pair = [ { ...shot(1), duration_seconds: 8 }, { ...shot(2), duration_seconds: 7 } ];
  assert.equal(storyStoryboardSegments(JSON.stringify(pair), 2, 8, 15).length, 2);
  assert.deepEqual(storyStoryboardSegments(JSON.stringify(pair.toReversed()), 2, 8, 15), []);
  assert.deepEqual(storyStoryboardSegments(JSON.stringify(pair.map(s => ({ ...s, duration_seconds: 7 }))), 2, 8, 15), []);
  assert.match(storyTimingInstruction(1, 8, 7), /成片总时长 7 秒.*每段 8 秒生成/);
  assert.match(storyTimingInstruction(1, 8, 7), /85%-95%.*start_sec.*end_sec/);
  assert.deepEqual(storyShotDurations(2, 10, 18), [10, 8]);
  assert.match(storyTimingInstruction(2, 10, 18), /末段.*裁掉.*第1镜实际保留10秒.*第2镜实际保留8秒/);
});

test("rejects wrong counts, numbering, and missing generation prompts", () => {
  assert.deepEqual(storyStoryboardSegments(JSON.stringify([shot(1)]), 2), []);
  assert.deepEqual(storyStoryboardSegments(JSON.stringify([shot(2)]), 1), []);
  assert.deepEqual(storyStoryboardSegments(JSON.stringify([{ ...shot(1), image_prompt: "" }]), 1), []);
});

test("separate voiceover disables only declared native-audio switches", () => {
  const original = { audio: true, generate_audio: true, resolution: "720p" };
  assert.deepEqual(configureVideoAudio(original, true), { audio: false, generate_audio: false, resolution: "720p" });
  assert.equal(original.audio, true);
  assert.deepEqual(configureVideoAudio(configureVideoAudio(original, true), false), original);
  assert.deepEqual(configureVideoAudio({ resolution: "720p", audio: { voice: "A" } }, false), { resolution: "720p", audio: { voice: "A" } });
});

test("detects only storyboard segments whose structured content changed", () => {
  const before = JSON.stringify([shot(1), shot(2), shot(3)]);
  const after = JSON.stringify([shot(1), { ...shot(2), camera: "close-up" }, shot(3)]);
  assert.deepEqual(changedStoryboardIndexes(before, after, 3), [2]);
  assert.deepEqual(changedStoryboardIndexes("invalid", after, 3), [1, 2, 3]);
  assert.deepEqual(changedStoryboardIndexes(before, "invalid", 3), []);
});

test("hides managed canvas workflows that are disabled", () => {
  const enabled = new Set(["video_creation", "video_creation_v2", "content_image_post", "one_click_viral_remake"]);
  assert.equal(canvasTemplateEnabled("story-short-video", enabled), true);
  assert.equal(canvasTemplateEnabled("story-short-video-v2", enabled), true);
  assert.equal(canvasTemplateEnabled("one-click-viral-remake", enabled), true);
  assert.equal(canvasTemplateEnabled("viral-remake", enabled), false);
  assert.equal(canvasTemplateEnabled("video-remake", enabled), false);
  assert.equal(canvasTemplateEnabled("text-image", enabled), true);
  assert.equal(canvasTemplateEnabled("viral-remake", null), false);
  assert.equal(canvasTemplateEnabled("text-image", null), true);
});


test("step mode pauses after one execution, excludes simple workflows and single-node reruns", () => {
  assert.equal(pauseCanvasAfterStep("step", 4, undefined, 0), false);
  assert.equal(pauseCanvasAfterStep("step", 4, undefined, 1), true);
  assert.equal(pauseCanvasAfterStep("step", 4, 3, 1), true);
  assert.equal(pauseCanvasAfterStep("step", 4, 1, 1), false);
  assert.equal(pauseCanvasAfterStep("step", 2, undefined, 1), false);
  assert.equal(pauseCanvasAfterStep("auto", 4, undefined, 2), false);
});

test("managed mode retries only explicit transient task failures", () => {
  assert.equal(canvasManagedRetryableTask({ status: "failed", error_code: "MODEL_PROVIDER_ERROR", error_message: "等待上游响应超时" }), true);
  assert.equal(canvasManagedRetryableTask({ status: "failed", error_code: "MODEL_PROVIDER_ERROR", error_message: "生成完成但未返回视频" }), false);
  assert.equal(canvasManagedRetryableTask({ status: "failed", error_code: "INVALID_PARAMS", error_message: "duration invalid" }), false);
  assert.equal(canvasManagedRetryableTask({ status: "succeeded", error_code: "MODEL_TIMEOUT", error_message: "timeout" }), false);
});


test("completed node inputs stay reusable after progress, save and restore", () => {
  const input = { modelCode: "glm-4-5-air", mediaKind: "text", prompt: "测试", params: {}, roleKey: "writer" };
  const complete = { ...input, status: "succeeded", progress: 100, progressStage: "canvas.progress.completed", dirty: false, outputText: "结果", outputKind: "text", actualCost: 0.01, lastRunSignature: "signature", activeRunSignature: "", enhancing: false };
  assert.deepEqual(canvasNodeConfiguration(complete), canvasNodeConfiguration(input));
  assert.deepEqual(canvasNodeConfiguration(JSON.parse(JSON.stringify(complete))), canvasNodeConfiguration(input));
  assert.notDeepEqual(canvasNodeConfiguration({ ...complete, prompt: "已修改" }), canvasNodeConfiguration(input));
  assert.notDeepEqual(canvasNodeConfiguration({ ...complete, rolePrompt: "新的角色职责" }), canvasNodeConfiguration(input));
  assert.notDeepEqual(canvasNodeConfiguration({ ...complete, params: { temperature: 0.5 } }), canvasNodeConfiguration(input));
});

test("enhancement uses the connected final medium, not intermediate frames or unrelated nodes", () => {
  const nodes = [{id:"input",data:{}}, {id:"frame",data:{mediaKind:"image"}}, {id:"clip",data:{mediaKind:"video"}}];
  assert.equal(canvasEnhanceTarget("input",nodes,[{source:"input",target:"frame"},{source:"frame",target:"clip"}]), "video");
  assert.equal(canvasEnhanceTarget("input",nodes,[{source:"input",target:"frame"}]), "image");
  assert.equal(canvasEnhanceTarget("input",nodes,[]), "");
});


test("each shot binds only its own stable assets", () => {
  const a = { code: "A", type: "character", name: "女孩", visual_prompt: "短发米色外套" };
  const b = { code: "B", type: "character", name: "狗", visual_prompt: "黑白边牧" };
  assert.deepEqual(storyAssets([{ assets: [a, b] }, { assets: [b] }]), [a, b]);
  assert.deepEqual(storyShotAssets({ assets: [b] }), [b]);
  assert.throws(() => storyAssets([{ assets: [a] }, { assets: [{ ...a, visual_prompt: "长发红裙" }] }]), /不一致/);
  assert.deepEqual(storyShotAssets({ assets: [] }), []);
});

test("V2 creates canonical assets even for single-use items and requires a first-last-frame model", () => {
  const actor = { code: "ACTOR", type: "character", name: "女孩", visual_prompt: "短发米色外套" };
  const prop = { code: "PROP", type: "prop", name: "红伞", visual_prompt: "红色长柄伞" };
  const shots = [{ ...shot(1), assets: [actor] }, { ...shot(2), assets: [prop] }];
  assert.deepEqual(storyAssetPlan(shots, 0).generated, []);
  assert.deepEqual(storyAssetPlan(shots, 0, true).generated, [actor, prop]);
  assert.equal(storyV2VideoFrameLimit({ runtime_rule: { video: { upload_profile: "veo_frame_pair", max_total_images: 2 } } }), 2);
  assert.equal(storyV2VideoFrameLimit({ runtime_rule: { video: { upload_profile: "frame_pair", max_total_images: 2 } } }), 2);
  assert.equal(storyV2VideoFrameLimit({ runtime_rule: { video: { upload_profile: "veo_reference", max_reference_images: 3 } } }), 0);
});

test("V2 keeps assets on keyframes and chains each video from the previous video", () => {
  const actor = { code: "ACTOR", type: "character", name: "女孩", visual_prompt: "短发米色外套" };
  const board = { id: "board", type: "generator", position: { x: 0, y: 0 }, data: { storyGroupID: "g", storyRole: "storyboard", outputText: JSON.stringify([1, 2].map(index => ({ ...shot(index), assets: [actor] }))) } };
  const input = { id: "input", type: "textInput", position: { x: 0, y: 0 }, data: { storyGroupID: "g", storyRole: "input", storyPipelineVersion: 2, storyQualityMode: "strict", storyContinuityMode: "video_tail" } };
  const frames = [1, 2].map(index => ({ id: `frame${index}`, type: "generator", position: { x: 0, y: 0 }, data: { storyGroupID: "g", storyRole: "keyframe", storySegmentIndex: index, modelCode: "image" } }));
  const videos = [1, 2].map(index => ({ id: `video${index}`, type: "generator", position: { x: 0, y: 0 }, data: { storyGroupID: "g", storyRole: "video", storySegmentIndex: index } }));
  const synced = syncStoryAssetNodes(board, [input, board, ...frames, ...videos], []);
  const asset = synced.nodes.find(node => node.data.storyRole === "asset");
  assert.ok(asset);
  assert.ok(synced.edges.some(edge => edge.source === asset.id && edge.target === frames[0].id));
  assert.ok(!synced.edges.some(edge => edge.source === asset.id && edge.target === videos[0].id));
  assert.ok(synced.edges.some(edge => edge.source === videos[0].id && edge.target === videos[1].id));
  assert.ok(!synced.edges.some(edge => edge.source === videos[0].id && edge.target === frames[1].id));
  // Saved V2 canvases may still contain the old strict value. It must never
  // block the chained generation flow in either execution mode.
  assert.equal(canvasStrictQuality(videos[0], synced.nodes, "auto"), false);
  assert.equal(canvasStrictQuality(videos[0], synced.nodes, "step"), false);
});

test("location assets are empty-scene references", () => {
  const host = { code: "HOST", type: "character", name: "主持人", visual_prompt: "米色西装白色内搭" };
  const studio = { code: "STUDIO", type: "location", name: "Modern home office studio", visual_prompt: "现代居家办公室" };
  const board = { id: "board", type: "generator", position: { x: 0, y: 0 }, data: { storyGroupID: "g", storyRole: "storyboard", outputText: JSON.stringify([1, 2].map(index => ({ ...shot(index), assets: [host, studio] }))) } };
  const frame = { id: "frame", type: "generator", position: { x: 0, y: 0 }, data: { storyGroupID: "g", storyRole: "keyframe", modelCode: "image" } };
  const location = syncStoryAssetNodes(board, [board, frame], []).nodes.find(node => node.data.storyAssetCode === "STUDIO");
  assert.equal(location.data.storyAssetType, "location");
  assert.match(location.data.prompt, /纯场景空镜/);
  assert.match(location.data.storyAssetDefinition, /empty_scene_v1/);
});


test("generated storyboard materializes reusable assets and only required shot edges", () => {
  const a = { code: "A", type: "character", name: "女孩", visual_prompt: "短发米色外套" };
  const b = { code: "B", type: "character", name: "狗", visual_prompt: "黑白边牧" };
  const board = { id: "board", type: "generator", position: { x: 0, y: 0 }, data: { storyGroupID: "g", storyRole: "storyboard", outputText: JSON.stringify([{ ...shot(1), assets: [a] }, { ...shot(2), assets: [b] }, { ...shot(3), assets: [a, b] }]) } };
  const frame = index => ({ id: `f${index}`, type: "generator", position: { x: 0, y: 0 }, data: { storyGroupID: "g", storyRole: "keyframe", storySegmentIndex: index, modelCode: "image" } });
  const result = syncStoryAssetNodes(board, [board, frame(1), frame(2), frame(3)], [{ id: "old-chain", source: "f1", target: "f2" }]);
  const assets = result.nodes.filter(n => n.data.storyRole === "asset");
  assert.equal(assets.length, 2);
  assert.ok(result.edges.some(e => e.source === assets[0].id && e.target === "f1"));
  assert.ok(!result.edges.some(e => e.source === assets[0].id && e.target === "f2"));
  assert.ok(result.edges.some(e => e.source === "f1" && e.target === "f2"), "preserve user/legacy dependencies");
  assets[0].data.outputUrl = "saved.jpg";
  const again = syncStoryAssetNodes(board, result.nodes, result.edges);
  assert.equal(again.nodes.find(n => n.id === assets[0].id).data.outputUrl, "saved.jpg");
  assert.deepEqual(again.edges, result.edges);
});

test("single-shot history retires four asset jobs, preserving results and direct input references", () => {
  const asset = i => ({ code: `A${i}`, type: "prop", name: `商品${i}`, visual_prompt: `款式${i}` });
  const board = { id: "board", data: { storyGroupID: "g", storyRole: "storyboard", outputText: JSON.stringify([{ ...shot(1), assets: [1, 2, 3, 4].map(asset) }]) } };
  const input = { id: "input", data: { storyGroupID: "g", storyRole: "input", referenceImageUrls: ["1.png", "2.png", "3.png"] } };
  const frame = { id: "frame", data: { storyGroupID: "g", storyRole: "keyframe" } };
  const assets = [1, 2, 3, 4].map(i => ({ id: `asset${i}`, data: { storyGroupID: "g", storyRole: "asset", storyAssetCode: `A${i}`, outputUrl: `${i}.png`, taskNo: `paid${i}`, status: "failed" } }));
  const result = syncStoryAssetNodes(board, [input, board, frame, ...assets], [{ id: "input-board", source: "input", target: "board" }, ...assets.flatMap(a => [{ id: `board-${a.id}`, source: "board", target: a.id }, { id: `${a.id}-frame`, source: a.id, target: "frame" }])]);
  assert.equal(result.nodes.length, 3);
  assert.deepEqual(result.nodes.find(n => n.id === "board").data.storyArchivedAssets, assets);
  assert.deepEqual(result.nodes[0].data.referenceImageUrls, input.data.referenceImageUrls);
  assert.ok(result.edges.some(e => e.source === "board" && e.target === "frame"));
  assert.ok(result.edges.every(e => result.nodes.some(n => n.id === e.source) && result.nodes.some(n => n.id === e.target)));
  assert.deepEqual(syncStoryAssetNodes(result.nodes[1], result.nodes, result.edges), result);
});

test("story video does not silently keep text-only mode when a keyframe is available", () => {
  assert.equal(storyVideoMode("text", "veo_reference"), "reference");
  assert.equal(storyVideoMode("text", "minimax_h3"), "first_frame");
  assert.equal(storyVideoMode("text", "", ["text", "image"]), "image");
  assert.equal(storyVideoMode("first_last", "minimax_h3"), "first_last");
});


test("structured plans reject invalid durations and preserve wrapped metadata", () => {
  for (const duration_seconds of [-3, 0, "8"]) assert.deepEqual(storyStoryboardSegments(JSON.stringify([{ ...shot(1), duration_seconds }]), 1), []);
  assert.deepEqual(storyStoryboardSegments(JSON.stringify([shot(1)]), 1, 8), []);
  assert.deepEqual(storyStoryboardSegments(JSON.stringify([{ ...shot(1), scene: {}, duration_seconds: 8 }]), 1, 8), []);
  assert.equal(storyStoryboardSegments(JSON.stringify([{ ...shot(1), duration_seconds: 8 }]), 1, 8).length, 1);
  const plan = { source_structure: ["evidence"], segments: [{ index: 1, duration: 8, keyframe_prompt: "still", video_prompt: "motion" }] };
  assert.deepEqual(canvasJSONValue(JSON.stringify(plan)), plan);
  assert.equal(viralStoryboardSegments(JSON.stringify(plan), 1, 8).length, 1);
  assert.deepEqual(viralStoryboardSegments(JSON.stringify(plan), 2, 8), []);
  assert.deepEqual(viralStoryboardSegments(JSON.stringify(plan), 1, 5), []);
});

test("one-click remake requires source evidence and carries the shot through generation", () => {
  const segment = { index: 1, duration: 8, keyframe_prompt: "商品特写", video_prompt: "镜头后拉", camera: "低机位", action: "开盒", caption: "字幕", voiceover: "台词" };
  const plan = () => JSON.stringify({ segments: [segment] });
  assert.deepEqual(viralStoryboardSegments(plan(), 1, 8, true), []);
  Object.assign(segment, { source_start: 0, source_end: 7, source_observation: "原片低机位展示开盒" });
  assert.equal(viralStoryboardSegments(plan(), 1, 8, true).length, 1);
  for (const kind of ["keyframe", "video"]) {
    const prompt = viralShotContext(segment, kind);
    for (const detail of ["低机位", "开盒", "原片低机位展示开盒"]) assert.ok(prompt.includes(detail));
  }
  assert.ok(viralShotContext(segment, "video").includes("台词"));
  assert.ok(!viralShotContext(segment, "keyframe").includes("台词"));
  segment.source_end = 0;
  assert.deepEqual(viralStoryboardSegments(plan(), 1, 8, true), []);
});

test("remake provenance uses actual source and rejects reversed segments", () => {
  const first = { index: 1, duration: 8, keyframe_prompt: "still", video_prompt: "motion", source_start: 0, source_end: 5, source_observation: "开场" };
  const second = { ...first, index: 2, source_start: 4, source_end: 9 };
  assert.deepEqual(viralStoryboardSegments(JSON.stringify({ segments: [first, second] }), 2, 8, true), []);
  const stamped = JSON.parse(stampViralSource(JSON.stringify({ segments: [{ ...first, source_media: ["invented"] }] }), ["https://example.com/source.mp4"], "version-1"));
  assert.deepEqual(stamped.segments[0].source_media, ["https://example.com/source.mp4"]);
  assert.ok(viralShotContext(stamped.segments[0], "video").includes("source.mp4"));
});

test("asset regeneration retains user role overrides", () => {
  const asset = { code: "CHAR_01", type: "character", name: "主角", visual_prompt: "蓝色外套" };
  const board = { id: "b", type: "generator", position: { x: 0, y: 0 }, data: { storyGroupID: "g", outputText: JSON.stringify([1, 2].map(i => ({ ...shot(i), assets: [asset] }))) } };
  const frame = { id: "f", data: { storyGroupID: "g", storyRole: "keyframe", modelCode: "image" } };
  const first = syncStoryAssetNodes(board, [board, frame], []);
  const old = first.nodes.find(n => n.data.storyRole === "asset");
  Object.assign(old.data, { roleKey: "imageEdit", rolePrompt: "保留雀斑", roleEnabled: false });
  board.data.outputText = JSON.stringify([1, 2].map(i => ({ ...shot(i), assets: [{ ...asset, visual_prompt: "红色外套" }] })));
  const next = syncStoryAssetNodes(board, first.nodes, first.edges).nodes.find(n => n.id === old.id);
  assert.equal(next.data.rolePrompt, "保留雀斑");
  assert.equal(next.data.roleKey, "imageEdit");
  assert.equal(next.data.roleEnabled, false);
});


test("whole-sequence generation requires declared duration support and native audio", () => {
  assert.equal(storyWholeGeneration("seedance_2", [5, 8, 15], 15, "auto", false), true);
  for (const duration of [6, 19, 37, 54]) {
    assert.equal(storyWholeGeneration("seedance_2", [duration], duration, "auto", false), true);
    assert.equal(storyWholeGeneration("seedance_2", [8, 15], duration, "auto", false), false);
  }
  for (const args of [["veo_reference", [8], 15, "auto", false], ["seedance_2", [5, 8], 15, "auto", false], ["seedance_2", [15], 15, "shots", false], ["seedance_2", [15], 15, "auto", true]]) assert.equal(storyWholeGeneration(...args), false);
});

test("review gates copy, storyboard and all assets; skipping review remains possible", () => {
  const make = (id, role, data = {}) => ({ id, data: { storyGroupID: "g", storyRole: role, status: "succeeded", ...data } });
  const input = make("i", "input"), copy = make("c", "copy"), script = make("s", "script"), board = make("b", "storyboard"), a = make("a", "asset"), b = make("b2", "asset"), frame = make("f", "keyframe");
  const nodes = [input, copy, script, board, a, b, frame];
  assert.equal(storyReviewBlock(script, nodes), copy);
  copy.data.storyApproved = true;
  assert.equal(storyReviewBlock(script, nodes), undefined);
  assert.equal(storyReviewBlock(a, nodes), board);
  board.data.storyStoryboardApproved = true;
  assert.equal(storyReviewBlock(a, nodes), undefined);
  a.data.storyApproved = true;
  assert.equal(storyReviewBlock(frame, nodes), b);
  b.data.storyApproved = true;
  assert.equal(storyReviewBlock(frame, nodes), undefined);
  b.data.dirty = true;
  assert.equal(storyReviewBlock(frame, nodes), b);
  input.data.storyReviewRequired = false;
  assert.equal(storyReviewBlock(frame, nodes), undefined);
});

test("smart mode bypasses review gates while step mode keeps real approvals", () => {
  const input = { id: "input", data: { storyGroupID: "g", storyRole: "input", storyReviewRequired: true } };
  const copy = { id: "copy", data: { storyGroupID: "g", storyRole: "copy", status: "succeeded" } };
  const script = { id: "script", data: { storyGroupID: "g", storyRole: "script" } };
  assert.equal(storyReviewBlockForMode("auto", script, [input, copy, script]), undefined);
  assert.equal(storyReviewBlockForMode("step", script, [input, copy, script]), copy);
});

test("continuous shots depend on the previous video, with no cycle in whole-sequence mode", () => {
  const board = { id: "board", data: { storyRole: "storyboard", storyGroupID: "g", outputText: JSON.stringify([shot(1), { ...shot(2), continuity: "continuous" }]) } };
  const frames = [1, 2].map(index => ({ id: "f" + index, data: { storyRole: "keyframe", storyGroupID: "g", storySegmentIndex: index } }));
  const video = { id: "v1", data: { storyRole: "video", storyGroupID: "g", storySegmentIndex: 1 } };
  const nodes = [{ id: "input", data: { storyGroupID: "g", storyRole: "input", storyContinuityMode: "video_tail" } }, board, ...frames, video];
  const edges = [{ id: "f1-v1", source: "f1", target: "v1" }];
  const split = syncStoryAssetNodes(board, nodes, edges);
  assert.ok(split.edges.some(edge => edge.source === "v1" && edge.target === "f2"));
  assert.ok(!split.edges.some(edge => edge.source === "f1" && edge.target === "f2"));
  video.data.storyWholeVideo = true;
  assert.ok(!syncStoryAssetNodes(board, nodes, split.edges).edges.some(edge => edge.source === "v1" && edge.target === "f2"));
});

test("ordinary shots remove the automatic video-tail wait, preserving submitted frame inputs", () => {
  const board = { id: "board", data: { storyRole: "storyboard", storyGroupID: "g", outputText: JSON.stringify([shot(1), { ...shot(2), continuity: "continuous" }]) } };
  const input = { id: "input", data: { storyRole: "input", storyGroupID: "g" } };
  const frames = [1, 2].map(index => ({ id: "f" + index, data: { storyRole: "keyframe", storyGroupID: "g", storySegmentIndex: index } }));
  const video = { id: "v1", data: { storyRole: "video", storyGroupID: "g", storySegmentIndex: 1 } };
  const nodes = [input, board, ...frames, video];
  const old = [{ id: "consistency_v1_f2", source: "v1", target: "f2" }];
  const parallel = syncStoryAssetNodes(board, nodes, old);
  assert.ok(!parallel.edges.some(edge => edge.source === "v1" && edge.target === "f2"));
  assert.ok(parallel.edges.some(edge => edge.source === "board" && edge.target === "f2"));
  frames[1].data.taskNo = "already-submitted";
  const preserved = syncStoryAssetNodes(board, nodes, old);
  assert.ok(preserved.edges.some(edge => edge.source === "v1" && edge.target === "f2"));
});

test("tail-frame extraction seeks near the actual end and releases the video", async () => {
  const saved = globalThis.document;
  const listeners = new Map();
  let time, released = false;
  const video = { duration: 8, videoWidth: 100, videoHeight: 100,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    load: () => queueMicrotask(() => listeners.get("loadeddata")?.()), removeAttribute: () => { released = true; },
    set currentTime(value) { time = value; queueMicrotask(() => listeners.get("seeked")?.()); }
  };
  globalThis.document = { createElement: kind => kind === "video" ? video : { getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,tail" } };
  try { assert.deepEqual(await storyVideoSamples("clip.mp4", [1]), ["data:image/jpeg;base64,tail"]); assert.equal(time, 7.95); assert.equal(released, true); }
  finally { globalThis.document = saved; }
});
