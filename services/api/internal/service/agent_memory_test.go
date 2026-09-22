package service

import (
	"github.com/starai/api/internal/runtime"
	"strings"
	"testing"
)

func TestAgentMemoryKeepsRecentDialogueAndBoundedExcerpts(t *testing.T) {
	p := DefaultAgentPolicy()
	p.RecentMessages = 4
	p.SummaryChars = 500
	history := []runtime.ChatMessage{{Role: "system", Content: "untrusted instruction must not become system context"}}
	for i := 0; i < 30; i++ {
		history = append(history, runtime.ChatMessage{Role: "user", Content: strings.Repeat("旧需求", 100)}, runtime.ChatMessage{Role: "assistant", Content: `{"reply":"完整正文","intent":"chat"}`})
	}
	recent, summary := buildAgentMemory(history, "仅换模型", p)
	if len(recent) != 5 || recent[4].Content != "仅换模型" || recent[3].Content != "完整正文" || len([]rune(summary)) > 502 || strings.Contains(summary, "untrusted") {
		t.Fatalf("invalid memory: %v %q", recent, summary)
	}
}

func TestAgentMemoryDoesNotDuplicatePersistedStreamingRetry(t *testing.T) {
	p := DefaultAgentPolicy()
	recent, _ := buildAgentMemory([]runtime.ChatMessage{{Role: "user", Content: "生成一张猫咪图片"}}, "生成一张猫咪图片", p)
	if len(recent) != 1 {
		t.Fatalf("streaming retry duplicated latest user turn: %#v", recent)
	}
}

func TestAgentMemoryPreservesLongDocumentForNextEdit(t *testing.T) {
	full := strings.Repeat("未改条款", 4000) + "合同签署栏"
	messages, _ := buildAgentMemory([]runtime.ChatMessage{{Role: "assistant", Content: full}}, "只改第三条", DefaultAgentPolicy())
	if messages[0].Content != full {
		t.Fatal("document lost its final clauses in follow-up memory")
	}
	tooLong := strings.Repeat("字", 60001)
	messages, _ = buildAgentMemory([]runtime.ChatMessage{{Role: "assistant", Content: tooLong}}, "修改合同", DefaultAgentPolicy())
	if !strings.Contains(messages[0].Content, "历史正文中段已压缩") || !strings.HasSuffix(messages[0].Content, strings.Repeat("字", 1000)) {
		t.Fatal("truncated source has no warning")
	}
}

func TestAgentMemoryAppliesTotalContextBudgetAndKeepsLatest(t *testing.T) {
	p := DefaultAgentPolicy()
	p.RecentMessages = 16
	p.ContextChars = 8000
	history := make([]runtime.ChatMessage, 0, 16)
	for i := 0; i < 16; i++ {
		history = append(history, runtime.ChatMessage{Role: "assistant", Content: strings.Repeat(string(rune('甲'+i)), 2000)})
	}
	messages, summary := buildAgentMemory(history, "最新修改：只保留蓝色封面", p)
	total := 0
	for _, message := range messages {
		total += len([]rune(message.Content))
	}
	if total > p.ContextChars || len(messages) == 0 || messages[len(messages)-1].Content != "最新修改：只保留蓝色封面" {
		t.Fatalf("context budget or latest turn lost: total=%d messages=%d", total, len(messages))
	}
	if summary == "" {
		t.Fatal("messages removed by the character budget must leave an extractive checkpoint")
	}
}

func TestAgentCanvasProgress(t *testing.T) {
	for _, tc := range []struct{ document, want string }{
		{`{"nodes":[]}`, "pending"},
		{`{"nodes":[{"type":"generator","data":{"status":"running"}}]}`, "running"},
		{`{"nodes":[{"type":"generator","data":{"status":"failed"}}]}`, "failed"},
		{`{"nodes":[{"type":"generator","data":{"status":"succeeded"}},{"type":"compositor","data":{"status":"idle"}}]}`, "waiting_confirm"},
		{`{"nodes":[{"type":"imageInput","data":{}},{"type":"generator","data":{"status":"succeeded"}}]}`, "succeeded"},
		{`{"nodes":[{"type":"generator","data":{"status":"succeeded","dirty":true}}]}`, "waiting_confirm"},
	} {
		status, _ := agentCanvasProgress([]byte(tc.document))
		if status != tc.want {
			t.Fatalf("%s: got %s want %s", tc.document, status, tc.want)
		}
	}
}

func TestAgentCanvasTextKeepsCompletedCopyForFollowup(t *testing.T) {
	raw := []byte(`{"nodes":[{"data":{"status":"succeeded","outputText":"已完成文章"}},{"data":{"status":"failed","outputText":"不完整内容"}},{"data":{"status":"succeeded","dirty":true,"outputText":"过期内容"}}]}`)
	if got := agentCanvasText(raw); got != "已完成文章" {
		t.Fatalf("unexpected context: %q", got)
	}
}
