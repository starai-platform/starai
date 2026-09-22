package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/util"
)

const maxCanvasDocumentBytes = 2 * 1024 * 1024

type CanvasService struct {
	db *pgxpool.Pool
}

func NewCanvasService(db *pgxpool.Pool) *CanvasService {
	return &CanvasService{db: db}
}

type CanvasDTO struct {
	PublicID     string          `json:"public_id"`
	WorkflowCode string          `json:"workflow_code"`
	Title        string          `json:"title"`
	Document     json.RawMessage `json:"document,omitempty"`
	CreatedAt    string          `json:"created_at"`
	UpdatedAt    string          `json:"updated_at"`
}

type SaveCanvasInput struct {
	WorkflowCode string          `json:"workflow_code"`
	Title        string          `json:"title"`
	Document     json.RawMessage `json:"document"`
}

func validateCanvasInput(input *SaveCanvasInput) error {
	input.WorkflowCode = strings.TrimSpace(input.WorkflowCode)
	if input.WorkflowCode == "" {
		input.WorkflowCode = "infinite_canvas"
	}
	if len(input.WorkflowCode) > 64 {
		return errors.New("工作流编码不能超过 64 个字符")
	}
	for _, char := range input.WorkflowCode {
		if !(char == '_' || char == '-' || char >= 'a' && char <= 'z' || char >= '0' && char <= '9') {
			return errors.New("工作流编码格式无效")
		}
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" {
		input.Title = "未命名画布"
	}
	if len([]rune(input.Title)) > 120 {
		return errors.New("画布名称不能超过 120 个字符")
	}
	if len(input.Document) == 0 || !json.Valid(input.Document) {
		return errors.New("画布数据格式无效")
	}
	if len(input.Document) > maxCanvasDocumentBytes {
		return errors.New("画布数据不能超过 2MB")
	}
	var shape struct {
		Version  int               `json:"version"`
		Nodes    []json.RawMessage `json:"nodes"`
		Edges    []json.RawMessage `json:"edges"`
		Viewport json.RawMessage   `json:"viewport"`
	}
	if err := json.Unmarshal(input.Document, &shape); err != nil {
		return errors.New("画布数据格式无效")
	}
	if shape.Nodes == nil || shape.Edges == nil {
		return errors.New("画布节点和连线必须是数组")
	}
	if len(shape.Nodes) > 500 || len(shape.Edges) > 1000 {
		return errors.New("单个画布最多支持 500 个节点和 1000 条连线")
	}
	indegree := make(map[string]int, len(shape.Nodes))
	for _, raw := range shape.Nodes {
		var node struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &node); err != nil || strings.TrimSpace(node.ID) == "" {
			return errors.New("画布节点缺少有效编号")
		}
		if _, exists := indegree[node.ID]; exists {
			return errors.New("画布节点编号不能重复")
		}
		indegree[node.ID] = 0
	}
	edgeIDs := make(map[string]bool, len(shape.Edges))
	outgoing := make(map[string][]string)
	for _, raw := range shape.Edges {
		var edge struct {
			ID     string `json:"id"`
			Source string `json:"source"`
			Target string `json:"target"`
		}
		if err := json.Unmarshal(raw, &edge); err != nil || strings.TrimSpace(edge.ID) == "" || edgeIDs[edge.ID] {
			return errors.New("画布连线编号无效或重复")
		}
		edgeIDs[edge.ID] = true
		_, sourceExists := indegree[edge.Source]
		_, targetExists := indegree[edge.Target]
		if !sourceExists || !targetExists {
			return errors.New("画布连线引用了不存在的节点")
		}
		indegree[edge.Target]++
		outgoing[edge.Source] = append(outgoing[edge.Source], edge.Target)
	}
	queue := make([]string, 0, len(indegree))
	for id, degree := range indegree {
		if degree == 0 {
			queue = append(queue, id)
		}
	}
	for index := 0; index < len(queue); index++ {
		for _, target := range outgoing[queue[index]] {
			indegree[target]--
			if indegree[target] == 0 {
				queue = append(queue, target)
			}
		}
	}
	if len(queue) != len(shape.Nodes) {
		return errors.New("画布连线不能形成循环")
	}
	return nil
}

func (s *CanvasService) Create(ctx context.Context, userID int64, input SaveCanvasInput) (*CanvasDTO, error) {
	if err := validateCanvasInput(&input); err != nil {
		return nil, err
	}
	item := &CanvasDTO{PublicID: util.NewPublicID("canvas"), Document: input.Document}
	var created, updated time.Time
	err := s.db.QueryRow(ctx, `
		INSERT INTO infinite_canvases (public_id, user_id, workflow_code, title, document)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING workflow_code, title, created_at, updated_at`,
		item.PublicID, userID, input.WorkflowCode, input.Title, input.Document).
		Scan(&item.WorkflowCode, &item.Title, &created, &updated)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = created.Format(time.RFC3339)
	item.UpdatedAt = updated.Format(time.RFC3339)
	return item, nil
}

func (s *CanvasService) List(ctx context.Context, userID int64, workflowCode string, page, pageSize int, includeTotal ...bool) ([]CanvasDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 30
	}
	workflowCode = strings.TrimSpace(workflowCode)
	if workflowCode == "" {
		workflowCode = "infinite_canvas"
	}
	total := -1
	countTotal := len(includeTotal) == 0 || includeTotal[0]
	if countTotal {
		if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM infinite_canvases
		WHERE user_id=$1 AND workflow_code=$2
		  AND (
		    document ? 'submitted_at'
		    OR EXISTS (
		      SELECT 1 FROM jsonb_array_elements(document->'nodes') AS node
		      WHERE COALESCE(node->'data'->>'taskNo', '') <> ''
		         OR COALESCE(node->'data'->>'outputText', '') <> ''
		         OR COALESCE(node->'data'->>'outputUrl', '') <> ''
		         OR CASE WHEN jsonb_typeof(node->'data'->'taskNos') = 'array' THEN jsonb_array_length(node->'data'->'taskNos') ELSE 0 END > 0
		    )
		  )`, userID, workflowCode).Scan(&total); err != nil {
			return nil, 0, err
		}
	}
	limit := pageSize
	if !countTotal {
		limit++
	}
	rows, err := s.db.Query(ctx, `
		SELECT public_id, workflow_code, title, created_at, updated_at
		FROM infinite_canvases
		WHERE user_id=$1 AND workflow_code=$2
		  AND (
		    document ? 'submitted_at'
		    OR EXISTS (
		      SELECT 1 FROM jsonb_array_elements(document->'nodes') AS node
		      WHERE COALESCE(node->'data'->>'taskNo', '') <> ''
		         OR COALESCE(node->'data'->>'outputText', '') <> ''
		         OR COALESCE(node->'data'->>'outputUrl', '') <> ''
		         OR CASE WHEN jsonb_typeof(node->'data'->'taskNos') = 'array' THEN jsonb_array_length(node->'data'->'taskNos') ELSE 0 END > 0
		    )
		  )
		ORDER BY updated_at DESC, id DESC
		LIMIT $3 OFFSET $4`, userID, workflowCode, limit, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]CanvasDTO, 0)
	for rows.Next() {
		var item CanvasDTO
		var created, updated time.Time
		if err := rows.Scan(&item.PublicID, &item.WorkflowCode, &item.Title, &created, &updated); err != nil {
			return nil, 0, err
		}
		item.CreatedAt = created.Format(time.RFC3339)
		item.UpdatedAt = updated.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, total, rows.Err()
}

func (s *CanvasService) Get(ctx context.Context, userID int64, publicID string) (*CanvasDTO, error) {
	var item CanvasDTO
	var created, updated time.Time
	err := s.db.QueryRow(ctx, `
		SELECT public_id, workflow_code, title, document, created_at, updated_at
		FROM infinite_canvases
		WHERE user_id=$1 AND public_id=$2`, userID, publicID).
		Scan(&item.PublicID, &item.WorkflowCode, &item.Title, &item.Document, &created, &updated)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = created.Format(time.RFC3339)
	item.UpdatedAt = updated.Format(time.RFC3339)
	return &item, nil
}

func (s *CanvasService) Update(ctx context.Context, userID int64, publicID string, input SaveCanvasInput) (*CanvasDTO, error) {
	if err := validateCanvasInput(&input); err != nil {
		return nil, err
	}
	var item CanvasDTO
	item.Document = input.Document
	var created, updated time.Time
	err := s.db.QueryRow(ctx, `
		UPDATE infinite_canvases
		SET title=$3, document=$4, updated_at=now()
		WHERE user_id=$1 AND public_id=$2
		RETURNING public_id, workflow_code, title, created_at, updated_at`,
		userID, publicID, input.Title, input.Document).
		Scan(&item.PublicID, &item.WorkflowCode, &item.Title, &created, &updated)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = created.Format(time.RFC3339)
	item.UpdatedAt = updated.Format(time.RFC3339)
	return &item, nil
}

func (s *CanvasService) Delete(ctx context.Context, userID int64, publicID string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM infinite_canvases WHERE user_id=$1 AND public_id=$2`, userID, publicID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
