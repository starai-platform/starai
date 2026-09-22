package service

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/starai/api/internal/runtime"
	"strings"
)

func agentMemoryText(role, content string) string {
	if role != "assistant" {
		return content
	}
	var plan map[string]interface{}
	if json.Unmarshal([]byte(content), &plan) == nil {
		if reply, ok := plan["reply"].(string); ok {
			return reply
		}
	}
	return content
}

func agentMemoryClip(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	marker := []rune("\n[历史正文中段已压缩；任务槽位与首尾内容仍保留，完整改稿请使用原附件]\n")
	if limit <= len(marker)+2 {
		return string(runes[:limit])
	}
	kept := limit - len(marker)
	head := kept * 2 / 3
	tail := kept - head
	return string(runes[:head]) + string(marker) + string(runes[len(runes)-tail:])
}

// ponytail: bounded extractive memory avoids a second paid model call. Exact
// requirements live in slots; add semantic summaries only if excerpts fall short.
func buildAgentMemory(history []runtime.ChatMessage, latest string, p AgentPolicy) ([]runtime.ChatMessage, string) {
	dialogue := []runtime.ChatMessage{}
	for _, m := range history {
		if m.Role == "user" || m.Role == "assistant" {
			m.Content = agentMemoryText(m.Role, m.Content)
			dialogue = append(dialogue, m)
		}
	}
	split := len(dialogue) - p.RecentMessages
	if split < 0 {
		split = 0
	}
	excerpts := []string{}
	for _, m := range dialogue[:split] {
		excerpts = append(excerpts, m.Role+": "+agentMemoryClip(m.Content, 180))
	}
	summary := strings.Join(excerpts, "\n")
	if r := []rune(summary); len(r) > p.SummaryChars {
		summary = "…\n" + string(r[len(r)-p.SummaryChars:])
	}
	recent := append([]runtime.ChatMessage{}, dialogue[split:]...)
	if len(recent) == 0 || recent[len(recent)-1].Role != "user" || strings.TrimSpace(recent[len(recent)-1].Content) != strings.TrimSpace(latest) {
		recent = append(recent, runtime.ChatMessage{Role: "user", Content: latest})
	}
	// Keep the newest evidence verbatim where possible, but apply one total
	// context budget. This is the model-free pressure valve: exact task state
	// remains in AgentDraft slots while old prose becomes bounded excerpts.
	remaining := p.ContextChars
	bounded := make([]runtime.ChatMessage, 0, len(recent))
	omitted := make([]runtime.ChatMessage, 0)
	for i := len(recent) - 1; i >= 0; i-- {
		if remaining < 256 {
			omitted = append(omitted, recent[:i+1]...)
			break
		}
		limit := remaining
		if limit > 24000 {
			limit = 24000
		}
		message := recent[i]
		message.Content = agentMemoryClip(message.Content, limit)
		remaining -= len([]rune(message.Content))
		bounded = append(bounded, message)
	}
	for left, right := 0, len(bounded)-1; left < right; left, right = left+1, right-1 {
		bounded[left], bounded[right] = bounded[right], bounded[left]
	}
	if len(omitted) > 0 {
		parts := make([]string, 0, len(omitted))
		for _, message := range omitted {
			parts = append(parts, message.Role+": "+agentMemoryClip(message.Content, 180))
		}
		if summary != "" {
			summary += "\n"
		}
		summary += strings.Join(parts, "\n")
		if r := []rune(summary); len(r) > p.SummaryChars {
			summary = "…\n" + string(r[len(r)-p.SummaryChars:])
		}
	}
	return bounded, summary
}

func (s *ChatService) AgentContext(ctx context.Context, userID int64, conversationID, latest string, p AgentPolicy) ([]runtime.ChatMessage, string, error) {
	// Ownership check is independent of whether this conversation has any messages.
	draft, err := s.GetAgentDraft(ctx, userID, conversationID)
	if err != nil {
		return nil, "", err
	}
	rows, err := s.db.Query(ctx, `SELECT role,content FROM (SELECT cm.id,cm.role,cm.content FROM conversation_messages cm JOIN conversations c ON c.id=cm.conversation_id WHERE c.public_id=$1 AND c.user_id=$2 ORDER BY cm.id DESC LIMIT 128) recent ORDER BY id`, conversationID, userID)
	if err != nil {
		return nil, "", err
	}
	history := []runtime.ChatMessage{}
	kind, ref := draft.ExecutionKind, draft.ExecutionRef
	for rows.Next() {
		var role, content string
		if err = rows.Scan(&role, &content); err != nil {
			rows.Close()
			return nil, "", err
		}
		history = append(history, runtime.ChatMessage{Role: role, Content: content})
		if role == "system" {
			var event map[string]interface{}
			if json.Unmarshal([]byte(content), &event) == nil {
				if event["type"] == "creative_agent_canvas" {
					kind = "canvas"
					ref = stringValue(event["canvas_id"])
				}
				if event["type"] == "creative_agent_workflow" {
					kind = "workflow"
					ref = stringValue(event["project_id"])
				}
				if event["type"] == "creative_agent_generation" {
					kind = "generation"
					ref = stringValue(event["task_no"])
				}
			}
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, "", err
	}
	messages, summary := buildAgentMemory(history, latest, p)
	if ref != "" {
		var status, step string
		if kind == "canvas" {
			var document []byte
			if err = s.db.QueryRow(ctx, `SELECT document FROM infinite_canvases WHERE public_id=$1 AND user_id=$2`, ref, userID).Scan(&document); err == nil {
				status, step = agentCanvasProgress(document)
				summary += fmt.Sprintf("\n当前 Agent 生成任务：%s，画布最近保存状态=%s，步骤=%s。结果在当前对话展示；继续或重试应续接原工作流，不要要求用户打开画布操作，不得把中间素材说成最终成品。", ref, status, step)
				if text := agentCanvasText(document); text != "" {
					// Keep generated copy available for edits and subsequent media plans.
					result := runtime.ChatMessage{Role: "assistant", Content: agentMemoryClip(text, 12000)}
					if len(messages) > 0 && messages[len(messages)-1].Role == "user" {
						last := messages[len(messages)-1]
						messages = append(messages[:len(messages)-1], result, last)
					} else {
						messages = append(messages, result)
					}
				}
			}
			return messages, summary, nil
		}
		query := `SELECT status,'' FROM tasks WHERE task_no=$1 AND user_id=$2`
		if kind == "workflow" {
			query = `SELECT status,COALESCE(outputs->>'current_step','') FROM workflow_projects WHERE public_id=$1 AND user_id=$2`
		}
		if err = s.db.QueryRow(ctx, query, ref, userID).Scan(&status, &step); err == nil {
			summary += fmt.Sprintf("\n服务端最新任务：%s %s，状态=%s，步骤=%s。失败时应续接原项目，不得声称已重新开始或已完成。", kind, ref, status, step)
		}
	}
	return messages, summary, nil
}

func agentCanvasText(raw []byte) string {
	var document struct {
		Nodes []struct {
			Data struct {
				Status     string `json:"status"`
				Dirty      bool   `json:"dirty"`
				OutputText string `json:"outputText"`
			} `json:"data"`
		} `json:"nodes"`
	}
	if json.Unmarshal(raw, &document) != nil {
		return ""
	}
	var parts []string
	for _, node := range document.Nodes {
		if node.Data.Status == "succeeded" && !node.Data.Dirty && strings.TrimSpace(node.Data.OutputText) != "" {
			parts = append(parts, node.Data.OutputText)
		}
	}
	return strings.Join(parts, "\n\n")
}

func agentCanvasProgress(raw []byte) (string, string) {
	var document struct {
		Nodes []struct {
			Type string `json:"type"`
			Data struct {
				Status string `json:"status"`
				Label  string `json:"label"`
				Dirty  bool   `json:"dirty"`
			} `json:"data"`
		} `json:"nodes"`
	}
	if json.Unmarshal(raw, &document) != nil {
		return "unknown", ""
	}
	count, completed := 0, 0
	for _, node := range document.Nodes {
		if node.Type != "generator" && node.Type != "compositor" {
			continue
		}
		count++
		switch node.Data.Status {
		case "failed", "blocked":
			return "failed", node.Data.Label
		case "pending", "running":
			return "running", node.Data.Label
		case "succeeded":
			if !node.Data.Dirty {
				completed++
			}
		}
	}
	if count == 0 {
		return "pending", "准备生成"
	}
	if completed == count {
		return "succeeded", "成品已完成"
	}
	return "waiting_confirm", "继续原任务"
}
