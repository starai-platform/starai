import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as translations from "./translation.ts";
import * as builtins from "./builtins.ts";

const source = ts.createSourceFile("provider.tsx", readFileSync(new URL("./I18nProvider.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const code = source.statements.filter(ts.isFunctionDeclaration).map((node) => node.getText(source).replace(/^export /, "")).join("\n");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// Run the real provider with controlled dictionary/config timing and tiny hook stubs.
function provider({ config = Promise.resolve({ default_locale: "en-US" }), load = async () => {}, user = null } = {}) {
  const state = [], memo = [], refs = [], effects = [];
  let cursor = 0, scheduled = [];
  const storage = new Map(), events = [], patches = [];
  const auth = { user, hydrate() {} };
  const store = (select) => select(auth);
  store.getState = () => auth;
  const memoize = (fn, deps) => {
    const index = cursor++;
    const old = memo[index];
    if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) memo[index] = { deps, value: fn() };
    return memo[index].value;
  };
  const ctx = {
    ...translations, ...builtins, console,
    DEFAULT_UI_LANGUAGES: ["zh-CN", "en-US", "ja-JP", "ko-KR", "vi-VN"].map((code) => ({ code, short: code, name: code, enabled: true })),
    SUPPORTED_UI_LOCALES: ["zh-CN", "en-US", "ja-JP", "ko-KR", "vi-VN"],
    dictionaries: { "zh-CN": {}, "en-US": {} }, sourceTranslations: {},
    I18nContext: { Provider: "provider" },
    React: { createElement: (_, props) => props.value },
    useAuthStore: store, loadLocaleDictionaries: load,
    apiCached: () => config, api: async (_, options) => { patches.push(JSON.parse(options.body)); return {}; },
    hasUserSession: () => true,
    useState: (initial) => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value) => { state[index] = value; }]; },
    useRef: (value) => { const index = cursor++; return refs[index] ||= { current: value }; },
    useCallback: (fn, deps) => memoize(() => fn, deps), useMemo: memoize,
    useEffect: (fn, deps) => {
      const index = cursor++, old = effects[index];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        scheduled.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: fn() }; });
      }
    },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    navigator: { language: "zh-CN" }, document: { documentElement: {} },
    window: { dispatchEvent: (event) => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  const render = () => { cursor = 0; scheduled = []; const value = ctx.I18nProvider({ children: null }); scheduled.forEach((fn) => fn()); return value; };
  return { render, storage, events, patches, ctx };
}

test("default and profile locale initialization also set the language used by API requests", async () => {
  for (const user of [null, { locale: "ja-JP" }]) {
    const app = provider({ user });
    app.render();
    await flush();
    const current = app.render();
    const expected = user?.locale || "en-US";
    assert.equal(current.locale, expected);
    assert.equal(app.storage.get("site_locale"), expected);
    assert.equal(app.ctx.document.documentElement.lang, expected);
  }
});

test("rapid language changes commit only the latest loaded dictionary", async () => {
  const requests = new Map(["ja-JP", "ko-KR"].map((locale) => [locale, deferred()]));
  const app = provider({ load: (locale) => requests.get(locale)?.promise || Promise.resolve() });
  app.render(); await flush();
  const current = app.render();
  current.setLocale("ja-JP"); current.setLocale("ko-KR");
  assert.equal(app.storage.get("site_locale"), "en-US", "headers stay aligned with the visible UI while loading");
  requests.get("ko-KR").resolve(); await flush();
  requests.get("ja-JP").resolve(); await flush();
  assert.equal(app.render().locale, "ko-KR");
  assert.equal(app.storage.get("site_locale"), "ko-KR");
  assert.deepEqual(app.patches, [{ locale: "ko-KR" }]);
  assert.equal(app.events.length, 1);
});

test("late configuration cannot override a manual selection; failed dictionary resets headers too", async () => {
  const config = deferred(), dictionary = deferred();
  const app = provider({ config: config.promise, load: (locale) => locale === "ja-JP" ? dictionary.promise : Promise.resolve() });
  app.render().setLocale("ja-JP");
  config.resolve({ default_locale: "en-US" }); await flush();
  dictionary.resolve(); await flush();
  assert.equal(app.render().locale, "ja-JP");
  const failed = provider({ load: (locale) => locale === "ko-KR" ? Promise.reject(new Error("chunk unavailable")) : Promise.resolve() });
  failed.render(); await flush();
  failed.render().setLocale("ko-KR"); await flush();
  assert.equal(failed.render().locale, "zh-CN");
  assert.equal(failed.storage.get("site_locale"), "zh-CN");
  assert.deepEqual(failed.patches, []);
});
