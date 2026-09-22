package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

type AgentSlotSource struct {
	Source   string `json:"source"`
	Evidence string `json:"evidence,omitempty"`
	Version  int64  `json:"version"`
}

type AgentDocumentRevision struct {
	Text         string   `json:"text"`
	Version      int64    `json:"version"`
	AssetIDs     []string `json:"asset_ids,omitempty"`
	PendingEdits string   `json:"pending_edits,omitempty"`
}

// One active draft per conversation. Executed tasks keep their own immutable inputs.
type AgentDraft struct {
	Version         int64                      `json:"version"`
	Status          string                     `json:"status"`
	Slots           map[string]interface{}     `json:"slots"`
	Sources         map[string]AgentSlotSource `json:"sources"`
	Missing         []string                   `json:"missing_fields"`
	Plan            map[string]interface{}     `json:"plan,omitempty"`
	ExecutionRef    string                     `json:"execution_ref,omitempty"`
	ExecutionKind   string                     `json:"execution_kind,omitempty"`
	Error           string                     `json:"error,omitempty"`
	SlotIssues      map[string]string          `json:"slot_issues,omitempty"`
	DocumentContext string                     `json:"document_context,omitempty"`
	LastUserMessage string                     `json:"last_user_message,omitempty"`
	IncompleteReply string                     `json:"incomplete_reply,omitempty"`
	Document        *AgentDocumentRevision     `json:"document,omitempty"`
}

func (d *AgentDraft) Init() {
	if d.Slots == nil {
		d.Slots = map[string]interface{}{}
	}
	if d.Sources == nil {
		d.Sources = map[string]AgentSlotSource{}
	}
	if d.Missing == nil {
		d.Missing = []string{}
	}
	if d.Status == "" {
		d.Status = "draft"
	}
}

func (d *AgentDraft) SetSlot(key string, value interface{}, source, evidence string) {
	d.Init()
	d.Slots[key] = value
	d.Sources[key] = AgentSlotSource{source, evidence, d.Version}
}

// Fixed slot whitelist; the LLM cannot supply model ids, tools, confirmation or
// executable parameters. It proposes only changes with current-turn evidence.
func ApplyAgentSlotUpdates(d *AgentDraft, updates, evidence map[string]interface{}, userText string) error {
	d.Init()
	for key, value := range updates {
		valid := false
		switch key {
		case "prompt", "script", "generation_prompt", "character", "style", "ending", "music_prompt", "platform", "requirements":
			s, ok := value.(string)
			valid = ok && len([]rune(s)) <= 20000
		case "media_type":
			s, ok := value.(string)
			valid = ok && (s == "text" || s == "image" || s == "video" || s == "speech" || s == "music")
		case "voice_gender":
			s, ok := value.(string)
			valid = ok && (s == "male" || s == "female")
		case "target_duration_sec":
			n := intFromAgentAny(value)
			valid = n >= 1 && n <= 600 && fmt.Sprint(n) == fmt.Sprint(value)
		case "speech_rate", "max_speech_rate":
			n, err := strconv.ParseFloat(fmt.Sprint(value), 64)
			valid = err == nil && n >= 0.5 && n <= 2
		case "image_count":
			n := intFromAgentAny(value)
			valid = n >= 1 && n <= 6 && fmt.Sprint(n) == fmt.Sprint(value)
		case "document_page_count":
			n := intFromAgentAny(value)
			valid = n >= 0 && n <= 100 && fmt.Sprint(n) == fmt.Sprint(value)
		case "aspect_ratio":
			s, ok := value.(string)
			valid = ok && (s == "" || s == "16:9" || s == "9:16" || s == "1:1" || s == "4:3" || s == "3:4")
		case "quality":
			s, ok := value.(string)
			valid = ok && (s == "" || s == "480p" || s == "720p" || s == "1080p" || s == "1k" || s == "2k" || s == "4k")
		case "audio_strategy":
			s, ok := value.(string)
			valid = ok && (s == "" || s == "video_native" || s == "tts_only" || s == "hybrid")
		case "narration_perspective":
			s, ok := value.(string)
			valid = ok && (s == "smart" || s == "first_person" || s == "third_person" || s == "character_dialogue")
		case "use_previous_media", "is_instrumental":
			_, valid = value.(bool)
		default:
			return fmt.Errorf("不支持的需求字段：%s", key)
		}
		if !valid {
			return fmt.Errorf("需求字段 %s 的格式或范围不正确", key)
		}
	}
	for key, value := range updates {
		quote, _ := evidence[key].(string)
		explicit := strings.TrimSpace(quote) != "" && strings.Contains(userText, quote)
		if _, exists := d.Slots[key]; exists && !explicit {
			// Missing evidence is not permission to overwrite an established value.
			continue
		}
		source := "inferred"
		if explicit {
			source = "user"
		}
		d.SetSlot(key, value, source, quote)
	}
	return nil
}

func (s *ChatService) GetAgentDraft(ctx context.Context, userID int64, conversationID string) (*AgentDraft, error) {
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT agent_state FROM conversations WHERE public_id=$1 AND user_id=$2`, conversationID, userID).Scan(&raw); err != nil {
		return nil, err
	}
	d := &AgentDraft{}
	if err := json.Unmarshal(raw, d); err != nil {
		return nil, err
	}
	d.Init()
	if d.Status == "executing" || d.Status == "failed" {
		return s.recoverAgentSubmission(ctx, userID, conversationID)
	}
	return d, nil
}

// Serialize recovery with task insertion, not with an HTTP request. A late old
// request must pass the same row/version fence before creating or billing work.
func validateAgentSubmissionTx(ctx context.Context, tx pgx.Tx, userID int64, input map[string]interface{}) error {
	key := stringValue(input["_agent_confirmation"])
	if key == "" {
		return nil
	}
	pos := strings.LastIndexByte(key, ':')
	if pos < 1 {
		return errors.New("无效的 Agent 确认标记")
	}
	version, err := strconv.ParseInt(key[pos+1:], 10, 64)
	if err != nil || version <= 0 {
		return errors.New("无效的 Agent 确认版本")
	}
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT agent_state FROM conversations WHERE public_id=$1 AND user_id=$2 FOR UPDATE`, key[:pos], userID).Scan(&raw); err != nil {
		return err
	}
	var draft AgentDraft
	if err := json.Unmarshal(raw, &draft); err != nil {
		return err
	}
	if draft.Status != "executing" || draft.Version != version {
		return errors.New("提交版本已失效，请读取最新方案并重新确认；未创建生成任务")
	}
	return nil
}

func (s *ChatService) recoverAgentSubmission(ctx context.Context, userID int64, conversationID string) (*AgentDraft, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var raw []byte
	var expired bool
	if err := tx.QueryRow(ctx, `SELECT agent_state,updated_at < now()-interval '5 minutes' FROM conversations WHERE public_id=$1 AND user_id=$2 FOR UPDATE`, conversationID, userID).Scan(&raw, &expired); err != nil {
		return nil, err
	}
	d := &AgentDraft{}
	if err := json.Unmarshal(raw, d); err != nil {
		return nil, err
	}
	d.Init()
	if d.Status != "executing" && d.Status != "failed" {
		return d, nil
	}
	var kind, ref string
	err = tx.QueryRow(ctx, `SELECT kind,ref FROM (
 SELECT 'generation' AS kind,task_no AS ref FROM tasks WHERE user_id=$1 AND input->>'_agent_confirmation'=$2
 UNION ALL SELECT 'workflow',public_id FROM workflow_projects WHERE user_id=$1 AND inputs->>'_agent_confirmation'=$2
 ) existing LIMIT 1`, userID, AgentConfirmationKey(conversationID, d.Version)).Scan(&kind, &ref)
	if err == nil {
		d.Status, d.ExecutionKind, d.ExecutionRef, d.Error = "submitted", kind, ref, ""
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	} else if d.Status == "executing" && expired {
		d.Version++ // Fence the old request, including one that resumes very late.
		d.Status, d.ExecutionKind, d.ExecutionRef = "draft", "", ""
		if len(d.Missing) == 0 && len(d.Plan) > 0 {
			d.Status = "awaiting_confirmation"
		}
		d.Error = "上次提交中断，未找到已创建任务；需求已保留，请重新确认后执行。"
		if d.Plan != nil {
			d.Plan["plan_version"], d.Plan["draft_status"] = d.Version, d.Status
		}
	} else {
		return d, nil
	}
	raw, err = json.Marshal(d)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `UPDATE conversations SET agent_state=$3,updated_at=now() WHERE public_id=$1 AND user_id=$2`, conversationID, userID, raw); err != nil {
		return nil, err
	}
	return d, tx.Commit(ctx)
}

func (s *ChatService) BeginAgentDraftTurn(ctx context.Context, userID int64, conversationID string, baseVersion int64) (*AgentDraft, error) {
	d, err := s.GetAgentDraft(ctx, userID, conversationID)
	if err != nil {
		return nil, err
	}
	if d.Version != baseVersion {
		return nil, errors.New("会话方案已更新，请刷新历史后再修改")
	}
	if d.Status == "executing" {
		return nil, errors.New("已确认的任务正在提交，请先查看任务状态，不要重复执行")
	}
	d.Version++
	// Keep the last proposal and execution reference available for discussion
	// and incremental edits. Status and version fence execution during this turn.
	d.Status, d.Error = "planning", ""
	raw, _ := json.Marshal(d)
	result, err := s.db.Exec(ctx, `UPDATE conversations SET agent_state=$3,updated_at=now()
	 WHERE public_id=$1 AND user_id=$2 AND COALESCE((agent_state->>'version')::bigint,0)=$4
	 AND COALESCE(agent_state->>'status','draft') <> 'executing'`, conversationID, userID, raw, baseVersion)
	if err != nil {
		return nil, err
	}
	if result.RowsAffected() != 1 {
		return nil, errors.New("方案已被其他操作更新，请刷新后重试")
	}
	return d, nil
}

func (s *ChatService) SaveAgentDraft(ctx context.Context, userID int64, conversationID string, d *AgentDraft) error {
	raw, err := json.Marshal(d)
	if err != nil {
		return err
	}
	result, err := s.db.Exec(ctx, `UPDATE conversations SET agent_state=$3,updated_at=now() WHERE public_id=$1 AND user_id=$2
	 AND (agent_state->>'version')::bigint=$4 AND agent_state->>'status'='planning'`, conversationID, userID, raw, d.Version)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errors.New("本轮方案已失效，请使用会话最新方案")
	}
	return nil
}

func AgentConfirmationKey(conversationID string, version int64) string {
	return fmt.Sprintf("%s:%d", conversationID, version)
}

// A failed planner is not an executable plan. Fence cleanup against cancellation,
// successful finalization and newer turns; keep source material for a manual retry.
func (s *ChatService) FailAgentPlanning(ctx context.Context, userID int64, conversationID string, version int64, message, partial string) error {
	chars := []rune(partial)
	if len(chars) > 8000 {
		partial = string(chars[:8000]) + "\n[未完成草稿已截断，不可执行]"
	}
	patch, _ := json.Marshal(map[string]interface{}{"status": "failed", "error": message, "incomplete_reply": partial, "plan": nil})
	_, err := s.db.Exec(ctx, `UPDATE conversations SET agent_state=agent_state || $4::jsonb,updated_at=now()
	 WHERE public_id=$1 AND user_id=$2 AND (agent_state->>'version')::bigint=$3 AND agent_state->>'status'='planning'`, conversationID, userID, version, patch)
	return err
}

func (s *ChatService) ClaimAgentDraft(ctx context.Context, userID int64, conversationID string, version int64) error {
	result, err := s.db.Exec(ctx, `UPDATE conversations SET agent_state=jsonb_set(agent_state,'{status}','"executing"'::jsonb),updated_at=now()
	 WHERE public_id=$1 AND user_id=$2 AND (agent_state->>'version')::bigint=$3
	 AND agent_state->>'status'='awaiting_confirmation' AND jsonb_array_length(agent_state->'missing_fields')=0`, conversationID, userID, version)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errors.New("确认已使用、已失效或任务正在提交，请刷新任务状态")
	}
	return nil
}

func (s *ChatService) CompleteAgentDraft(ctx context.Context, userID int64, conversationID string, version int64, kind, ref, failure string) error {
	status := "submitted"
	if ref == "" {
		status = "failed"
	}
	patch, _ := json.Marshal(map[string]interface{}{"status": status, "execution_kind": kind, "execution_ref": ref, "error": failure})
	_, err := s.db.Exec(ctx, `UPDATE conversations SET agent_state=agent_state || $4::jsonb,updated_at=now()
	 WHERE public_id=$1 AND user_id=$2 AND (agent_state->>'version')::bigint=$3 AND agent_state->>'status' IN ('executing','failed')`, conversationID, userID, version, patch)
	return err
}

func (s *ChatService) CancelAgentDraft(ctx context.Context, userID int64, conversationID string, version int64) error {
	patch, _ := json.Marshal(map[string]interface{}{"status": "cancelled", "version": version + 1})
	result, err := s.db.Exec(ctx, `UPDATE conversations SET agent_state=agent_state || $4::jsonb,updated_at=now()
	 WHERE public_id=$1 AND user_id=$2 AND (agent_state->>'version')::bigint=$3
	 AND agent_state->>'status' IN ('planning','draft','awaiting_confirmation','cancelled','failed')`, conversationID, userID, version, patch)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errors.New("方案已变化或已提交，不能取消旧版本")
	}
	return nil
}
