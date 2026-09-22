package main

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/starai/worker/internal/storage"
)

func TestComicCompositionTimeline(t *testing.T) {
	storyboards := []map[string]interface{}{{"id": "S01", "duration_sec": 4}, {"id": "S02", "duration_sec": 8}}
	segments := []interface{}{map[string]interface{}{"id": "S02", "video_url": "second.mp4"}, map[string]interface{}{"id": "S01", "video_url": "first.mp4"}}
	narrations := []interface{}{map[string]interface{}{"id": "S02", "audio_url": "second.m4a", "duration_sec": 8}}
	video, audio, err := comicCompositionTimeline(storyboards, segments, narrations, 18)
	if err != nil {
		t.Fatal(err)
	}
	for i, duration := range []float64{6, 12} {
		v, a := video[i].(map[string]interface{}), audio[i].(map[string]interface{})
		if v["id"] != storyboards[i]["id"] || a["id"] != v["id"] || v["duration_sec"] != duration || a["duration_sec"] != duration {
			t.Fatalf("misaligned timeline: %v / %v", video, audio)
		}
	}
	if stringAny(audio[0].(map[string]interface{})["audio_url"]) != "" {
		t.Fatal("missing narration must remain a silent slot")
	}
	if segments[0].(map[string]interface{})["duration_sec"] != nil || narrations[0].(map[string]interface{})["duration_sec"] != 8 {
		t.Fatal("composition modified source checkpoints")
	}
	if _, _, err := comicCompositionTimeline(storyboards, segments[:1], nil, 16); err == nil {
		t.Fatal("missing video must fail instead of silently dropping a shot")
	}
}

func TestComicModelAwarePlanAndExecutionDuration(t *testing.T) {
	for _, grid := range []int{1, 2, 3, 5, 6, 10} {
		inputs := map[string]interface{}{"storyboard_grid": grid, "segment_duration_sec": 8, "target_duration_sec": grid*8 - 1}
		validShots := []interface{}{}
		for i := 0; i < grid; i++ {
			validShots = append(validShots, map[string]interface{}{"id": fmt.Sprintf("S%02d", i+1), "scene": fmt.Sprintf("剧情画面%d", i+1)})
		}
		plan := normalizeComicDramaPlan(map[string]interface{}{"storyboards": validShots}, inputs, nil)
		shots := comicStoryboards(plan, nil)
		if len(shots) != grid {
			t.Fatalf("got %d shots, want %d", len(shots), grid)
		}
		for _, shot := range shots {
			if shot["duration_sec"] != 8 {
				t.Fatalf("duration overwritten: %v", shot)
			}
		}
	}
	schema := map[string]interface{}{"properties": map[string]interface{}{"duration": map[string]interface{}{"enum": []interface{}{"4s", "8s"}}}}
	if got, err := comicSupportedVideoDuration(schema, 7); err != nil || got != "8s" {
		t.Fatalf("unsupported segment not rounded upward: %v %v", got, err)
	}
	if _, err := comicSupportedVideoDuration(schema, 15); err == nil {
		t.Fatal("oversized segment must not silently use 8 seconds")
	}
	if _, err := comicSupportedVideoDuration(nil, 5); err == nil {
		t.Fatal("missing schema must not assume a capability")
	}
}

func TestComicCompositionPreservesEveryShotAtTargetDuration(t *testing.T) {
	ffmpeg, err := ffmpegBinaryPath()
	if err != nil {
		t.Skipf("ffmpeg unavailable: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	dir := t.TempDir()
	server := httptest.NewServer(http.FileServer(http.Dir(dir)))
	defer server.Close()
	store, err := storage.NewLocal(dir, server.URL)
	if err != nil {
		t.Fatal(err)
	}
	previous := objectStore
	objectStore = store
	t.Cleanup(func() { objectStore = previous })
	storyboards, segments, narrations := []map[string]interface{}{}, []interface{}{}, []interface{}{}
	colors := []string{"red", "blue", "green", "yellow"}
	for i, color := range colors {
		id, name := fmt.Sprintf("S%02d", i+1), fmt.Sprintf("source_%d.mp4", i)
		duration := 8
		if i == 2 {
			duration = 1 // Exercise tail-frame padding as well as trimming.
		}
		args := []string{"-y", "-f", "lavfi", "-i", fmt.Sprintf("color=c=%s:s=160x90:r=30:d=%d", color, duration)}
		if i%2 == 0 {
			args = append(args, "-f", "lavfi", "-i", "sine=frequency=880", "-shortest", "-c:a", "aac")
		}
		args = append(args, "-c:v", "libx264", "-pix_fmt", "yuv420p", filepath.Join(dir, name))
		if err := runFFmpeg(ctx, args...); err != nil {
			t.Fatal(err)
		}
		storyboards = append(storyboards, map[string]interface{}{"id": id, "duration_sec": 4})
		segments = append(segments, map[string]interface{}{"id": id, "video_url": server.URL + "/" + name})
		narrations = append(narrations, map[string]interface{}{"id": id, "audio_url": server.URL + "/voice.m4a", "duration_sec": 4})
	}
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac", filepath.Join(dir, "voice.m4a")); err != nil {
		t.Fatal(err)
	}
	for _, target := range []int{16, 22} {
		t.Run(strconv.Itoa(target), func(t *testing.T) {
			var voices []interface{}
			inputs := map[string]interface{}{"target_duration_sec": target}
			if target == 22 {
				voices = narrations
				inputs["aspect_ratio"] = "9:16"
				inputs["orientation"] = "portrait"
			}
			final, errMsg := composeComicDramaVideo(ctx, nil, "test", storyboards, segments, voices, inputs, nil, "", "", WorkflowTaskPayload{})
			if errMsg != "" {
				t.Fatal(errMsg)
			}
			path := filepath.Join(dir, filepath.FromSlash(store.ObjectKeyFromURL(stringAny(final["final_video_url"]))))
			probe := filepath.Join(filepath.Dir(ffmpeg), ffprobeExecutableName())
			data, err := exec.CommandContext(ctx, probe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path).Output()
			if err != nil {
				t.Fatal(err)
			}
			duration, err := strconv.ParseFloat(strings.TrimSpace(string(data)), 64)
			if err != nil || math.Abs(duration-float64(target)) > 0.1 {
				t.Fatalf("duration %s, want %d seconds", data, target)
			}
			width, height := probeMediaDimensions(ctx, path)
			if target == 22 && (width != 90 || height != 160 || stringAny(final["aspect_ratio"]) != "9:16") {
				t.Fatalf("portrait contract not enforced: %dx%d output=%#v", width, height, final)
			}
			for i, want := range [][3]byte{{255, 0, 0}, {0, 0, 255}, {0, 128, 0}, {255, 255, 0}} {
				at := float64(target) * (float64(i) + 0.75) / 4
				pixel, err := exec.CommandContext(ctx, ffmpeg, "-v", "error", "-ss", fmt.Sprintf("%.3f", at), "-i", path, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1").Output()
				if err != nil || len(pixel) != 3 {
					t.Fatalf("read shot %d: %v (%v)", i+1, err, pixel)
				}
				for channel := range want {
					if math.Abs(float64(pixel[channel])-float64(want[channel])) > 25 {
						t.Fatalf("shot %d at %.3fs: RGB %v, want %v", i+1, at, pixel, want)
					}
				}
			}
			if !mediaHasAudio(ctx, path) {
				t.Fatal("composed audio is missing")
			}
		})
	}
}

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

func TestReferenceImageURLsDropsRelativeStyleCover(t *testing.T) {
	inputs := map[string]interface{}{
		"image_url":   "https://cdn.example/keyframe.png",
		"comic_style": map[string]interface{}{"cover_url": "/assets/comic-styles/cn-ancient.svg"},
	}
	got := referenceImageURLs(inputs)
	if len(got) != 1 || got[0] != "https://cdn.example/keyframe.png" {
		t.Fatalf("relative style cover leaked into upstream references: %#v", got)
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

func TestComicStoryboardsDoesNotDuplicateAssetContext(t *testing.T) {
	plan := map[string]interface{}{
		"characters": []interface{}{map[string]interface{}{"code": "CHAR_01", "visual_prompt": "heroine"}},
		"storyboards": []interface{}{map[string]interface{}{
			"id": "S01", "character_codes": []interface{}{"CHAR_01"},
		}},
	}
	first := comicStoryboards(plan, map[string]interface{}{})
	plan["storyboards"] = []interface{}{first[0]}
	second := comicStoryboards(plan, map[string]interface{}{})
	if count := strings.Count(stringAny(second[0]["video_prompt"]), "CONSISTENCY ASSETS:"); count != 1 {
		t.Fatalf("asset context count=%d, want 1: %s", count, stringAny(second[0]["video_prompt"]))
	}
}

func TestComicPlanBindsCharacterGenderToVoice(t *testing.T) {
	plan := map[string]interface{}{
		"characters": []interface{}{map[string]interface{}{
			"code": "CHAR_01", "name": "新闻主播", "description": "三十多岁的男性主持人",
		}},
		"storyboards": []interface{}{map[string]interface{}{
			"id": "S01", "scene": "主播播报新闻", "character_codes": []interface{}{"CHAR_01"}, "narration": "今日要闻。",
		}},
	}
	normalized := normalizeComicDramaPlan(plan, map[string]interface{}{"storyboard_grid": 1}, nil)
	shot := comicStoryboards(normalized, nil)[0]
	if shot["voice_character_code"] != "CHAR_01" || shot["speaker_gender"] != "male" {
		t.Fatalf("speaker metadata missing: %#v", shot)
	}
	schema := map[string]interface{}{"properties": map[string]interface{}{"voice": map[string]interface{}{
		"enum":             []interface{}{"female_voice", "male_voice"},
		"x-option-genders": map[string]interface{}{"female_voice": "female", "male_voice": "male"},
	}}}
	key, voice, ok := comicVoiceForGender(schema, stringAny(shot["speaker_gender"]))
	if !ok || key != "voice" || voice != "male_voice" {
		t.Fatalf("male character selected wrong voice: %q %q %v", key, voice, ok)
	}
}

func TestComicRequestedAspectRatioUsesExplicitRatio(t *testing.T) {
	for _, input := range []map[string]interface{}{
		{"aspect_ratio": "9:16", "orientation": "landscape"},
		{"ratio": "9:16"},
		{"orientation": "vertical"},
	} {
		if got := comicRequestedAspectRatio(input, nil); got != "9:16" {
			t.Fatalf("aspect=%q for %#v", got, input)
		}
	}
	for _, input := range []map[string]interface{}{
		{"prompt": "8秒竖屏抖音视频"},
		{"generation_prompt": "画幅比例：9:16（竖屏）"},
		{"comic_project_description": "输出分辨率1080x1920"},
	} {
		if got := comicRequestedAspectRatio(input, map[string]interface{}{"aspect_ratio": "16:9"}); got != "9:16" {
			t.Fatalf("prompt aspect=%q for %#v", got, input)
		}
	}
}

func TestComicVideoReferenceModeMatchesAdapterContract(t *testing.T) {
	veo := map[string]interface{}{
		"video":    map[string]interface{}{"upload_profile": "veo_reference"},
		"upstream": map[string]interface{}{"adapter": "veo_reference_v1"},
	}
	if got := comicVideoReferenceMode(veo); got != "reference" {
		t.Fatalf("Veo keyframe mode=%q, want reference", got)
	}
	if got := comicVideoReferenceMode(map[string]interface{}{"video": map[string]interface{}{"upload_profile": "seedance_2"}}); got != "image" {
		t.Fatalf("Seedance keyframe mode=%q, want image", got)
	}
}

func TestComicCheckpointsRequireTheCurrentMediaContract(t *testing.T) {
	video := map[string]interface{}{
		"video_url": "https://example.test/shot.mp4", "status": "succeeded",
		"model_code": "veo", "aspect_ratio": "9:16", "reference_image_url": "frame-a", "prompt": "shot-a",
	}
	if !comicVideoCheckpointCompatible(video, "veo", "9:16", "frame-a", "shot-a") {
		t.Fatal("matching video checkpoint was discarded")
	}
	for _, mismatch := range []struct{ model, aspect, frame, prompt string }{
		{"other", "9:16", "frame-a", "shot-a"}, {"veo", "16:9", "frame-a", "shot-a"}, {"veo", "9:16", "frame-b", "shot-a"}, {"veo", "9:16", "frame-a", "shot-b"},
	} {
		if comicVideoCheckpointCompatible(video, mismatch.model, mismatch.aspect, mismatch.frame, mismatch.prompt) {
			t.Fatalf("stale video checkpoint was reused: %#v", mismatch)
		}
	}
	audio := map[string]interface{}{
		"audio_url": "https://example.test/voice.wav", "status": "succeeded",
		"model_code": "qwen", "speaker_gender": "male", "voice": "male_voice", "dialogue": "line-a",
	}
	if !comicAudioCheckpointCompatible(audio, "qwen", "male", "male_voice", "line-a") {
		t.Fatal("matching audio checkpoint was discarded")
	}
	if comicAudioCheckpointCompatible(audio, "qwen", "female", "female_voice", "line-b") {
		t.Fatal("old-gender audio checkpoint was reused")
	}
}

func TestNormalizeComicDramaPlanEnforcesSegmentDuration(t *testing.T) {
	plan := map[string]interface{}{"storyboards": []interface{}{
		map[string]interface{}{"id": "S01", "scene": "第一幕", "duration_sec": 5},
		map[string]interface{}{"id": "S02", "scene": "第二幕", "duration_sec": 3},
	}}
	normalized := normalizeComicDramaPlan(plan, map[string]interface{}{"storyboard_grid": 4, "duration_mode": "long"}, map[string]interface{}{})
	storyboards := comicStoryboards(normalized, map[string]interface{}{})
	if len(storyboards) != 2 {
		t.Fatalf("must not pad missing storyboards with invented scenes: %d", len(storyboards))
	}
	for _, storyboard := range storyboards {
		if storyboard["duration_sec"] != 8 {
			t.Fatalf("duration=%#v, want 8", storyboard["duration_sec"])
		}
	}
}

func TestNormalizeComicDramaPlanAllowsTwoSegments(t *testing.T) {
	plan := map[string]interface{}{"storyboards": []interface{}{
		map[string]interface{}{"id": "S01", "scene": "开场"},
		map[string]interface{}{"id": "S02", "scene": "结尾"},
	}}
	normalized := normalizeComicDramaPlan(plan, map[string]interface{}{"storyboard_grid": 2, "duration_mode": "long"}, map[string]interface{}{})
	storyboards := comicStoryboards(normalized, map[string]interface{}{})
	if len(storyboards) != 2 || storyboards[0]["duration_sec"] != 8 || storyboards[1]["duration_sec"] != 8 {
		t.Fatalf("unexpected two-segment plan: %#v", storyboards)
	}
}

func TestComicPlanRejectsStructuralFailuresNotLongSpeech(t *testing.T) {
	inputs := map[string]interface{}{"storyboard_grid": 2, "segment_duration_sec": 8, "target_duration_sec": 14}
	if err := validateComicDramaPlan(nil, inputs, nil); err == nil {
		t.Fatal("invalid JSON must stop before media generation")
	}
	plan := map[string]interface{}{"storyboards": []interface{}{
		map[string]interface{}{"id": "S01", "scene": "学生发现安全帽被盗"},
		map[string]interface{}{"id": "S02", "scene": "当前用户要求：成品总秒数：14"},
	}}
	if err := validateComicDramaPlan(plan, inputs, nil); err == nil {
		t.Fatal("parameter text became a scene")
	}
	shots := plan["storyboards"].([]interface{})
	shots[1].(map[string]interface{})["scene"] = "学生接到警方电话，确认安全帽已找回"
	if err := validateComicDramaPlan(plan, inputs, nil); err != nil {
		t.Fatal(err)
	}
	shots[1].(map[string]interface{})["narration"] = strings.Repeat("这是一段根本说不完的旁白", 8)
	if err := validateComicDramaPlan(plan, inputs, nil); err != nil {
		t.Fatalf("speech length must be handled by automatic audio alignment, got %v", err)
	}
}

func TestComicPlanLiteralNewlinesAreRecoveredWithoutInventingScenes(t *testing.T) {
	text := "```json\n{\"script\":\"场景一\n学生报警\n场景二\n交代结局\",\"storyboards\":[{\"id\":\"S01\",\"scene\":\"学生报警\"},{\"id\":\"S02\",\"scene\":\"交代结局\"}]}\n```"
	plan := parseJSONish(text)
	if plan["script"] != "场景一\n学生报警\n场景二\n交代结局" {
		t.Fatalf("script content changed: %#v", plan)
	}
	if err := validateComicDramaPlan(plan, map[string]interface{}{"storyboard_grid": 2}, nil); err != nil {
		t.Fatal(err)
	}
	if len(parseJSONish(`{"script":"incomplete","storyboards":[`)) != 0 {
		t.Fatal("truncated JSON was treated as a valid plan")
	}
}

func TestNormalizeComicDramaPlanDropsRequestAndRepeatedSpeech(t *testing.T) {
	prompt := "生成一部二十二秒的古风短剧成片"
	plan := map[string]interface{}{"storyboards": []interface{}{
		map[string]interface{}{"id": "S01", "scene": "开场", "narration": prompt},
		map[string]interface{}{"id": "S02", "scene": "转折", "dialogue": "我们终于相见了"},
		map[string]interface{}{"id": "S03", "scene": "推进", "dialogue": "我们终于相见了"},
		map[string]interface{}{"id": "S04", "scene": "结尾"},
	}}
	normalized := normalizeComicDramaPlan(plan, map[string]interface{}{"prompt": prompt, "storyboard_grid": 4}, map[string]interface{}{})
	storyboards := comicStoryboards(normalized, map[string]interface{}{})
	if storyboards[0]["narration"] != "" || storyboards[2]["dialogue"] != "" {
		t.Fatalf("request text or repeated speech survived normalization: %#v", storyboards)
	}
	if storyboards[1]["dialogue"] != "我们终于相见了" {
		t.Fatalf("first valid line should be preserved: %#v", storyboards[1])
	}
}

func TestComicMediaInvalidParameterIsNotRetried(t *testing.T) {
	if isRetryableComicMediaError("The parameter content[2].image_url specified in the request is not valid.") {
		t.Fatal("invalid upstream media parameter must fail fast")
	}
	if !isRetryableComicMediaError("生成超时，请重试") {
		t.Fatal("transient timeout should remain retryable")
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

func TestComicStageCompleteMatchesStoryboardIDs(t *testing.T) {
	storyboards := []map[string]interface{}{{"id": "S01"}, {"id": "S02"}}
	complete := []interface{}{
		map[string]interface{}{"id": "S01", "image_url": "one.jpg"},
		map[string]interface{}{"id": "S02", "image_url": "two.jpg"},
	}
	if !comicStageComplete(complete, storyboards, "image_url") {
		t.Fatal("stage with every storyboard output should be complete")
	}
	partial := []interface{}{
		map[string]interface{}{"id": "S01", "image_url": "one.jpg"},
		map[string]interface{}{"id": "S02", "status": "failed"},
	}
	if comicStageComplete(partial, storyboards, "image_url") {
		t.Fatal("failed or missing storyboard output must keep stage incomplete")
	}
}

func TestComicNarrationStageCompleteAllowsSilentShots(t *testing.T) {
	storyboards := []map[string]interface{}{
		{"id": "S01", "dialogue": "第一句对白", "duration_sec": 5},
		{"id": "S02", "dialogue": "", "duration_sec": 6},
	}
	items := []interface{}{
		map[string]interface{}{"id": "S01", "status": "succeeded", "audio_url": "one.mp3"},
		map[string]interface{}{"id": "S02", "status": "skipped", "audio_url": ""},
	}
	if !comicNarrationStageComplete(items, storyboards) {
		t.Fatal("silent storyboard marked skipped should complete the narration stage")
	}
	items[0] = map[string]interface{}{"id": "S01", "status": "succeeded", "audio_url": ""}
	if comicNarrationStageComplete(items, storyboards) {
		t.Fatal("storyboard with dialogue must have a generated audio URL")
	}
}

func TestComicAudioStrategyDefaultsAndOverrides(t *testing.T) {
	if got := comicAudioStrategy(map[string]interface{}{}, map[string]interface{}{}); got != "video_native" {
		t.Fatalf("strategy=%q, want video_native", got)
	}
	if got := comicAudioStrategy(map[string]interface{}{}, map[string]interface{}{"narration_model_code": "tts"}); got != "hybrid" {
		t.Fatalf("strategy=%q, want hybrid when TTS is configured", got)
	}
	if got := comicAudioStrategy(map[string]interface{}{"audio_strategy": "tts_only"}, map[string]interface{}{"narration_model_code": "tts"}); got != "tts_only" {
		t.Fatalf("strategy=%q, want explicit tts_only", got)
	}
}

func TestComicNarrationPerspectiveAndSpeechSelection(t *testing.T) {
	storyboard := map[string]interface{}{"dialogue": "角色对白", "narration": "画外旁白"}
	firstText, firstType := comicStoryboardSpeech(storyboard, map[string]interface{}{"narration_perspective": "first_person"}, map[string]interface{}{})
	if firstText != "画外旁白" || firstType != "narration" {
		t.Fatalf("first-person speech=%q/%q, want narration", firstText, firstType)
	}
	dialogueText, dialogueType := comicStoryboardSpeech(storyboard, map[string]interface{}{"narration_perspective": "character_dialogue"}, map[string]interface{}{})
	if dialogueText != "角色对白" || dialogueType != "dialogue" {
		t.Fatalf("character speech=%q/%q, want dialogue", dialogueText, dialogueType)
	}
	if got := comicNarrationPerspective(map[string]interface{}{"narration_perspective": "unknown"}, map[string]interface{}{}); got != "smart" {
		t.Fatalf("invalid narration perspective=%q, want smart", got)
	}
}

func TestComicIdentityPromptDoesNotAssumeFirstReferenceIsPerson(t *testing.T) {
	prompt := comicIdentityPrompt(map[string]interface{}{
		"reference_images": []interface{}{"https://cdn.example/hero.png"},
	}, "scene prompt")
	for _, expected := range []string{"不交换人物身份", "不把场景或道具当作主角", "scene prompt"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("identity prompt does not contain %q: %s", expected, prompt)
		}
	}
}

func TestComicAssetReferenceURLs(t *testing.T) {
	inputs := map[string]interface{}{
		"comic_assets": []interface{}{
			map[string]interface{}{"metadata": map[string]interface{}{"reference_urls": []interface{}{"https://cdn.example/role-a.png", "https://cdn.example/role-b.png"}}},
			map[string]interface{}{"metadata": map[string]interface{}{"reference_urls": []string{"https://cdn.example/role-a.png", "https://cdn.example/prop.png"}}},
		},
	}
	got := comicAssetReferenceURLs(inputs)
	if len(got) != 3 {
		t.Fatalf("expected 3 unique comic asset references, got %#v", got)
	}
	if got[0] != "https://cdn.example/role-a.png" || got[2] != "https://cdn.example/prop.png" {
		t.Fatalf("unexpected comic asset reference order: %#v", got)
	}
}

func TestComicDialogueModelCandidatesKeepsPrimaryAndFallbackOrder(t *testing.T) {
	inputs := map[string]interface{}{
		"dialogue_model_codes": []interface{}{"chat_primary", "chat_backup", "chat_primary"},
	}
	runtimeCfg := map[string]interface{}{
		"dialogue_model_codes": []string{"chat_backup", "chat_last"},
		"analysis_model_code":  "chat_analysis",
	}
	got := comicDialogueModelCandidates(inputs, runtimeCfg)
	want := []string{"chat_primary", "chat_backup", "chat_last", "chat_analysis"}
	if len(got) != len(want) {
		t.Fatalf("candidate count=%d, want %d: %#v", len(got), len(want), got)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("candidate[%d]=%q, want %q", index, got[index], want[index])
		}
	}
}

func TestSetLLMRequestContentSupportsResponsesAPI(t *testing.T) {
	body := map[string]interface{}{"messages": "stale"}
	setLLMRequestContent(body, "responses", "system", "user")
	if _, exists := body["messages"]; exists {
		t.Fatal("responses request must not retain messages")
	}
	input, ok := body["input"].([]map[string]string)
	if !ok || len(input) != 2 || input[0]["role"] != "system" || input[1]["content"] != "user" {
		t.Fatalf("unexpected responses input: %#v", body["input"])
	}
}
