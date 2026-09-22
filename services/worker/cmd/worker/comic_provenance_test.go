package main

import (
	"strings"
	"testing"
)

func TestComicSourcePreservesOriginalAndRejectsInventedQuotes(t *testing.T) {
	source := "\n开场。\n小明进门。\n小红回答：你好。\n"
	inputs := map[string]interface{}{"source_script": source}
	plan := map[string]interface{}{"script": "不能代替用户原文", "storyboards": []interface{}{
		map[string]interface{}{"source_quote": "小明进门"}, map[string]interface{}{"source_quote": "小红回答"},
	}}
	if err := bindComicSource(plan, inputs); err != nil {
		t.Fatal(err)
	}
	var joined strings.Builder
	for _, raw := range comicCollection(plan["storyboards"]) {
		joined.WriteString(mapAnyOr(mapAnyOr(raw, nil)["source"], nil)["text"].(string))
	}
	if joined.String() != source {
		t.Fatal("source was changed or lost")
	}
	shots := comicCollection(plan["storyboards"])
	mapAnyOr(shots[1], nil)["source_quote"] = "模型编造的原文"
	if bindComicSource(plan, inputs) == nil {
		t.Fatal("invented source accepted")
	}
}

func TestComicInputSignatureTracksAssetVersionAndVideoDuration(t *testing.T) {
	asset := map[string]interface{}{"code": "A", "version": 1, "visual_prompt": "红衣"}
	inputs := map[string]interface{}{"comic_assets": []interface{}{asset}}
	shot := map[string]interface{}{"id": "S01", "duration_sec": 5}
	before := comicFrameSignature(inputs, shot, "image")
	asset["version"] = 2
	if before == comicFrameSignature(inputs, shot, "image") {
		t.Fatal("asset version did not invalidate image")
	}
	video := comicVideoInputSignature(inputs, shot, nil, "frame.jpg")
	shot["duration_sec"] = 8
	if video == comicVideoInputSignature(inputs, shot, nil, "frame.jpg") {
		t.Fatal("duration did not invalidate video")
	}
}

func TestComicLegacySignatureAndArchivedVariants(t *testing.T) {
	shot := map[string]interface{}{"id": "S01", "scene": "开场"}
	inputs := map[string]interface{}{"image_model_code": "image"}
	legacy := map[string]interface{}{"id": "S01", "image_url": "old.png", "input_signature": comicFrameSignatureVersion(comicShotInputs(inputs, shot), shot, "image", 0)}
	if comicFramesChanged([]interface{}{legacy}, []map[string]interface{}{shot}, inputs, nil) {
		t.Fatal("upgrade invalidated legacy frame")
	}
	out := map[string]interface{}{}
	archiveComicStage(out, "keyframes", []interface{}{legacy})
	archiveComicStage(out, "keyframes", []interface{}{legacy})
	if len(comicCollection(out["media_history"])) != 1 {
		t.Fatal("duplicate history")
	}
	legacy["image_url"] = "new.png"
	entry := mapAnyOr(comicCollection(out["media_history"])[0], nil)
	if stringAny(mapAnyOr(entry["item"], nil)["image_url"]) != "old.png" {
		t.Fatal("history was mutated")
	}
}
