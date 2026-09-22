const adapterTypes: Record<string, string> = {
  aliyun_qwen_image_v3: "aliyun_qwen_image_v3",
  openai_images: "openai_images",
  otuapi_image: "otuapi_images",
  otuapi_banana_image: "banana_async",
};

export function imageInterfaceType(runtime: Record<string, any>, endpoint: string, model: string): string {
  if (runtime.image?.interface_type) return String(runtime.image.interface_type);
  const adapter = String(runtime.upstream?.adapter || "");
  if (adapter) return adapterTypes[adapter] || "custom";
  // Older models did not store an explicit interface type.
  if (endpoint === "/v1/videos" && model.startsWith("nano_banana")) return "banana_async";
  if (endpoint === "/v1/videos" && model.startsWith("gpt-image-2")) return "otuapi_images_async";
  if (endpoint === "/v1/images/generations") return "otuapi_images";
  return "custom";
}

export function withImageInterfaceType(runtime: Record<string, any>, type: string): string {
  return JSON.stringify({ ...runtime, image: { ...runtime.image, interface_type: type } }, null, 2);
}
