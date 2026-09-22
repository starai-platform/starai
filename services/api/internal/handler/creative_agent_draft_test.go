package handler

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/starai/api/internal/service"
)

func TestAgentDraftIncrementalDurationPreservesEstablishedSlots(t *testing.T) {
	if !agentIncrementalRequest("22秒") {
		t.Fatal("a duration-only clarification must continue the existing draft")
	}
	d := &service.AgentDraft{Version: 2, Slots: map[string]interface{}{"media_type": "video", "prompt": "原始创意", "script": "原有完整文案", "target_duration_sec": 15, "character": "小满", "style": "写实", "aspect_ratio": "9:16", "asset_ids": []string{"asset_1"}}}
	plan := map[string]interface{}{"intent": "chat", "action": "new_task", "prompt": "错误改写整个故事", "slot_updates": map[string]interface{}{"script": "错误新文案", "character": "其他角色"}, "slot_evidence": map[string]interface{}{"script": "改成22秒", "character": "改成22秒"}}
	if err := mergeCreativeAgentDraft(d, plan, "改成22秒"); err != nil {
		t.Fatal(err)
	}
	if d.Slots["target_duration_sec"] != 22 || d.Slots["script"] != "原有完整文案" || d.Slots["character"] != "小满" || d.Slots["style"] != "写实" || d.Slots["aspect_ratio"] != "9:16" {
		t.Fatalf("unrelated slots overwritten: %#v", d.Slots)
	}
	if d.Sources["target_duration_sec"].Source != "user" || d.Sources["target_duration_sec"].Version != 2 {
		t.Fatalf("missing provenance: %#v", d.Sources)
	}
	prompt := creativeAgentSlotPrompt(d.Slots)
	if !strings.Contains(prompt, "原有完整文案") || !strings.Contains(prompt, "成品总秒数：22") || !strings.Contains(prompt, "角色：小满") {
		t.Fatal(prompt)
	}
}

func TestAgentDraftQuestionsAndNewTasks(t *testing.T) {
	d := &service.AgentDraft{Version: 3, Slots: map[string]interface{}{"script": "已写好的文案", "character": "旧角色", "target_duration_sec": 15}}
	if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "chat", "action": "new_task", "slot_updates": map[string]interface{}{"target_duration_sec": 8}, "slot_evidence": map[string]interface{}{"target_duration_sec": "这是什么"}}, "这是什么"); err != nil {
		t.Fatal(err)
	}
	if d.Slots["target_duration_sec"] != 15 {
		t.Fatal("question mutated slots")
	}
	if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "chat", "action": "new_task", "reply": "新的猫咪故事文案"}, "新任务，给我写一个猫咪故事"); err != nil {
		t.Fatal(err)
	}
	if d.Slots["character"] != nil || d.Slots["script"] != "新的猫咪故事文案" {
		t.Fatalf("new task inherited old context: %#v", d.Slots)
	}
}

func TestAgentDraftDurationSurvivesPromptApprovalAndAspectClarification(t *testing.T) {
	d := &service.AgentDraft{Version: 1, Slots: map[string]interface{}{"media_type": "video", "character": "玛利亚", "script": "已确定的理财文案", "target_duration_sec": 30}}
	for i, turn := range []struct {
		text    string
		updates map[string]interface{}
	}{
		{"把视频压缩到15秒左右，然后出提示词", map[string]interface{}{"generation_prompt": "0-3秒展示存钱罐，3-12秒展示钱币增长动画，12-15秒人物微笑收尾。"}},
		{"嗯，按上面的提示词给我生成视频", nil},
		{"手机全屏短视频", map[string]interface{}{"platform": "手机全屏短视频"}},
	} {
		d.Version++
		intent := "workflow"
		if i == 0 {
			intent = "chat"
		}
		if i == 2 {
			d.Missing = []string{"aspect_ratio"}
		}
		plan := map[string]interface{}{"intent": intent, "action": "new_task", "slot_updates": turn.updates}
		if err := mergeCreativeAgentDraft(d, plan, turn.text); err != nil {
			t.Fatal(err)
		}
		if creativeAgentPositiveInt(d.Slots["target_duration_sec"]) != 15 || d.Slots["character"] != "玛利亚" || d.Slots["generation_prompt"] == nil {
			t.Fatalf("turn %q lost established requirements: %#v", turn.text, d.Slots)
		}
		// Match the persisted JSON boundary between actual conversation turns.
		raw, _ := json.Marshal(d)
		if err := json.Unmarshal(raw, d); err != nil {
			t.Fatal(err)
		}
	}
	creativeAgentVideoAspectRatio(d)
	if d.Slots["aspect_ratio"] != "9:16" || d.Sources["target_duration_sec"].Evidence != "把视频压缩到15秒左右，然后出提示词" {
		t.Fatalf("clarification changed duration or lost its source: %#v", d)
	}
	if !agentDurationOnlyRequest("15秒左右") {
		t.Fatal("approximate duration should not rewrite the brief")
	}
	if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "chat", "action": "new_task", "reply": "一只猫的全新故事"}, "新任务，给我写一个猫咪故事"); err != nil || d.Slots["target_duration_sec"] != nil {
		t.Fatalf("explicit new task inherited old duration: %#v, %v", d, err)
	}
}

func TestAgentPromptEditShowsPreparedTextInsteadOfAnotherConfirmation(t *testing.T) {
	const prompt = "0-3秒展示存钱罐，3-12秒展示钱币增长动画，12-15秒人物微笑收尾。"
	plan := guardCreativeAgentIntent(map[string]interface{}{
		"intent": "workflow", "slot_updates": map[string]interface{}{"generation_prompt": prompt},
	}, "把视频压缩到15秒左右，然后出提示词")
	if plan["intent"] != "chat" || plan["needs_confirm"] != false || plan["reply"] != prompt {
		t.Fatalf("prompt edit became another confirmation: %#v", plan)
	}
}

func TestAgentDraftConfirmedRequestUsesServerSnapshot(t *testing.T) {
	stored := map[string]interface{}{"plan_version": 7, "model_code": "approved-model", "prompt": "approved-script", "params": map[string]interface{}{"target_duration_sec": 22}, "asset_ids": []string{"approved-asset"}}
	req := creativeAgentGenerateRequest{ConversationID: "conv", PlanVersion: 7, Confirmed: true}
	if err := decodeAgentDraftRequest(stored, &req); err != nil {
		t.Fatal(err)
	}
	if req.Prompt != "approved-script" || req.ModelCode != "approved-model" || req.AssetIDs[0] != "approved-asset" || req.PlanVersion != 7 {
		t.Fatalf("snapshot lost: %#v", req)
	}
	raw, _ := json.Marshal(stored)
	var roundTrip map[string]interface{}
	_ = json.Unmarshal(raw, &roundTrip)
	if err := decodeAgentDraftRequest(roundTrip, &req); err != nil {
		t.Fatal(err)
	}
}

func TestCreativeAgentLiteralAudioContentExcludesExecutionNotes(t *testing.T) {
	slots := map[string]interface{}{
		"script": "春风吹过山谷。", "style": "温柔", "target_duration_sec": 8, "aspect_ratio": "9:16",
	}
	for _, mediaType := range []string{"speech", "music"} {
		if got := creativeAgentSlotPrompt(slots, mediaType); got != "春风吹过山谷。" {
			t.Fatalf("%s content contains execution notes: %q", mediaType, got)
		}
	}
	if got := creativeAgentSlotPrompt(slots, "video"); !strings.Contains(got, "画幅：9:16") {
		t.Fatalf("video prompt lost useful constraints: %q", got)
	}
}

func TestCreativeAgentOrientationMatchesAspectRatio(t *testing.T) {
	for ratio, want := range map[string]string{"9:16": "portrait", "3:4": "portrait", "16:9": "landscape", "4:3": "landscape", "1:1": ""} {
		if got := creativeAgentOrientation(ratio); got != want {
			t.Fatalf("ratio %s orientation=%q want=%q", ratio, got, want)
		}
	}
}
