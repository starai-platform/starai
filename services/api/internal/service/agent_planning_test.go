package service

import (
	"context"
	"strings"
	"testing"
)

func TestAgentPlanningModelOutputBudget(t *testing.T) {
	for _, name := range []string{"GLM-4.6V", "gpt-5", "gpt-6", "o3", "claude-sonnet-4"} {
		model := &ModelFull{NewAPIModel: name, ModelDTO: ModelDTO{DefaultParams: map[string]interface{}{"max_tokens": 32000}}}
		params, err := buildChatUpstreamParams(model, map[string]interface{}{"_agent_plan_output_limit": 8192, "deep_think": false})
		if err != nil {
			t.Fatal(err)
		}
		if firstPositiveIntValue(params, "max_tokens", "max_completion_tokens") != 8192 || params["_agent_plan_output_limit"] != nil {
			t.Fatal(name, params)
		}
		if name == "gpt-5" && params["max_completion_tokens"] != 8192 {
			t.Fatal("wrong provider token key", params)
		}
		if model.DefaultParams["max_tokens"] != 32000 {
			t.Fatal("mutated global config")
		}
	}
	model := &ModelFull{NewAPIModel: "GLM-4.6V", ModelDTO: ModelDTO{DefaultParams: map[string]interface{}{"max_tokens": 1024}}}
	params, err := buildChatUpstreamParams(model, map[string]interface{}{"_agent_plan_output_limit": 8192})
	if err != nil || params["max_tokens"] != 1024 {
		t.Fatal("must not raise administrator's cap", params, err)
	}
}

func TestAgentDraftDatabasePlanningFailure(t *testing.T) {
	pool := agentTestDatabase(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO conversations(public_id,user_id) VALUES ('planning',1)`); err != nil {
		t.Fatal(err)
	}
	s := &ChatService{db: pool}
	d, err := s.BeginAgentDraftTurn(ctx, 1, "planning", 0)
	if err != nil {
		t.Fatal(err)
	}
	d.DocumentContext, d.LastUserMessage = "原文", "生成教辅图片"
	d.SetSlot("asset_ids", []string{"doc-1"}, "selection", "")
	if err = s.SaveAgentDraft(ctx, 1, "planning", d); err != nil {
		t.Fatal(err)
	}
	if err = s.FailAgentPlanning(ctx, 1, "planning", d.Version, "超限已停止", strings.Repeat("草", 9000)); err != nil {
		t.Fatal(err)
	}
	failed, err := s.GetAgentDraft(ctx, 1, "planning")
	if err != nil || failed.Status != "failed" || failed.DocumentContext != "原文" || failed.LastUserMessage != d.LastUserMessage || failed.Plan != nil || len([]rune(failed.IncompleteReply)) > 8040 {
		t.Fatal(failed, err)
	}
	if err = s.ClaimAgentDraft(ctx, 1, "planning", d.Version); err == nil {
		t.Fatal("truncated plan executable")
	}
	next, err := s.BeginAgentDraftTurn(ctx, 1, "planning", d.Version)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.FailAgentPlanning(ctx, 1, "planning", d.Version, "late old failure", "old"); err != nil {
		t.Fatal(err)
	}
	current, err := s.GetAgentDraft(ctx, 1, "planning")
	if err != nil || current.Status != "planning" || current.Version != next.Version {
		t.Fatal("old failure overwrote newer turn", current, err)
	}
	next.Status, next.Error, next.IncompleteReply = "awaiting_confirmation", "", ""
	if err = s.SaveAgentDraft(ctx, 1, "planning", next); err != nil {
		t.Fatal(err)
	}
	if err = s.FailAgentPlanning(ctx, 1, "planning", next.Version, "late cleanup", "old"); err != nil {
		t.Fatal(err)
	}
	current, err = s.GetAgentDraft(ctx, 1, "planning")
	if err != nil || current.Status != "awaiting_confirmation" || current.Error != "" {
		t.Fatal("cleanup overwrote success", current, err)
	}
}
