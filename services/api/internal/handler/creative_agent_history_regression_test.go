package handler

import (
	"strings"
	"testing"
	"time"

	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/service"
)

func TestAgentLatestHistoryPromptEditing(t *testing.T) {
	texts := []string{
		"你这生成的是啥？我要真人版的，还有你这个配音怎么配的？可以使用第三人称讲解。也可以第一人称直白。另外你这个结尾是什么？完全就不在一个频道。好好帮我整理内容提示词",
		"帮我改成时长8秒 你现在只有文案，我需要完整的生成视频的提示词。不是文案",
	}
	for _, text := range texts {
		d := &service.AgentDraft{Version: 7, Slots: map[string]interface{}{"script": "旧新闻文案", "character": "学生", "target_duration_sec": 14}}
		plan := guardCreativeAgentIntent(map[string]interface{}{
			"intent": "workflow", "action": "update", "reply": "完整画面提示词与明确结尾", "needs_confirm": true,
			"slot_updates":  map[string]interface{}{"style": "真人实拍", "generation_prompt": "0–3秒发现失窃，3–8秒交代结果。第三人称短旁白。"},
			"slot_evidence": map[string]interface{}{"style": "真人版", "generation_prompt": "提示词"},
		}, text)
		if plan["intent"] != "chat" || plan["needs_confirm"] != false {
			t.Fatalf("prompt editing must answer directly without media execution: %#v", plan)
		}
		if err := mergeCreativeAgentDraft(d, plan, text); err != nil {
			t.Fatal(err)
		}
		if d.Slots["character"] != "学生" || d.Slots["script"] != "旧新闻文案" || d.Slots["generation_prompt"] == nil {
			t.Fatalf("lost or conflated slots: %#v", d.Slots)
		}
		if !strings.Contains(creativeAgentSlotPrompt(d.Slots), "0–3秒发现失窃") {
			t.Fatal("old copy overrode the revised generation prompt")
		}
		decision, decided := creativeAgentFastSearchDecision([]runtime.ChatMessage{{Role: "user", Content: text}}, creativeAgentClockAt(nil, time.Now()))
		if !decided || decision.NeedsSearch {
			t.Fatalf("local editing searched web: %#v", decision)
		}
		if strings.Contains(text, "8秒") && d.Slots["target_duration_sec"] != 8 {
			t.Fatal("duration update lost")
		}
	}
	for _, text := range []string{"根据这个提示词生成视频", "先写视频提示词，然后生成视频", "根据文案生成14秒视频"} {
		if creativeAgentTextOnly(text) {
			t.Fatalf("explicit generation blocked: %s", text)
		}
	}
}

func TestAgentResearchIsNotScriptAndSearchDoesNotOverwriteAnswer(t *testing.T) {
	d := &service.AgentDraft{Version: 1, Slots: map[string]interface{}{"script": "已写好故事"}}
	text := "帮我整理一份今天 tiktok上的热搜短视频，提取结构文案内容给我"
	plan := map[string]interface{}{"intent": "chat", "action": "new_task", "reply": "TikTok Log in Search For You", "slot_updates": map[string]interface{}{"script": "搜索导航内容"}, "slot_evidence": map[string]interface{}{"script": "文案"}}
	if err := mergeCreativeAgentDraft(d, plan, text); err != nil {
		t.Fatal(err)
	}
	if d.Slots["script"] != "已写好故事" {
		t.Fatal("research polluted creative script")
	}
	for _, url := range []string{"https://www.tiktok.com/discover/今天最新热门新闻", "https://www.tiktok.com/search?q=hot", "https://www.tiktok.com/login"} {
		if creativeAgentUsableSearchResult(service.WebSearchResult{URL: url}) {
			t.Fatalf("navigation source accepted: %s", url)
		}
	}
	if !creativeAgentUsableSearchResult(service.WebSearchResult{URL: "https://www.tiktok.com/@creator/video/123"}) {
		t.Fatal("specific video excluded")
	}
	plan["reply"] = "无法核验今日热榜，以下只能作为候选内容。"
	ensureCreativeAgentSearchReply(plan, []service.WebSearchResult{{Snippet: "Log in Search For You"}})
	if plan["reply"] != "无法核验今日热榜，以下只能作为候选内容。" {
		t.Fatal("honest limitation overwritten")
	}
}
