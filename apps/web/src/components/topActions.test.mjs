import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("quick menu dismisses outside pointer events without swallowing the next click", () => {
  const source = ts.createSourceFile("menu.tsx", read("./WorkbenchUserMenu.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.getText(source).includes('"pointerdown"')) effect = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(effect);
  const listeners = new Map();
  const trigger = {}, panelChild = {}, otherButton = {};
  let open = true, cleanup, focused = false;
  const context = {
    open,
    triggerRef: { current: { contains: (node) => node === trigger, focus: () => { focused = true; } } },
    panelRef: { current: { contains: (node) => node === panelChild } },
    setOpen: (value) => { open = value; },
    useEffect: (fn) => { cleanup = fn(); },
    document: {
      addEventListener: (name, fn, capture) => listeners.set(name, { fn, capture }),
      removeEventListener: (name, fn, capture) => {
        assert.equal(listeners.get(name).fn, fn);
        assert.equal(listeners.get(name).capture, capture);
        listeners.delete(name);
      },
    },
  };
  vm.runInNewContext(ts.transpileModule(effect, {}).outputText, context);
  const pointer = listeners.get("pointerdown");
  assert.equal(pointer.capture, true, "must run before sibling stopPropagation handlers");
  pointer.fn({ target: trigger });
  assert.equal(open, true, "trigger toggles via its own click");
  pointer.fn({ target: panelChild });
  assert.equal(open, true, "portalled panel remains interactive");
  // No preventDefault/stopPropagation methods: attempting to consume the event fails.
  pointer.fn({ target: otherButton });
  assert.equal(open, false);
  open = true;
  listeners.get("keydown").fn({ key: "Escape" });
  assert.equal(open, false);
  assert.equal(focused, true);
  cleanup();
  assert.equal(listeners.size, 0);
  assert.doesNotMatch(read("./WorkbenchUserMenu.tsx"), /fixed inset-0[^"\n]*bg-transparent/);
});

test("top actions keep stable children and stay above the agent title bar", () => {
  const shell = read("./AppShell.tsx");
  assert.doesNotMatch(shell, /<(?:MobileTopBar|DesktopQuickActions)\b/);
  assert.match(shell, /renderDesktopQuickActions\(\)/);
  assert.match(shell, /absolute right-5 top-4 z-40/);
  for (const file of ["./NotificationBell.tsx", "./UILanguageSelector.tsx", "./workbench/ModelWorkspace.tsx"]) {
    assert.match(read(file), /addEventListener\("pointerdown", \w+, true\)/);
  }
});
