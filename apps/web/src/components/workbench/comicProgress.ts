export function comicAssetProgress(outputs: Record<string, any>, error = "") {
  const assets: Record<string, any>[] = Array.isArray(outputs.consistency_assets) ? outputs.consistency_assets : [];
  const shots: Record<string, any>[] = outputs.comic_drama?.storyboards || [];
  const codes = new Set(shots.flatMap(shot => [
    ...(Array.isArray(shot.character_codes) ? shot.character_codes : []),
    ...(Array.isArray(shot.prop_codes) ? shot.prop_codes : []), shot.location_code,
  ]).filter(Boolean));
  const failed = assets.filter(asset => asset.status === "failed" || asset.error_message);
  const completed = assets.filter(asset => asset.status !== "failed" && !asset.error_message && asset.metadata?.reference_urls?.length).length;
  return {
    total: Number(outputs.consistency_asset_count) || codes.size || assets.length,
    completed, failed,
    step: /资产定稿失败/.test(error) ? "consistency_assets" : String(outputs.current_step || ""),
  };
}
