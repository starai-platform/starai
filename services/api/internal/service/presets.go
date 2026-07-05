package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PresetService struct {
	db *pgxpool.Pool
}

func NewPresetService(db *pgxpool.Pool) *PresetService {
	return &PresetService{db: db}
}

// ---------- Channel presets ----------

type ChannelPresetDTO struct {
	ID                int64    `json:"id"`
	Key               string   `json:"key"`
	Name              string   `json:"name"`
	Description       *string  `json:"description,omitempty"`
	Strategy          string   `json:"strategy"`
	IsFallbackEnabled bool     `json:"is_fallback_enabled"`
	ModelCodes        []string `json:"model_codes"`
	AnswerModelCodes  []string `json:"answer_model_codes"`
	SummaryModelCodes []string `json:"summary_model_codes"`
	IsEnabled         bool     `json:"is_enabled"`
	SortOrder         int      `json:"sort_order"`
	CreatedAt         string   `json:"created_at"`
	UpdatedAt         string   `json:"updated_at"`
}

type UpsertChannelPresetInput struct {
	Key               string   `json:"key"`
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	Strategy          string   `json:"strategy"`
	IsFallbackEnabled bool     `json:"is_fallback_enabled"`
	ModelCodes        []string `json:"model_codes"`
	AnswerModelCodes  []string `json:"answer_model_codes"`
	SummaryModelCodes []string `json:"summary_model_codes"`
	IsEnabled         bool     `json:"is_enabled"`
	SortOrder         int      `json:"sort_order"`
}

func (s *PresetService) ListChannelPresets(ctx context.Context, includeDisabled bool) ([]ChannelPresetDTO, error) {
	q := `SELECT id, key, name, description, strategy, is_fallback_enabled, model_codes, is_enabled, sort_order, created_at, updated_at
		FROM model_channel_presets`
	if !includeDisabled {
		q += ` WHERE is_enabled=true`
	}
	q += ` ORDER BY sort_order ASC, id ASC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChannelPresetDTO
	for rows.Next() {
		var p ChannelPresetDTO
		var codes []byte
		var created, updated time.Time
		if err := rows.Scan(&p.ID, &p.Key, &p.Name, &p.Description, &p.Strategy, &p.IsFallbackEnabled, &codes, &p.IsEnabled, &p.SortOrder, &created, &updated); err != nil {
			return nil, err
		}
		p.AnswerModelCodes, p.SummaryModelCodes = parseChannelPresetCodes(codes)
		p.ModelCodes = p.AnswerModelCodes
		p.CreatedAt = created.Format(time.RFC3339)
		p.UpdatedAt = updated.Format(time.RFC3339)
		out = append(out, p)
	}
	return out, nil
}

func (s *PresetService) UpsertChannelPreset(ctx context.Context, in UpsertChannelPresetInput) error {
	if in.Key == "" || in.Name == "" {
		return errors.New("key/name 必填")
	}
	if in.Strategy == "" {
		in.Strategy = "price_first"
	}
	answerCodes := in.AnswerModelCodes
	if len(answerCodes) == 0 {
		answerCodes = in.ModelCodes
	}
	if len(answerCodes) < 2 {
		return errors.New("问答模型至少选择 2 个")
	}
	if len(in.SummaryModelCodes) < 1 {
		return errors.New("总结模型至少选择 1 个")
	}
	codes, _ := json.Marshal(map[string][]string{"answer": answerCodes, "summary": in.SummaryModelCodes})
	var desc *string
	if in.Description != "" {
		desc = &in.Description
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO model_channel_presets (key, name, description, strategy, is_fallback_enabled, model_codes, is_enabled, sort_order, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
		ON CONFLICT (key) DO UPDATE SET
			name=$2, description=$3, strategy=$4, is_fallback_enabled=$5, model_codes=$6, is_enabled=$7, sort_order=$8, updated_at=now()`,
		in.Key, in.Name, desc, in.Strategy, in.IsFallbackEnabled, codes, in.IsEnabled, in.SortOrder)
	return err
}

func parseChannelPresetCodes(raw []byte) (answer []string, summary []string) {
	var legacy []string
	if err := json.Unmarshal(raw, &legacy); err == nil {
		return legacy, nil
	}
	var obj struct {
		Answer  []string `json:"answer"`
		Summary []string `json:"summary"`
	}
	_ = json.Unmarshal(raw, &obj)
	return obj.Answer, obj.Summary
}

func (s *PresetService) DeleteChannelPreset(ctx context.Context, key string) error {
	ct, err := s.db.Exec(ctx, `DELETE FROM model_channel_presets WHERE key=$1`, key)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ---------- Prompt roles ----------

type PromptRoleDTO struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	Description  *string `json:"description,omitempty"`
	SystemPrompt string  `json:"system_prompt"`
	IconURL      *string `json:"icon_url,omitempty"`
	IsDefault    bool    `json:"is_default"`
	CreatedAt    string  `json:"created_at"`
}

type CreatePromptRoleInput struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	SystemPrompt string `json:"system_prompt"`
	IconURL      string `json:"icon_url"`
	IsDefault    bool   `json:"is_default"`
}

func (s *PresetService) ListPromptRoles(ctx context.Context, userID int64) ([]PromptRoleDTO, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, name, description, system_prompt, icon_url, is_default, created_at
		FROM prompt_roles
		WHERE user_id=$1 OR user_id IS NULL
		ORDER BY is_default DESC, id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PromptRoleDTO
	for rows.Next() {
		var r PromptRoleDTO
		var created time.Time
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &r.SystemPrompt, &r.IconURL, &r.IsDefault, &created); err != nil {
			return nil, err
		}
		r.CreatedAt = created.Format(time.RFC3339)
		out = append(out, r)
	}
	return out, nil
}

func (s *PresetService) CreatePromptRole(ctx context.Context, userID int64, in CreatePromptRoleInput) (*PromptRoleDTO, error) {
	if in.Name == "" || in.SystemPrompt == "" {
		return nil, errors.New("name/system_prompt 必填")
	}
	var desc *string
	if in.Description != "" {
		desc = &in.Description
	}
	var icon *string
	if in.IconURL != "" {
		icon = &in.IconURL
	}
	if in.IsDefault {
		s.db.Exec(ctx, `UPDATE prompt_roles SET is_default=false WHERE user_id=$1`, userID)
	}
	var id int64
	var created time.Time
	err := s.db.QueryRow(ctx, `
		INSERT INTO prompt_roles (user_id, name, description, system_prompt, icon_url, is_default)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
		userID, in.Name, desc, in.SystemPrompt, icon, in.IsDefault).Scan(&id, &created)
	if err != nil {
		return nil, err
	}
	return &PromptRoleDTO{ID: id, Name: in.Name, Description: desc, SystemPrompt: in.SystemPrompt, IconURL: icon, IsDefault: in.IsDefault, CreatedAt: created.Format(time.RFC3339)}, nil
}
