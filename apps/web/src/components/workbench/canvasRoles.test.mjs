import assert from "node:assert/strict";
import test from "node:test";
import { canvasRoles, canvasRolePrompt, defaultCanvasRole, canvasMediaPrompt, canvasAudioRoleParams, canvasInputConstraints, legacyCanvasTaskRole, canvasRoleCompatible, resolvedCanvasRole, normalizeCanvasRoleData, canvasRoleText, canvasAudioModeForModel } from "./canvasRoles.ts";

test("teaching image role permits source text while ordinary social illustration keeps blank space", () => {
  const node = { type: "generator", data: { mediaKind: "image", contentRole: "publish_image", params: { content_layout: "document_pages" } } };
  assert.match(canvasMediaPrompt(node), /必须清晰绘制本页准确文字/);
  assert.match(canvasRolePrompt(node), /教学图页设计师/);
  assert.doesNotMatch(canvasRolePrompt(node), /长文案留给后期排版/);
  assert.match(canvasMediaPrompt({ ...node, data: { ...node.data, params: {} } }), /留后期文字空间/);
});

test("roles follow each node's responsibility and respect overrides", () => {
  assert.equal(defaultCanvasRole({ type: "generator", data: { mediaKind: "text", viralRole: "analysis" } }), "reverse");
  assert.equal(defaultCanvasRole({ type: "generator", data: { mediaKind: "text", storyRole: "storyboard" } }), "storyboard");
  assert.equal(defaultCanvasRole({ type: "generator", data: { mediaKind: "audio" } }), "speech");
  assert.equal(defaultCanvasRole({ type: "compositor", data: {} }), "compose");
  assert.equal(canvasRolePrompt({ data: { roleEnabled: false } }), "");
  assert.match(canvasRolePrompt({ data: { mediaKind: "image", roleKey: "image", rolePrompt: "保留红色包装" } }), /保留红色包装/);
  assert.match(canvasRolePrompt({ data: { roleKey: "missing" } }), /输出协议优先/);
});


test("professional role defaults cover workflow responsibilities and preserve custom edits", () => {
  assert.equal(defaultCanvasRole({ type: "generator", data: { storyRole: "narrationText", mediaKind: "text" } }), "speechPlan");
  assert.equal(defaultCanvasRole({ type: "generator", data: { storyRole: "narration", mediaKind: "audio" } }), "speech");
  for (const role of Object.values(canvasRoles)) {
    assert.ok(role.prompt.trim(), `${role.name} is missing its execution guidance`);
    assert.match(role.prompt, /【/);
  }
  const node = { type: "generator", data: { mediaKind: "text", roleKey: "storyboard" } };
  assert.match(canvasRolePrompt(node), /影视分镜导演/);
  assert.match(canvasRolePrompt(node), /JSON、分隔符/);
  assert.match(canvasRolePrompt({ ...node, data: { ...node.data, rolePrompt: "自定义职责" } }), /自定义职责/);
  assert.doesNotMatch(canvasRolePrompt({ ...node, data: { ...node.data, rolePrompt: "自定义职责" } }), /【拆镜原则】/);
});

test("task roles distinguish commerce deliverables and survive renames and overrides", () => {
  for (const [label, mediaKind, expected] of [["商品主图", "image", "commerceMain"], ["详情与营销海报", "image", "commerceDetail"], ["Product showcase video", "video", "commerceVideo"]]) {
    const node = { type: "generator", data: { label, mediaKind } };
    node.data.taskRole = legacyCanvasTaskRole(node);
    node.data.label = "renamed";
    assert.equal(defaultCanvasRole(node), expected);
    assert.doesNotMatch(canvasMediaPrompt(node), /你是|你负责|【/);
    assert.match(canvasMediaPrompt({ ...node, data: { ...node.data, rolePrompt: "自定义保留包装" } }), /^自定义保留包装\n当前节点只输出/);
  }
  assert.equal(defaultCanvasRole({ data: { storyRole: "asset", mediaKind: "image" } }), "assetVisual");
  assert.equal(defaultCanvasRole({ data: { contentRole: "publish_copy", mediaKind: "text" } }), "publish");
});

test("audio guidance follows declared capability and never goes into lyrics", () => {
  const node = { data: { mediaKind: "audio", params: { style_prompt: "低声" } } };
  const dual = key => ({ runtime_rule: { audio: { input_layout: "dual", secondary_prompt_key: key } } });
  assert.match(canvasAudioRoleParams(node, dual("style_prompt")).style_prompt, /低声/);
  assert.deepEqual(canvasAudioRoleParams(node, dual("lyrics")), {});
  assert.deepEqual(canvasAudioRoleParams(node, {}), {});
  assert.deepEqual(canvasAudioRoleParams({ data: { ...node.data, roleEnabled: false } }, dual("style_prompt")), {});
  assert.ok(canvasAudioRoleParams(node, { input_schema: { properties: { instruction: {} } } }).instruction);
});

test("only explicit input constraints propagate and disabled roles stay disabled", () => {
  const inputs = [{ type: "textInput", data: { roleKey: "brief" } }, { type: "imageInput", data: { rolePrompt: "保留Logo" } }, { type: "generator", data: { rolePrompt: "其他岗位" } }];
  assert.equal(canvasInputConstraints({ data: {} }, inputs), "保留Logo");
  assert.equal(canvasInputConstraints({ data: { roleEnabled: false } }, inputs), "");
});


test("all preset and corrupt role keys stay inside their node media type", () => {
  const keys = [...Object.keys(canvasRoles), "missing", "__proto__", "constructor"];
  for (const mediaKind of ["text", "image", "video", "audio"]) {
    for (const key of keys) {
      for (const field of ["roleKey", "taskRole"]) {
        const node = { type: "generator", data: { mediaKind, [field]: key } };
        const resolved = resolvedCanvasRole(node);
        assert.ok(canvasRoleCompatible(node, resolved), `${mediaKind}/${field}/${key} resolved to ${resolved}`);
        const fixed = { ...node, data: normalizeCanvasRoleData(node) };
        assert.equal(resolvedCanvasRole(fixed), resolved);
        if (!canvasRoleCompatible(node, key)) assert.notEqual(resolved, key);
      }
    }
    const corrupt = { type: "generator", data: { mediaKind, storyRole: "storyboard", viralRole: "analysis" } };
    assert.ok(canvasRoleCompatible(corrupt, defaultCanvasRole(corrupt)));
    const repaired = normalizeCanvasRoleData(corrupt);
    if (mediaKind !== "text") { assert.equal(repaired.storyRole, undefined); assert.equal(repaired.viralRole, undefined); }
  }
  assert.equal(defaultCanvasRole({ type: "generator", data: {} }), "image");
  assert.equal(defaultCanvasRole({ type: "textInput", data: { taskRole: "video" } }), "brief");
});

test("incompatible overrides are retained for recovery but never sent to the model", () => {
  const original = { type: "generator", data: { mediaKind: "image", roleKey: "video", rolePrompt: "OLD VIDEO ROLE", taskRole: "commerceVideo", roleEnabled: true } };
  const data = normalizeCanvasRoleData(original);
  assert.equal(data.previousRole.rolePrompt, "OLD VIDEO ROLE");
  assert.equal(data.rolePrompt, undefined);
  assert.doesNotMatch(canvasRoleText(original), /OLD VIDEO ROLE/);
  assert.doesNotMatch(canvasMediaPrompt(original), /OLD VIDEO ROLE/);
  assert.equal(resolvedCanvasRole({ ...original, data }), "image");
  const custom = { type: "generator", data: { mediaKind: "image", roleKey: "imageEdit", rolePrompt: "保留雀斑", roleEnabled: false } };
  assert.equal(normalizeCanvasRoleData(custom).rolePrompt, "保留雀斑");
  assert.equal(canvasMediaPrompt(custom), "");
});

test("speech and music models keep distinct roles and narration never uses a composer", () => {
  for (const code of ["audio_suno", "audio_minimax_music_26", "fun-music-preview"]) assert.equal(canvasAudioModeForModel({code}), "music");
  for (const code of ["audio_minimax_speech_28_hd", "qwen-audio-3-0-tts-flash", "cosyvoice-v1"]) assert.equal(canvasAudioModeForModel({code}), "speech");
  assert.equal(canvasAudioModeForModel({code: "custom"}), undefined);
  assert.equal(resolvedCanvasRole({data: {mediaKind: "audio", storyRole: "narration", roleKey: "music"}}), "speech");
  assert.equal(resolvedCanvasRole({data: {mediaKind: "audio", audioMode: "music", roleKey: "speech"}}), "music");
});
