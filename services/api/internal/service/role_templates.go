package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type RoleTemplateService struct {
	db *pgxpool.Pool
}

func NewRoleTemplateService(db *pgxpool.Pool) *RoleTemplateService {
	return &RoleTemplateService{db: db}
}

type RoleTemplateDTO struct {
	ID          int64   `json:"id"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	SystemPrompt string `json:"system_prompt"`
	IconURL     *string `json:"icon_url,omitempty"`
	IsEnabled   bool    `json:"is_enabled"`
	SortOrder   int     `json:"sort_order"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

type UpsertRoleTemplateInput struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	SystemPrompt string `json:"system_prompt"`
	IconURL      string `json:"icon_url"`
	IsEnabled    bool   `json:"is_enabled"`
	SortOrder    int    `json:"sort_order"`
}

func (s *RoleTemplateService) List(ctx context.Context, includeDisabled bool) ([]RoleTemplateDTO, error) {
	q := `SELECT id, code, name, description, system_prompt, icon_url, is_enabled, sort_order, created_at, updated_at FROM role_templates`
	if !includeDisabled {
		q += ` WHERE is_enabled=true`
	}
	q += ` ORDER BY sort_order ASC, id ASC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RoleTemplateDTO
	for rows.Next() {
		var t RoleTemplateDTO
		var created, updated time.Time
		if err := rows.Scan(&t.ID, &t.Code, &t.Name, &t.Description, &t.SystemPrompt, &t.IconURL, &t.IsEnabled, &t.SortOrder, &created, &updated); err != nil {
			return nil, err
		}
		t.CreatedAt = created.Format(time.RFC3339)
		t.UpdatedAt = updated.Format(time.RFC3339)
		out = append(out, t)
	}
	return out, nil
}

func (s *RoleTemplateService) Upsert(ctx context.Context, in UpsertRoleTemplateInput) error {
	if in.Code == "" || in.Name == "" || in.SystemPrompt == "" {
		return errors.New("code/name/system_prompt 必填")
	}
	var desc *string
	if in.Description != "" {
		desc = &in.Description
	}
	var icon *string
	if in.IconURL != "" {
		icon = &in.IconURL
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO role_templates (code, name, description, system_prompt, icon_url, is_enabled, sort_order, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,now())
		ON CONFLICT (code) DO UPDATE SET
			name=$2, description=$3, system_prompt=$4, icon_url=$5, is_enabled=$6, sort_order=$7, updated_at=now()`,
		in.Code, in.Name, desc, in.SystemPrompt, icon, in.IsEnabled, in.SortOrder)
	return err
}

func (s *RoleTemplateService) Delete(ctx context.Context, code string) error {
	ct, err := s.db.Exec(ctx, `DELETE FROM role_templates WHERE code=$1`, code)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

