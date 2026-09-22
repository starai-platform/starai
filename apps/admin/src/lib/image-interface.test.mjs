import assert from "node:assert/strict";
import test from "node:test";
import { imageInterfaceType, withImageInterfaceType } from "./image-interface.ts";

test("image interface survives endpoint edits and a saved custom selection", () => {
  const runtime = { upstream: { adapter: "otuapi_image", poll_path: "/v1/videos/{id}" }, image: { max_reference_images: 4 } };
  for (const endpoint of ["/v1/images/generations", "/v1/videos", "/custom/image"]) {
    assert.equal(imageInterfaceType(runtime, endpoint, "gpt-image-2"), "otuapi_images");
  }
  const custom = JSON.parse(withImageInterfaceType(runtime, "custom"));
  assert.equal(imageInterfaceType(custom, "/v1/images/generations", "gpt-image-2"), "custom");
  assert.deepEqual(custom.upstream, runtime.upstream);
  assert.equal(custom.image.max_reference_images, 4);
  const async = JSON.parse(withImageInterfaceType(custom, "otuapi_images_async"));
  assert.equal(imageInterfaceType(async, "/custom/tasks", "gpt-image-2"), "otuapi_images_async");
  assert.equal(imageInterfaceType({ upstream: { adapter: "otuapi_banana_image" } }, "/custom/tasks", "nano_banana_2"), "banana_async");
  assert.equal(imageInterfaceType({ upstream: { adapter: "unknown" } }, "/v1/images/generations", "model"), "custom");
  assert.equal(imageInterfaceType({}, "/v1/videos", "gpt-image-2"), "otuapi_images_async");
  assert.equal(imageInterfaceType({}, "/custom/tasks", "model"), "custom");
});
