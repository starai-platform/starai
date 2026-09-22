package handler

import (
	"strings"
	"testing"

	"github.com/starai/api/internal/service"
)

func TestAgentTimedSpeechKeepsContextAndRoutesAudio(t *testing.T) {
	d := &service.AgentDraft{Version: 1}
	text := "今天公司开会，讲的主要内容是如何提高工作效率，请帮我整理成20秒左右的1.2倍语速的文案出来"
	if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "chat", "reply": "明确目标、集中精力、优化流程、定期复盘。"}, text); err != nil {
		t.Fatal(err)
	}
	if d.Slots["speech_rate"] != 1.2 || d.Slots["max_speech_rate"] != 1.2 || d.Slots["target_duration_sec"] != 20 {
		t.Fatalf("lost timing: %#v", d.Slots)
	}
	if guidance := creativeAgentTimedCopyGuidance(d, text); !strings.Contains(guidance, "96个汉字") {
		t.Fatal(guidance)
	}
	d.Version++
	request := "帮我这份文案转换成20秒的音频文件，使用男声，语速1.2倍，必要时可以1.5倍"
	plan := normalizeCreativeAgentWorkflowPlan(map[string]interface{}{"intent": "chat", "slot_updates": map[string]interface{}{"script": "精简后的完整口播正文"}}, request)
	plan = guardCreativeAgentIntent(plan, request)
	if plan["intent"] != "speech" || plan["needs_confirm"] != true {
		t.Fatalf("audio request became text: %#v", plan)
	}
	if err := mergeCreativeAgentDraft(d, plan, request); err != nil {
		t.Fatal(err)
	}
	if d.Slots["speech_rate"] != 1.2 || d.Slots["max_speech_rate"] != 1.5 || d.Slots["voice_gender"] != "male" || d.Slots["script"] != "精简后的完整口播正文" {
		t.Fatalf("lost speech constraints: %#v", d.Slots)
	}
	if creativeAgentSpeechRequest(text) {
		t.Fatal("writing request started audio generation")
	}
}
