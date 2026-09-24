import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { translateBuiltinSource, sourceTranslationKey, interpolate } from "./translation.ts";
import zh from "./locales/zh-CN.ts";
import en from "./locales/en-US.ts";
import ja from "./locales/ja-JP.ts";
import ko from "./locales/ko-KR.ts";
import vi from "./locales/vi-VN.ts";
import enSource from "./source-locales/en-US.ts";
import jaSource from "./source-locales/ja-JP.ts";
import koSource from "./source-locales/ko-KR.ts";
import viSource from "./source-locales/vi-VN.ts";
import enAgentWorkspace from "./source-locales/supplements/en-US/agentWorkspace.ts";
import jaAgentWorkspace from "./source-locales/supplements/ja-JP/agentWorkspace.ts";
import koAgentWorkspace from "./source-locales/supplements/ko-KR/agentWorkspace.ts";
import viAgentWorkspace from "./source-locales/supplements/vi-VN/agentWorkspace.ts";
import enCommerceVideo from "./source-locales/supplements/en-US/commerceVideo.ts";
import jaCommerceVideo from "./source-locales/supplements/ja-JP/commerceVideo.ts";
import koCommerceVideo from "./source-locales/supplements/ko-KR/commerceVideo.ts";
import viCommerceVideo from "./source-locales/supplements/vi-VN/commerceVideo.ts";

test("every locale covers canonical keys and preserves named variables", () => {
  const variables = (text) => [...new Set(text.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) || [])].sort();
  for (const [locale, dictionary] of Object.entries({ en, ja, ko, vi })) {
    for (const [key, source] of Object.entries(zh)) {
      assert.ok(dictionary[key]?.trim(), `missing ${locale} translation: ${key}`);
      assert.deepEqual(variables(dictionary[key]), variables(source), `changed ${locale} variables: ${key}`);
    }
  }
});

test("source lookup preserves direct, first duplicate and English fallback priorities", () => {
  const dictionaries = { "zh-CN": { first: "原文", second: "原文", other: "其他" }, "en-US": { first: "First", second: "Second", other: "Other" }, "ja-JP": { first: "日本語" } };
  assert.equal(translateBuiltinSource("原文", "ja-JP", dictionaries, {}), "日本語");
  assert.equal(translateBuiltinSource("其他", "ja-JP", dictionaries, {}), "Other");
  assert.equal(translateBuiltinSource("原文", "ja-JP", dictionaries, { "ja-JP": { 原文: "Direct" } }), "Direct");
  assert.equal(translateBuiltinSource("原文", "ko-KR", dictionaries, {}), "First");
  assert.equal(translateBuiltinSource("unknown", "ko-KR", dictionaries, {}), "");
  assert.equal(interpolate("{count} items for {name}", { name: "A", count: 2 }), "2 items for A");
  assert.equal(sourceTranslationKey("你好"), "source.d7bc7166");
});

test("virtual try-on direct UI text has reviewed translations in every supported locale", () => {
  const sources = { "en-US": enSource, "ja-JP": jaSource, "ko-KR": koSource, "vi-VN": viSource };
  for (const [locale, dictionary] of Object.entries(sources)) {
    for (const key of ["AI 视觉试穿", "人物照片", "服装图片", "试穿完成", "试穿结果 {count}"]) {
      assert.ok(dictionary[key]?.trim(), `missing ${locale} source translation: ${key}`);
    }
  }
});

test("agent and canvas built-in content has reviewed translations in every supported locale", () => {
  const sources = { "en-US": enSource, "ja-JP": jaSource, "ko-KR": koSource, "vi-VN": viSource };
  for (const [locale, dictionary] of Object.entries(sources)) {
    for (const key of ["Agent 通用智能体", "Agent 模式", "AI 漫剧 - S2.0", "意图分析", "剧本与分镜", "分镜规划", "长视频规划", "韩剧审美", "文字生图片", "文本提示词连接图片生成节点", "Agent 通用智能体玩法说明", "返回对话（工作流继续运行）"]) {
      assert.ok(dictionary[key]?.trim(), `missing ${locale} agent/canvas translation: ${key}`);
    }
  }
});

test("commerce, photo, product, novel and try-on workspaces have direct translations", () => {
  const sources = { "en-US": enSource, "ja-JP": jaSource, "ko-KR": koSource, "vi-VN": viSource };
  const keys = [
    "电商带货短视频",
    "AI写真馆",
    "商品图精修",
    "AI小说工坊",
    "AI试衣间",
    "从资产库选择图片",
    "上传原图，说出想改的地方。",
    "修改大纲",
    "试衣模型",
  ];
  for (const [locale, dictionary] of Object.entries(sources)) {
    for (const key of keys) {
      assert.ok(dictionary[key]?.trim(), `missing ${locale} workspace translation: ${key}`);
      assert.notEqual(dictionary[key], key, `untranslated ${locale} workspace text: ${key}`);
    }
  }
});

test("e-commerce image and video workspace supplements stay in sync", () => {
  for (const group of [
    { en: enAgentWorkspace, ja: jaAgentWorkspace, ko: koAgentWorkspace, vi: viAgentWorkspace },
    { en: enCommerceVideo, ja: jaCommerceVideo, ko: koCommerceVideo, vi: viCommerceVideo },
  ]) {
    const expected = Object.keys(group.en).sort();
    for (const [locale, dictionary] of Object.entries(group)) {
      assert.deepEqual(Object.keys(dictionary).sort(), expected, `unsynced ${locale} commerce workspace translations`);
      for (const key of expected) assert.ok(dictionary[key]?.trim(), `empty ${locale} commerce workspace translation: ${key}`);
    }
  }
});

test("target workspaces do not render raw Chinese JSX text", () => {
  const files = [
    "../components/workbench/AgentWorkspace.tsx",
    "../components/workbench/PhotoStudioLanding.tsx",
    "../components/workbench/PhotoPlayGuide.tsx",
    "../components/workbench/ProductRefineWorkspace.tsx",
    "../components/workbench/ProductRegionEditor.tsx",
    "../components/workbench/NovelWorkshopLanding.tsx",
    "../components/workbench/NovelPlayGuide.tsx",
    "../components/workbench/NovelChapterList.tsx",
    "../components/workbench/VirtualTryOnLanding.tsx",
    "../components/workbench/TryOnPlayGuide.tsx",
    "../app/app/agents/[code]/page.tsx",
  ];
  for (const relative of files) {
    const url = new URL(relative, import.meta.url);
    const sourceText = fs.readFileSync(url, "utf8");
    const source = ts.createSourceFile(url.pathname, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const findings = [];
    const visit = (node) => {
      if (ts.isJsxText(node) && /[\u3400-\u9fff\uf900-\ufaff]/.test(node.text.trim())) findings.push(node.text.trim());
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.deepEqual(findings, [], `raw Chinese JSX in ${relative}: ${findings.join(" | ")}`);
  }
});
