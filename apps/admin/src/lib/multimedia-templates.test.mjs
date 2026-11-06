import assert from "node:assert/strict";
import test from "node:test";
import { MULTIMEDIA_TEMPLATES, applyMultimediaTemplate, configureZexUploadProfile, clearTemplateConnection, clearMediaTemplateRuntime } from "./multimedia-templates.ts";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("Studio gateway duration defaults agree with the form schema", () => {
  for (const template of MULTIMEDIA_TEMPLATES.filter(item => /^zex_(seedance_2_0|minimax_h3)/.test(item.key))) {
    assert.deepEqual(template.schema.properties.duration.enum, Array.from({ length: 12 }, (_, i) => i + 4));
    assert.equal(template.defaults.duration, 6);
    assert.equal(template.schema.properties.duration.default, 6);
    assert.equal(template.runtime.video.max_reference_total, 9);
  }
});

test("Omni frame template uses its own fixed-duration model and preserves ordered frame slots", () => {
  const template = MULTIMEDIA_TEMPLATES.find(item => item.key === "omni_frame_pair_v1");
  const form = applyMultimediaTemplate({ new_api_model: "omni_flash-10s", new_api_extra_params: '{"connection":{"api_key":"keep"}}', runtime_rule: "{}" }, template.key);
  assert.equal(form.new_api_model, "omni_flash-10s-fl");
  assert.equal(JSON.parse(form.new_api_extra_params).connection.api_key, "keep");
  assert.deepEqual(template.schema.properties.size.enum, ["1280x720", "720x1280"]);
  assert.deepEqual(template.schema.required, ["first_frame"]);
  assert.equal(template.defaults.duration, 10);
  assert.equal(template.runtime.video.frames.last.max, 1);
  assert.equal(template.runtime.video.reference_videos.max, 0);
  assert.deepEqual(template.runtime.upstream.include, ["size", "first_frame", "last_frame"]);
});

test("Omni input shape switches select matching physical models in both directions", () => {
  const source = ts.createSourceFile("models.tsx", readFileSync(new URL("../app/admin/models/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let applyReference, change;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "applyOmniReferenceV1") applyReference = node.getText(source);
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "select" && node.attributes.properties.some(attr => attr.name?.text === "value" && attr.getText(source).includes("getVideoRule(form.runtime_rule).upload_profile"))) {
      change = node.attributes.properties.find(attr => attr.name?.text === "onChange").initializer.expression.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(applyReference && change);
  let form = { new_api_model: "omni_flash-10s", runtime_rule: '{"upstream":{"adapter":"omni_reference_v1"}}', new_api_extra_params: "{}" };
  const context = { form, currentRuntimeRule: JSON.parse(form.runtime_rule), setVideoTemplateKey() {}, setForm: update => { form = update(form); }, applyMultimediaTemplate, setConnection: text => text, VEO_FRAME_PAIR_TEMPLATE_KEY: "veo_frame_pair_v1", OMNI_REFERENCE_TEMPLATE_KEY: "omni_reference_v1" };
  vm.runInNewContext(ts.transpileModule(`var ${applyReference}; var change = ${change};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.change({ target: { value: "veo_frame_pair" } });
  assert.equal(form.new_api_model, "omni_flash-10s-fl");
  assert.equal(JSON.parse(form.runtime_rule).upstream.adapter, "omni_frame_pair_v1");
  context.form = form;
  context.currentRuntimeRule = JSON.parse(form.runtime_rule);
  context.change({ target: { value: "omni_reference" } });
  assert.equal(form.new_api_model, "omni_flash-10s");
  assert.equal(JSON.parse(form.runtime_rule).upstream.adapter, "omni_reference_v1");
});

test("advanced JSON editing synchronizes changed defaults of all field types and tolerates unfinished JSON", () => {
  const source = ts.createSourceFile("models.tsx", readFileSync(new URL("../app/admin/models/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "onChange" && node.parent.getText(source).includes("value={form.input_schema}")) handler = node.initializer.expression;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(handler);
  let form = { input_schema: JSON.stringify({ properties: { duration: { default: 5 }, enabled: { default: true }, quality: { default: "auto" } } }), default_params: JSON.stringify({ duration: 5, enabled: true, quality: "high", channel_key: "keep" }) };
  const ctx = { setForm: update => { form = update(form); }, safeParseJson: (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } } };
  vm.runInNewContext(ts.transpileModule(`var change = ${handler.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  ctx.change({ target: { value: JSON.stringify({ properties: { duration: { default: 10 }, enabled: { default: false }, quality: { default: "auto" }, options: { default: [1, 2] } } }) } });
  assert.deepEqual(JSON.parse(form.default_params), { duration: 10, enabled: false, quality: "high", channel_key: "keep", options: [1, 2] });
  ctx.change({ target: { value: '{"properties":' } });
  assert.equal(form.input_schema, '{"properties":');
  assert.equal(JSON.parse(form.default_params).duration, 10);
});

test("provider save normalization preserves supported JSON choices and presentation settings", () => {
  const source = ts.createSourceFile("models.tsx", readFileSync(new URL("../app/admin/models/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration, loop;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "configuredProperties") declaration = node;
    if (ts.isForOfStatement(node) && node.expression.getText(source).includes("Object.entries(configuredProperties)")) loop = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration && loop);
  for (const supported of [true, false]) {
    let error;
    const field = { type: "string", enum: supported ? ["720x1280"] : ["4096x4096"], default: "720x1280", title: "我的竖屏", enumLabels: { "720x1280": "自定义标签" }, "x-order": 17, "x-widget": "select", "x-placement": "top" };
    const ctx = { form: { input_schema: JSON.stringify({ properties: { size: field } }) }, parsedInputSchema: { properties: { size: { enum: ["1280x720", "720x1280"], title: "视频尺寸", "x-order": 3, "x-widget": "option_menu" } } }, setErr: value => { error = value; } };
    const code = `function preserve() { var ${declaration.getText(source)}; ${loop.getText(source)} } preserve();`;
    vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
    if (!supported) { assert.ok(error?.includes("不支持")); continue; }
    assert.equal(error, undefined);
    for (const key of ["enum", "default", "title", "enumLabels", "x-order", "x-widget", "x-placement"]) assert.deepEqual(JSON.parse(JSON.stringify(ctx.parsedInputSchema.properties.size[key])), field[key]);
  }
});

test("Zex video templates encode gateway capabilities instead of vendor-native fields", () => {
  const templates = MULTIMEDIA_TEMPLATES.filter((item) => item.runtime.upstream.adapter === "zex_video");
  assert.equal(templates.length, 8);
  for (const item of templates) {
    assert.equal(item.endpoint, "/v1/videos");
    assert.equal(item.runtime.upstream.poll_path, "/v1/videos/{id}");
    assert.equal(item.runtime.video.upload_profile, "aliyun_multimodal");
    assert.deepEqual(item.runtime.upstream.response_map.media_url, ["url", "video_url"]);
    assert.ok(item.schema.properties.duration.enum.includes(item.defaults.duration));
    const resolutions = item.model.startsWith("minimax-") ? ["480p", "768p"] : ["480p", "720p"];
    assert.deepEqual(item.schema.properties.resolution.enum, resolutions);
    assert.equal(item.schema.properties.resolution["x-widget"], "option_menu");
    assert.equal(item.defaults.resolution, resolutions[0]);
    assert.equal(item.schema.properties.resolution.default, item.defaults.resolution);
    assert.equal(item.runtime.upstream.result_path, undefined);
    assert.equal(item.billing, ["zex_seedance_2_5", "zex_seedance_2_0"].includes(item.key) ? "per_request" : "per_second");
    assert.equal(item.connection.auth_type, "bearer");
  }
  const model = (name) => templates.find((item) => item.model === name);
  for (const name of ["seedance-2.0", "seedance-2.0-mini"]) {
    const applied = applyMultimediaTemplate({ new_api_model: "", new_api_extra_params: "{}", runtime_rule: "{}" }, model(name).key);
    assert.deepEqual(JSON.parse(applied.price_rule), { billing_type: name === "seedance-2.0" ? "per_request" : "per_second", unit_price: 0, currency: "POINT", unit_price_by_resolution: { "480p": 0, "720p": 0 } });
  }
  assert.deepEqual(model("grok-imagine-video-1.5-lite").schema.properties.generation_mode.enum, ["text", "first_frame"]);
  assert.equal(model("grok-imagine-video-1.5-fast").runtime.video.reference_max_duration, 10);
  assert.equal(model("grok-imagine-video-1.5").runtime.video.max_reference_images, 7);
  const seedance25 = templates.filter(item => item.key === "zex_seedance_2_5");
  assert.equal(seedance25.length, 1);
  assert.deepEqual(seedance25[0].schema.properties.duration.enum, [10, 15, 30]);
  assert.equal(seedance25[0].defaults.duration, 10);
  assert.equal(seedance25[0].runtime.upstream.model_template, "seedance-2.5-{duration}s");
  assert.equal(seedance25[0].runtime.video.reference_videos.max, 0);
  assert.equal(seedance25[0].runtime.video.reference_audios.max, 0);
  const applied = applyMultimediaTemplate({ new_api_model: "", new_api_extra_params: "{}", runtime_rule: "{}" }, seedance25[0].key);
  assert.deepEqual(JSON.parse(applied.price_rule), { billing_type: "per_request", unit_price: 0, currency: "POINT", unit_price_by_duration: { "10": 0, "15": 0, "30": 0 } });
  for (const name of ["minimax-h3", "minimax-h3-max"]) {
    assert.deepEqual(model(name).schema.properties.generation_mode.enum, ["text", "image", "video", "audio", "image_audio", "image_video", "video_audio", "image_video_audio", "reference"]);
    assert.equal(model(name).runtime.video.max_reference_total, 9);
    assert.equal(model(name).runtime.video.reference_videos.max, 9);
    const applied = applyMultimediaTemplate({ new_api_model: "", new_api_extra_params: "{}", runtime_rule: "{}" }, model(name).key);
    assert.deepEqual(JSON.parse(applied.price_rule), { billing_type: "per_second", unit_price: 0, currency: "POINT", unit_price_by_resolution: { "480p": 0, "768p": 0 } });
  }
});

test("Zex upload shape changes existing material menus without replacing protocol, limits or prices", () => {
  for (const template of MULTIMEDIA_TEMPLATES.filter(t => t.runtime.upstream.adapter === "zex_video")) {
    const form = { ...applyMultimediaTemplate({ new_api_model: "", new_api_extra_params: "{}", runtime_rule: "{}" }, template.key), price_rule: '{"unit_price":3}' };
    const reference = configureZexUploadProfile(form, "multi_ref");
    assert.deepEqual(JSON.parse(reference.input_schema).properties.generation_mode.enum, template.model.startsWith("minimax-") ? ["text", "reference"] : template.schema.properties.generation_mode.enum);
    const combination = configureZexUploadProfile(reference, "seedance_2");
    const modes = JSON.parse(combination.input_schema).properties.generation_mode.enum;
    assert.equal(modes.includes("first_last"), template.schema.properties.generation_mode.enum.includes("first_last"));
    assert.equal(modes.includes("image_video_audio"), template.runtime.video.reference_videos.max > 0);
    assert.equal(modes.includes("image"), template.schema.properties.generation_mode.enum.includes("reference"));
    const restored = configureZexUploadProfile(combination,"aliyun_multimodal");
    assert.deepEqual(JSON.parse(restored.input_schema).properties.generation_mode.enum, template.schema.properties.generation_mode.enum);
    assert.equal(restored.price_rule,form.price_rule);
    assert.deepEqual(JSON.parse(restored.runtime_rule).upstream,JSON.parse(form.runtime_rule).upstream);
    assert.equal(JSON.parse(restored.runtime_rule).video.max_reference_total,template.runtime.video.max_reference_total);
  }
  const source = ts.createSourceFile("models.tsx",readFileSync(new URL("../app/admin/models/page.tsx",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=[];
  function visit(n) { if(ts.isVariableDeclaration(n) && ["getVideoRule","setVideoRule"].includes(n.name.getText(source))) declarations.push(`var ${n.getText(source)};`); ts.forEachChild(n,visit); }
  visit(source);
  const ctx={safeParseJson:(raw,fallback)=>{try{return JSON.parse(raw)}catch{return fallback}}};
  vm.runInNewContext(ts.transpileModule(declarations.join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
  const original={upstream:{adapter:"zex_video",model_template:"seedance-2.5-{duration}s"}, video:{upload_profile:"aliyun_multimodal",count_toward_total:false,max_reference_total:9,reference_max_duration:10,frames:{first:{key:"start",max:1}},reference_images:{key:"refs",max:4},reference_videos:{max:0},reference_audios:{max:0}}};
  const changed=JSON.parse(ctx.setVideoRule(JSON.stringify(original),{upload_profile:"seedance_2"}));
  assert.equal(changed.video.max_reference_total,9);
  assert.equal(changed.video.count_toward_total,false);
  assert.equal(changed.video.reference_max_duration,10);
  assert.equal(changed.video.frames.first.key,"start");
  assert.equal(changed.video.reference_images.key,"refs");
  assert.equal(changed.video.reference_videos.max,0);
  assert.deepEqual(changed.upstream.adapter,original.upstream.adapter);
});

test("MiniMax multimodal menus reuse existing upload profiles and respect disabled media kinds", () => {
  for (const key of ["zex_minimax_h3", "zex_minimax_h3_max"]) {
    const original = applyMultimediaTemplate({ new_api_model: "", new_api_extra_params: "{}", runtime_rule: "{}" }, key);
    const runtime = JSON.parse(original.runtime_rule);
    runtime.video.reference_videos.max = 0;
    const form = { ...original, runtime_rule: JSON.stringify(runtime), price_rule: '{"unit_price":0.08}' };
    const configured = configureZexUploadProfile(form, "aliyun_multimodal");
    assert.deepEqual(JSON.parse(configured.input_schema).properties.generation_mode.enum, ["text", "image", "audio", "image_audio", "reference"]);
    assert.equal(configured.price_rule, form.price_rule);
    assert.deepEqual(JSON.parse(configured.runtime_rule).upstream, runtime.upstream);
    assert.deepEqual(JSON.parse(configureZexUploadProfile(form, "none").input_schema).properties.generation_mode.enum, ["text"]);
  }
});

test("saving advanced gateway material defaults synchronizes workbench params and validates the selected mode", () => {
  const source = ts.createSourceFile("models.tsx", readFileSync(new URL("../app/admin/models/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let sync;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(source).includes("isSeedance2 || isMiniMaxH3") && node.thenStatement.getText(source).includes("schemaDefault")) sync = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(sync);
  const save = ts.transpileModule(`function save() { ${sync} } save();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const template of MULTIMEDIA_TEMPLATES.filter(item => item.runtime.upstream.adapter === "zex_video")) {
    const applied = applyMultimediaTemplate({ new_api_model: "", new_api_extra_params: "{}", runtime_rule: "{}" }, template.key);
    const configured = configureZexUploadProfile(applied, template.key.startsWith("zex_seedance") ? "seedance_2" : "aliyun_multimodal");
    const input = JSON.parse(configured.input_schema);
    const runtime = JSON.parse(configured.runtime_rule);
    for (const mode of [...input.properties.generation_mode.enum, "unsupported_mode"]) {
      input.properties.generation_mode.default = mode;
      const context = {
        isSeedance2: false, isMiniMaxH3: false, isVeoReference: false, isOmniReference: false, isOctopusSDMini: false, isZexVideo: true,
        parsedRuntimeRule: runtime, parsedInputSchema: input, defaultParams: JSON.parse(configured.default_params), setErr: message => { context.error = message; },
      };
      vm.runInNewContext(save, context);
      if (mode === "unsupported_mode") {
        assert.ok(context.error, `${template.key} must reject an unavailable default`);
      } else {
        assert.equal(context.error, undefined);
        assert.equal(context.defaultParams.generation_mode, mode, template.key);
        assert.equal(context.defaultParams.duration, template.defaults.duration);
        assert.equal(context.defaultParams.resolution, template.defaults.resolution);
      }
    }
    runtime.video.mode_param = "custom_mode";
    input.properties.custom_mode = { ...input.properties.generation_mode, default: "first_frame", enum: ["text", "first_frame"] };
    const context = {
      isSeedance2: false, isMiniMaxH3: false, isVeoReference: false, isOmniReference: false, isOctopusSDMini: false, isZexVideo: true,
      parsedRuntimeRule: runtime, parsedInputSchema: input, defaultParams: { custom_mode: "text" }, setErr: message => { throw new Error(message); },
    };
    vm.runInNewContext(save, context);
    assert.equal(context.defaultParams.custom_mode, "first_frame");
  }
});

test("gateway templates retain credentials and explicit identity while resetting provider params and prices", () => {
  const current = { new_api_model: "custom-model-alias", runtime_rule: '{"upstream":{"adapter":"old","static":{"old":true}}}', new_api_extra_params: JSON.stringify({ connection: { base_url: "https://gateway.test", api_key: "test-key" }, custom: true }) };
  assert.equal(MULTIMEDIA_TEMPLATES.length, 29);
  assert.equal(new Set(MULTIMEDIA_TEMPLATES.map((item) => item.key)).size, MULTIMEDIA_TEMPLATES.length);
  for (const template of MULTIMEDIA_TEMPLATES) {
    const form = applyMultimediaTemplate(current, template.key);
    const runtime = JSON.parse(form.runtime_rule);
    const extra = JSON.parse(form.new_api_extra_params);
    assert.equal(extra.connection.base_url, "https://gateway.test");
    assert.equal(extra.connection.api_key, "test-key");
    assert.equal(extra.custom, true);
    assert.equal(runtime.template_key, template.key);
    assert.equal(runtime.upstream.static?.old, undefined);
    assert.equal(form.new_api_model, template.model || "custom-model-alias");
    assert.equal(JSON.parse(form.price_rule).unit_price, 0);
    assert.ok(template.endpoint.startsWith("/"));
    assert.ok(template.description);
  }
  assert.equal(applyMultimediaTemplate(current, "missing"), current);
});

test("audio display preference preserves per-second billing and switching preserves zero/token rates", () => {
  const source = ts.createSourceFile("models.tsx", readFileSync(new URL("../app/admin/models/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const pricing = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "switchedPriceRule");
  let callback;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "select") {
      const value = node.attributes.properties.find((attribute) => attribute.name?.text === "value");
      if (value?.getText(source).includes("getAudioRule(form.runtime_rule).billing_hint")) {
        callback = node.attributes.properties.find((attribute) => attribute.name?.text === "onChange").initializer.expression;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  let form = { price_rule: '{"billing_type":"per_second","unit_price":0.2}', runtime_rule: "{}" };
  const context = { setForm: (update) => { form = update(form); }, setAudioRule: (runtime, patch) => JSON.stringify({ ...JSON.parse(runtime), audio: patch }) };
  vm.runInNewContext(ts.transpileModule(`${pricing.getText(source)}\nconst change = ${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  vm.runInNewContext('change({target:{value:"estimated"}})', context);
  assert.equal(JSON.parse(form.price_rule).billing_type, "per_second");
  assert.equal(JSON.parse(form.price_rule).unit_price, 0.2);
  assert.equal(context.switchedPriceRule({ unit_price: 0 }, "per_request").unit_price, 0);
  assert.equal(context.switchedPriceRule({ input_price_per_m: 0, output_price_per_m: 0 }, "per_token").input_price_per_m, 0);
  assert.equal(context.switchedPriceRule({ input_price: 0.000002 }, "per_token").input_price_per_m, 2);
  assert.deepEqual(context.switchedPriceRule({ unit_price: 0, unit_price_by_duration: { "10": 2, "15": 3, "30": 7 } }, "per_request").unit_price_by_duration, { "10": 2, "15": 3, "30": 7 });
  for (const billing of ["per_request", "per_second"]) {
    assert.deepEqual(context.switchedPriceRule({ unit_price: 0, unit_price_by_resolution: { "480p": 5.5, "720p": 8.75 } }, billing).unit_price_by_resolution, { "480p": 5.5, "720p": 8.75 });
  }
});

test("editing resolution prices preserves the other tier and billing selection", () => {
  const source = ts.createSourceFile("models.tsx", readFileSync(new URL("../app/admin/models/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration, unitDeclaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "setVideoResolutionPrice") declaration = node;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "setVideoPriceValue") unitDeclaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration);
  let form = { price_rule: '{"billing_type":"per_request","unit_price":3,"currency":"POINT"}', runtime_rule: '{"upstream":{"adapter":"zex_video"}}' };
  const context = { resolutionPriceTiers: ["480p", "720p"], safeParseJson: JSON.parse, setForm: (update) => { form = update(form); } };
  vm.runInNewContext(ts.transpileModule(`var ${declaration.getText(source)}; var ${unitDeclaration.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.setVideoResolutionPrice("480p", 5.5);
  assert.deepEqual(JSON.parse(form.price_rule).unit_price_by_resolution, { "480p": 5.5, "720p": 3 });
  context.setVideoResolutionPrice("720p", 8.75);
  assert.deepEqual(JSON.parse(form.price_rule), { billing_type: "per_request", unit_price: 3, currency: "POINT", unit_price_by_resolution: { "480p": 5.5, "720p": 8.75 } });
  assert.equal(form.runtime_rule, '{"upstream":{"adapter":"zex_video"}}');
  form.price_rule = '{"billing_type":"per_second","unit_price":0.3,"currency":"POINT"}';
  context.resolutionPriceTiers = ["480p", "768p", "2K"];
  context.setVideoPriceValue("unit_price", 0.4);
  context.setVideoResolutionPrice("480p", 0.1);
  context.setVideoResolutionPrice("768p", 0.2);
  assert.deepEqual(JSON.parse(form.price_rule), { billing_type: "per_second", unit_price: 0.4, currency: "POINT", unit_price_by_resolution: { "480p": 0.1, "768p": 0.2, "2K": 0.3 } });
  context.setVideoPriceValue("unit_price", 0);
  assert.equal(JSON.parse(form.price_rule).unit_price_by_resolution["768p"], 0.2);
});

test("editing Other cases route cost preserves the existing resolution costs", () => {
  const source = ts.createSourceFile("routes.tsx", readFileSync(new URL("../components/ModelRoutesEditor.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "setCostField") declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration);
  let form = { cost_rule: { billing_type: "per_second", unit_cost: 0.075 } };
  const context = { resolutionPriceTiers: ["480p", "768p"], setForm: update => { form = update(form); } };
  vm.runInNewContext(ts.transpileModule(`var ${declaration.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.setCostField("unit_cost", 0.1);
  assert.deepEqual(JSON.parse(JSON.stringify(form.cost_rule)), { billing_type: "per_second", unit_cost: 0.1, unit_cost_by_resolution: { "480p": 0.075, "768p": 0.075 } });
});

test("existing MiniMax models without tier maps expose configurable resolution prices", () => {
  const source = ts.createSourceFile("models.tsx", readFileSync(new URL("../app/admin/models/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "resolutionPriceTiers") declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration);
  for (const identity of [{ model: "minimax-h3" }, { model: "minimax-h3-max" }, { model: "custom-alias", template: "zex_minimax_h3" }, { model: "custom-alias", template: "zex_minimax_h3_max" }]) {
    const context = { form: { category: "video", new_api_model: identity.model, input_schema: '{"properties":{"resolution":{"enum":["480p","768p","2K","auto"]}}}' }, currentPriceRule: { billing_type: "per_second", unit_price: 0.2 }, currentRuntimeRule: { upstream: { adapter: "zex_video" }, template_key: identity.template }, safeParseJson: JSON.parse };
    vm.runInNewContext(ts.transpileModule(`var ${declaration.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    assert.deepEqual(Array.from(context.resolutionPriceTiers), ["480p", "768p", "2K"]);
  }
});

test("native protocols use exact request, poll, media and billing fields", () => {
  const byKey = Object.fromEntries(MULTIMEDIA_TEMPLATES.map((template) => [template.key, template]));
  assert.equal(byKey.newapi_video_json.runtime.upstream.map.first_frame, "image");
  assert.equal(byKey.gateway_video_multipart.runtime.upstream.request_format, "multipart");
  assert.equal(byKey.gateway_video_json.runtime.upstream.request_format, "json");
  assert.equal(byKey.gateway_video_json.runtime.upstream.result_path, undefined);
  assert.equal(byKey.grok_native_video.endpoint, "/v1/videos/generations");
  assert.equal(byKey.grok_native_video.runtime.upstream.response_map.output_seconds, "video.duration");
  assert.equal(byKey.minimax_native_video.runtime.upstream.result_response_map.media_url, "file.download_url");
  assert.equal(byKey.minimax_native_video.runtime.upstream.response_map.error, undefined);
  assert.equal(byKey.vidu_native_image_video.connection.auth_type, "token");
  assert.equal(byKey.vidu_native_image_video.runtime.video.prompt_required, false);
  assert.equal(byKey.vidu_native_image_video.schema.properties.aspect_ratio, undefined);
  assert.equal(byKey.vidu_native_image_video.runtime.upstream.include.includes("aspect_ratio"), false);
  assert.equal(byKey.vidu_native_text_video.runtime.video.prompt_required, true);
  assert.equal(byKey.vidu_reference_image.runtime.image.max_reference_images, 7);
  assert.equal(byKey.vidu_text_audio.billing, "per_second");
  assert.equal(byKey.vidu_text_audio.schema.properties.duration.maximum, 10);
  assert.equal(byKey.wan_native_image_video.runtime.upstream.map.first_frame, "img_url");
  assert.equal(byKey.newapi_audio_speech.schema.properties.speed.type, "number");
  assert.equal(byKey.newapi_minimax_image.model, "image-01");
  assert.equal(byKey.newapi_minimax_image.endpoint, "/v1/images/generations");
  assert.equal(byKey.minimax_native_image.endpoint, "/v1/image_generation");
  assert.equal(byKey.minimax_native_image.defaults.count, 1);
  assert.equal(byKey.minimax_native_image.defaults.aspect_ratio, "1:1");
  assert.equal(byKey.minimax_native_image.defaults.response_format, "url");
  assert.equal(byKey.minimax_native_image.runtime.image.max_reference_images, 0);
  assert.equal(byKey.minimax_native_image.runtime.upstream.map.count, "n");
  assert.deepEqual(byKey.minimax_native_image.runtime.upstream.include, ["count", "aspect_ratio", "seed", "response_format", "prompt_optimizer"]);
  assert.deepEqual(byKey.minimax_native_image.runtime.image.supported_ratios, ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"]);
  assert.equal(byKey.minimax_native_image.runtime.upstream.response_map.media_url, "data.image_urls");
  assert.equal(byKey.minimax_native_image.runtime.upstream.response_map.media_base64, "data.image_base64");
  assert.equal(byKey.minimax_native_image.runtime.upstream.response_map.error, undefined);
  assert.equal(byKey.minimax_native_image.runtime.image.count_max, 9);
  assert.equal(byKey.minimax_native_image.runtime.image.count_allow_custom, true);
  assert.deepEqual(byKey.minimax_native_image.schema.properties.count.enum, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(byKey.grok_native_video.schema.properties.seed, undefined);
  assert.deepEqual(byKey.newapi_audio_speech.schema.required, ["voice"]);
  for (const key of ["newapi_doubao_image", "newapi_qwen_image"]) assert.deepEqual(byKey[key].runtime.upstream.include, []);
});

test("template switches remove owned authentication, headers and response mapping but keep credentials and custom configuration", () => {
  const initial = { new_api_model: "alias", runtime_rule: "{}", new_api_extra_params: JSON.stringify({ connection: { base_url: "https://gateway.test", api_key: "test-key", headers: { "X-Custom": "keep" } } }) };
  const vidu = applyMultimediaTemplate(initial, "vidu_native_text_video");
  assert.equal(JSON.parse(vidu.new_api_extra_params).connection.auth_type, "token");
  const minimax = applyMultimediaTemplate(vidu, "minimax_native_image");
  assert.equal(JSON.parse(minimax.new_api_extra_params).connection.auth_type, "bearer");
  const wan = applyMultimediaTemplate(initial, "wan_native_video");
  const reset = JSON.parse(clearTemplateConnection(wan.new_api_extra_params, wan.runtime_rule));
  assert.deepEqual(reset.connection.headers, { "X-Custom": "keep" });
  assert.equal(reset.connection.base_url, "https://gateway.test");
  assert.equal(reset.connection.api_key, "test-key");
  const edited = JSON.parse(wan.new_api_extra_params);
  edited.connection.headers["X-DashScope-Async"] = "edited";
  assert.equal(JSON.parse(clearTemplateConnection(JSON.stringify(edited), wan.runtime_rule)).connection.headers["X-DashScope-Async"], "edited");
  const runtime = JSON.parse(clearMediaTemplateRuntime(JSON.stringify({ ...JSON.parse(minimax.runtime_rule), reasoning: { default_enabled: true } })));
  for (const key of ["template_key", "upstream", "image", "video", "audio"]) assert.equal(runtime[key], undefined);
  assert.deepEqual(runtime.reasoning, { default_enabled: true });
});

test("actual legacy OpenAI preset clears MiniMax response mapping after a template switch", () => {
  const source = ts.createSourceFile("models.tsx", readFileSync(new URL("../app/admin/models/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let builder;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "buildImageEndpointPreset") builder = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  const context = { MULTIMEDIA_TEMPLATES, applyMultimediaTemplate, clearTemplateConnection, clearModelCaps: clearMediaTemplateRuntime, IMAGE_ENDPOINT_PRESETS: [{ key: "openai_images", endpoint: "/v1/images/generations", model: "gpt-image-1" }], ALIYUN_QWEN_IMAGE_TEMPLATE_KEY: "qwen", safeParseJson: JSON.parse, openAIImageSchema: () => "{}", OPENAI_IMAGE_QUALITIES: ["auto"] };
  vm.runInNewContext(ts.transpileModule(`const build = ${builder.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.current = applyMultimediaTemplate({ new_api_model: "", new_api_extra_params: "{}", runtime_rule: "{}" }, "minimax_native_image");
  const next = vm.runInNewContext('build(current, "openai_images")', context);
  const upstream = JSON.parse(next.runtime_rule).upstream;
  assert.equal(upstream.adapter, "openai_images");
  for (const key of ["response_map", "result_path", "include", "map"]) assert.equal(upstream[key], undefined);
});
