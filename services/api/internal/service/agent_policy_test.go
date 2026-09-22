package service

import (
	"strings"
	"testing"
)

func TestAgentPolicySectionsAreEffectiveAndBackwardCompatible(t *testing.T) {
	p := AgentPolicyFromConfig(map[string]interface{}{"agent_policy": map[string]interface{}{"version": 3, "instructions": "自定义品牌要求"}})
	if p.Version != 3 || p.Instructions != "自定义品牌要求" || p.IntentGuidance == "" || p.CreationGuidance == "" || p.DocumentGuidance == "" {
		t.Fatalf("legacy policy lost defaults: %#v", p)
	}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	p.ResearchGuidance = "自定义来源核验要求"
	p.DocumentGuidance = "自定义文档处理要求"
	if !strings.Contains(p.Prompt(), "自定义来源核验要求") || !strings.Contains(p.Prompt(), "自定义品牌要求") || !strings.Contains(p.Prompt(), "自定义文档处理要求") {
		t.Fatal("editor values do not reach prompt")
	}
	p.CreationGuidance = strings.Repeat("字", 6001)
	if p.Validate() == nil {
		t.Fatal("unbounded policy accepted")
	}
}

func TestAgentPolicyHistoryBackfillsNewSkillsWithoutOverwritingExplicitEmpty(t *testing.T) {
	state := agentPolicyState([]byte(`{"agent_policy_history":[{"version":2,"instructions":"旧策略"},{"version":1,"document_guidance":""}]}`))
	if len(state.History) != 2 || state.History[0].DocumentGuidance == "" {
		t.Fatal("legacy policy history did not inherit new skill defaults")
	}
	if state.History[1].DocumentGuidance != "" {
		t.Fatal("explicitly disabled historical skill was overwritten")
	}
}
