package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type HomeService struct {
	db *pgxpool.Pool
}

func NewHomeService(db *pgxpool.Pool) *HomeService {
	return &HomeService{db: db}
}

type HomeCardDTO struct {
	ID          int64   `json:"id"`
	Key         string  `json:"key"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
	IconURL     *string `json:"icon_url,omitempty"`
	IconEmoji   *string `json:"icon_emoji,omitempty"`
	Theme       string  `json:"theme"`
	SortOrder   int     `json:"sort_order"`
	IsEnabled   bool    `json:"is_enabled"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

type UpsertHomeCardInput struct {
	Key         string `json:"key"`
	Title       string `json:"title"`
	Description string `json:"description"`
	IconURL     string `json:"icon_url"`
	IconEmoji   string `json:"icon_emoji"`
	Theme       string `json:"theme"`
	SortOrder   int    `json:"sort_order"`
	IsEnabled   bool   `json:"is_enabled"`
}

func (s *HomeService) ListCards(ctx context.Context, includeDisabled bool) ([]HomeCardDTO, error) {
	q := `SELECT id, key, title, description, icon_url, icon_emoji, theme, sort_order, is_enabled, created_at, updated_at
		FROM home_cards`
	if !includeDisabled {
		q += ` WHERE is_enabled=true`
	}
	q += ` ORDER BY sort_order ASC, id ASC`

	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []HomeCardDTO
	for rows.Next() {
		var c HomeCardDTO
		var created, updated time.Time
		if err := rows.Scan(&c.ID, &c.Key, &c.Title, &c.Description, &c.IconURL, &c.IconEmoji, &c.Theme, &c.SortOrder, &c.IsEnabled, &created, &updated); err != nil {
			return nil, err
		}
		c.CreatedAt = created.Format(time.RFC3339)
		c.UpdatedAt = updated.Format(time.RFC3339)
		out = append(out, c)
	}
	return out, nil
}

func (s *HomeService) UpsertCard(ctx context.Context, in UpsertHomeCardInput) error {
	if in.Key == "" || in.Title == "" {
		return errors.New("key/title 必填")
	}
	if in.Theme == "" {
		in.Theme = "gray"
	}
	var desc, iconURL, iconEmoji *string
	if in.Description != "" {
		desc = &in.Description
	}
	if in.IconURL != "" {
		iconURL = &in.IconURL
	}
	if in.IconEmoji != "" {
		iconEmoji = &in.IconEmoji
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO home_cards (key, title, description, icon_url, icon_emoji, theme, sort_order, is_enabled, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
		ON CONFLICT (key) DO UPDATE SET
			title=$2, description=$3, icon_url=$4, icon_emoji=$5, theme=$6, sort_order=$7, is_enabled=$8, updated_at=now()`,
		in.Key, in.Title, desc, iconURL, iconEmoji, in.Theme, in.SortOrder, in.IsEnabled)
	return err
}

func (s *HomeService) DeleteCard(ctx context.Context, key string) error {
	ct, err := s.db.Exec(ctx, `DELETE FROM home_cards WHERE key=$1`, key)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

