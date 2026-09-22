import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const landing = fs.readFileSync(new URL("./LandingPageClient.tsx", import.meta.url), "utf8");
const shell = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const agent = fs.readFileSync(new URL("./workbench/AgentWorkspace.tsx", import.meta.url), "utf8");
const nextConfig = fs.readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
const middleware = fs.readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");

test("home entry navigates without a redundant profile request", () => {
  const handler = landing.slice(landing.indexOf("const enterAppOrLogin"), landing.indexOf("useEffect", landing.indexOf("const enterAppOrLogin")));
  assert.match(handler, /router\.push\("\/app"\)/);
  assert.doesNotMatch(handler, /\/api\/me/);
});

test("agent workspaces preload code and reuse metadata requests", () => {
  assert.match(shell, /onPointerEnter=\{\(\) => preloadAgentWorkspace\(a\.code\)\}/);
  assert.match(agent, /apiForLocaleCached<Workflow>/);
  assert.match(agent, /apiForLocaleCached<Model>/);
});

test("the public home page remains CDN-cacheable", () => {
  assert.doesNotMatch(nextConfig, /source:\s*"\/"\s*,/);
  assert.doesNotMatch(middleware, /matcher:\s*\[\s*"\/"\s*,/);
});
