package main

import (
	"strings"
	"testing"
)

func TestReferenceImageURLsPreservesAndDeduplicatesComicReferences(t *testing.T) {
	inputs := map[string]interface{}{
		"image_url":        "https://cdn.example/character.png",
		"reference_images": []interface{}{"https://cdn.example/character.png", "https://cdn.example/prop.png"},
		"comic_style":      map[string]interface{}{"cover_url": "https://cdn.example/style.png"},
	}
	got := referenceImageURLs(inputs)
	want := []string{"https://cdn.example/character.png", "https://cdn.example/style.png", "https://cdn.example/prop.png"}
	if len(got) != len(want) {
		t.Fatalf("reference count=%d, want %d: %#v", len(got), len(want), got)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("reference[%d]=%q, want %q", index, got[index], want[index])
		}
	}
}

func TestComicStoryboardsInjectsLinkedAssetPrompts(t *testing.T) {
	plan := map[string]interface{}{
		"characters": []interface{}{map[string]interface{}{"code": "CHAR_01", "visual_prompt": "red-haired heroine"}},
		"props":      []interface{}{map[string]interface{}{"code": "PROP_01", "visual_prompt": "silver compass"}},
		"locations":  []interface{}{map[string]interface{}{"code": "LOC_01", "visual_prompt": "rainy old station"}},
		"storyboards": []interface{}{map[string]interface{}{
			"id": "S01", "scene": "departure", "character_codes": []interface{}{"CHAR_01"},
			"prop_codes": []interface{}{"PROP_01"}, "location_code": "LOC_01",
		}},
	}
	items := comicStoryboards(plan, map[string]interface{}{})
	if len(items) != 1 {
		t.Fatalf("storyboard count=%d", len(items))
	}
	prompt := stringAny(items[0]["keyframe_prompt"])
	for _, expected := range []string{"red-haired heroine", "silver compass", "rainy old station"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("keyframe prompt does not contain %q: %s", expected, prompt)
		}
	}
}

func TestComicScoresDoNotPretendQualityWasChecked(t *testing.T) {
	scores := comicPassScores(map[string]interface{}{"asset_consistency_score": 80, "logic_score": 50}, map[string]interface{}{})
	if checked, _ := scores["checked"].(bool); checked {
		t.Fatal("quality score must not be marked checked without a judge model")
	}
	if _, exists := scores["asset_consistency"]; exists {
		t.Fatal("synthetic asset consistency score must not be returned")
	}
}
