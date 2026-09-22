import assert from "node:assert/strict";
import test from "node:test";
import { detectGalleryLanguage, filterReferenceCases, galleryLanguageLabel, isReferenceGalleryManifest, randomReferenceCases, REFERENCE_MANIFEST_URL, referenceImageURL, referenceTagEntries, referenceTaxonomyLabel } from "./galleryReference.ts";

const items = [
  { id: 1, title: "城市海报", image: "/images/case1.jpg", prompt: "blue city", category: "Poster", styles: ["Illustration"], scenes: ["Travel"] },
  { id: 2, title: "商品摄影", image: "/images/case2.jpg", prompt: "studio bottle", category: "Commerce", styles: ["Realistic"], scenes: ["Product"] },
];

test("reference gallery filters combine taxonomy and search", () => {
  assert.deepEqual(
    filterReferenceCases(items, { query: "city", category: "Poster", style: "Illustration", scene: "Travel" }).map((item) => item.id),
    [1],
  );
  assert.equal(filterReferenceCases(items, { query: "", category: "Poster", style: "Realistic", scene: "all" }).length, 0);
  assert.deepEqual(filterReferenceCases(items, { query: "", category: "all", style: "all", scene: "all", language: "latin" }).map((item) => item.id), [1, 2]);
});

test("reference image paths resolve to the upstream data directory", () => {
  assert.match(REFERENCE_MANIFEST_URL, /\/data\/cases\.json$/);
  assert.equal(
    referenceImageURL("/images/case1.jpg"),
    "https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/images/case1.jpg",
  );
});

test("reference manifest rejects the style-library taxonomy shape", () => {
  assert.equal(isReferenceGalleryManifest({ categories: [{ value: "Poster" }], styles: [], scenes: [], cases: [] }), false);
  assert.equal(isReferenceGalleryManifest({ categories: ["Poster"], styles: ["Realistic"], scenes: ["Commerce"], cases: items }), true);
});

test("gallery language and taxonomy labels follow the active locale", () => {
  assert.equal(detectGalleryLanguage("请生成一张产品海报"), "zh");
  assert.equal(detectGalleryLanguage("Create a product poster"), "latin");
  assert.equal(detectGalleryLanguage("夏のポスターを作る"), "ja");
  assert.equal(detectGalleryLanguage("제품 포스터 만들기"), "ko");
  assert.equal(referenceTaxonomyLabel("Products & E-commerce", "zh-CN"), "商品与电商");
  assert.equal(referenceTaxonomyLabel("Products & E-commerce", "en-US"), "Products & E-commerce");
  assert.equal(galleryLanguageLabel("ja", "ko-KR"), "일본어");
});

test("style and scene tags keep unique render keys when labels overlap", () => {
  const entries = referenceTagEntries({ styles: ["History"], scenes: ["History"] });
  assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length);
});

test("landing reference selection returns unique cases without mutating the catalog", () => {
  const original = items.map((item) => item.id);
  const selected = randomReferenceCases(items, 2, () => 0.75);
  assert.equal(selected.length, 2);
  assert.equal(new Set(selected.map((item) => item.id)).size, 2);
  assert.deepEqual(items.map((item) => item.id), original);
});
