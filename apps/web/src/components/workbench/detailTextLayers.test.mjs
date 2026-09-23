import assert from "node:assert/strict";
import test from "node:test";
import { chooseDetailLayerTop, mergeDetailTextLayers, normalizeDetailTextLayers } from "./detailTextLayers.ts";

test("free detail plans allow no text and keep arbitrary phrasing", () => {
  assert.deepEqual(normalizeDetailTextLayers([]), []);
  const layers = normalizeDetailTextLayers([{ text: "让风穿过每一步", x: 0.12, y: 0.66, width: 0.7, font_size: 0.08, color: "#FFFFFF" }]);
  assert.equal(layers[0].text, "让风穿过每一步");
  assert.equal(layers[0].x, 0.12);
  assert.equal(layers[0].background, undefined);
});

test("copy and layout revisions change only their selected dimension", () => {
  const old = normalizeDetailTextLayers([{ text: "旧文案", x: 0.1, y: 0.7, width: 0.8, font_size: 0.05, color: "#FFFFFF" }]);
  const next = normalizeDetailTextLayers([{ text: "新文案", x: 0.25, y: 0.2, width: 0.5, font_size: 0.09, color: "#123456" }]);
  assert.equal(mergeDetailTextLayers(old, next, "copy")[0].x, 0.1);
  assert.equal(mergeDetailTextLayers(old, next, "copy")[0].text, "新文案");
  assert.equal(mergeDetailTextLayers(old, next, "layout")[0].text, "旧文案");
  assert.equal(mergeDetailTextLayers(old, next, "layout")[0].x, 0.25);
  assert.deepEqual(mergeDetailTextLayers(old, [], "copy"), []);
});

test("overlapping text cards move apart without changing their copy", () => {
  const top = chooseDetailLayerTop(80, 180, 420, 100, 12, 1254, 1254, [{ x: 80, y: 120, width: 420, height: 160 }]);
  assert.ok(top >= 290);
});
