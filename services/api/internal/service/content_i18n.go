package service

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed ui_translation_catalog.json
var uiTranslationCatalogJSON []byte

func UITranslationSourceCatalog() map[string]string {
	result := map[string]string{}
	_ = json.Unmarshal(uiTranslationCatalogJSON, &result)
	return result
}

const defaultContentSourceLocale = "zh-CN"

var defaultContentTargetLocales = []string{"en-US", "ja-JP", "ko-KR", "vi-VN"}

type ContentI18nService struct {
	db *pgxpool.Pool
}

func NewContentI18nService(db *pgxpool.Pool) *ContentI18nService {
	return &ContentI18nService{db: db}
}

type ContentTranslationRow struct {
	SourceID          int64  `json:"source_id"`
	EntityType        string `json:"entity_type"`
	EntityKey         string `json:"entity_key"`
	FieldPath         string `json:"field_path"`
	SourceLocale      string `json:"source_locale"`
	SourceText        string `json:"source_text"`
	SourceHash        string `json:"source_hash"`
	Locale            string `json:"locale"`
	Value             string `json:"value"`
	Status            string `json:"status"`
	TranslationSource string `json:"translation_source"`
	ErrorMessage      string `json:"error_message,omitempty"`
	UpdatedAt         string `json:"updated_at"`
}

type PendingContentTranslation struct {
	SourceID   int64  `json:"source_id"`
	EntityType string `json:"entity_type"`
	EntityKey  string `json:"entity_key"`
	FieldPath  string `json:"field_path"`
	SourceText string `json:"source_text"`
	Locale     string `json:"locale"`
}

type ContentTranslationStats struct {
	Locale     string `json:"locale"`
	Total      int    `json:"total"`
	Pending    int    `json:"pending"`
	Translated int    `json:"translated"`
	Reviewed   int    `json:"reviewed"`
	Failed     int    `json:"failed"`
}

func (s *ContentI18nService) SourceLocale(ctx context.Context) string {
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key='i18n_source_locale'`).Scan(&raw); err == nil {
		var locale string
		if json.Unmarshal(raw, &locale) == nil && normalizeContentLocale(locale) != "" {
			return normalizeContentLocale(locale)
		}
	}
	return defaultContentSourceLocale
}

func (s *ContentI18nService) TargetLocales(ctx context.Context) []string {
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key='i18n_target_locales'`).Scan(&raw); err == nil {
		var values []string
		if json.Unmarshal(raw, &values) == nil {
			if normalized := normalizeContentLocales(values); len(normalized) > 0 {
				return normalized
			}
		}
		var encoded string
		if json.Unmarshal(raw, &encoded) == nil && json.Unmarshal([]byte(encoded), &values) == nil {
			if normalized := normalizeContentLocales(values); len(normalized) > 0 {
				return normalized
			}
		}
	}
	return append([]string{}, defaultContentTargetLocales...)
}

func (s *ContentI18nService) SyncEntity(ctx context.Context, entityType, entityKey string, fields map[string]string) error {
	entityType = strings.TrimSpace(entityType)
	entityKey = strings.TrimSpace(entityKey)
	if entityType == "" || entityKey == "" {
		return errors.New("translation entity is required")
	}
	sourceLocale := s.SourceLocale(ctx)
	targetLocales := s.TargetLocales(ctx)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	paths := make([]string, 0, len(fields))
	for path, text := range fields {
		path = strings.TrimSpace(path)
		text = strings.TrimSpace(text)
		if path == "" || text == "" {
			continue
		}
		paths = append(paths, path)
		hash := contentSourceHash(text)
		var sourceID int64
		var oldHash string
		err := tx.QueryRow(ctx, `
			SELECT id, source_hash FROM content_translation_sources
			WHERE entity_type=$1 AND entity_key=$2 AND field_path=$3
			FOR UPDATE`, entityType, entityKey, path).Scan(&sourceID, &oldHash)
		if errors.Is(err, pgx.ErrNoRows) {
			err = tx.QueryRow(ctx, `
				INSERT INTO content_translation_sources
				(entity_type, entity_key, field_path, source_locale, source_text, source_hash)
				VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, entityType, entityKey, path, sourceLocale, text, hash).Scan(&sourceID)
			oldHash = ""
		} else if err == nil && oldHash != hash {
			_, err = tx.Exec(ctx, `
				UPDATE content_translation_sources
				SET source_locale=$1, source_text=$2, source_hash=$3, updated_at=now()
				WHERE id=$4`, sourceLocale, text, hash, sourceID)
			if err == nil {
				_, err = tx.Exec(ctx, `
					UPDATE content_translations SET status='pending', error_message=NULL, updated_at=now()
					WHERE source_id=$1 AND source_hash<>$2`, sourceID, hash)
			}
		}
		if err != nil {
			return err
		}
		for _, locale := range targetLocales {
			if locale == sourceLocale {
				continue
			}
			if _, err = tx.Exec(ctx, `
				INSERT INTO content_translations (source_id, locale, source_hash, status)
				VALUES ($1,$2,$3,'pending')
				ON CONFLICT (source_id, locale) DO NOTHING`, sourceID, locale, hash); err != nil {
				return err
			}
		}
	}
	if len(paths) == 0 {
		_, err = tx.Exec(ctx, `DELETE FROM content_translation_sources WHERE entity_type=$1 AND entity_key=$2`, entityType, entityKey)
	} else {
		_, err = tx.Exec(ctx, `
			DELETE FROM content_translation_sources
			WHERE entity_type=$1 AND entity_key=$2 AND NOT (field_path = ANY($3))`, entityType, entityKey, paths)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *ContentI18nService) DeleteEntity(ctx context.Context, entityType, entityKey string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM content_translation_sources WHERE entity_type=$1 AND entity_key=$2`, entityType, entityKey)
	return err
}

func (s *ContentI18nService) SyncCatalog(ctx context.Context, models *ModelService, agents *AgentService) (int, error) {
	count := 0
	modelItems, err := models.ListAll(ctx)
	if err != nil {
		return count, err
	}
	for _, model := range modelItems {
		description := ""
		if model.Description != nil {
			description = *model.Description
		}
		if err := s.SyncEntity(ctx, "model", model.Code, ExtractModelTranslationFields(model.DisplayName, description, model.Tags, model.InputSchema, model.RuntimeRule)); err != nil {
			return count, err
		}
		count++
	}
	workflowItems, err := agents.List(ctx, true)
	if err != nil {
		return count, err
	}
	for _, workflow := range workflowItems {
		description := ""
		if workflow.Description != nil {
			description = *workflow.Description
		}
		if err := s.SyncEntity(ctx, "workflow", workflow.Code, ExtractWorkflowTranslationFields(workflow.Name, description, workflow.Nodes, workflow.InputSchema, workflow.DisplayConfig)); err != nil {
			return count, err
		}
		count++
	}
	apiDocs, err := models.ListAPIDocs(ctx, true)
	if err != nil {
		return count, err
	}
	for _, doc := range apiDocs {
		if err := s.SyncEntity(ctx, "api_doc", doc.Slug, ExtractAPIDocTranslationFields(doc.Title, doc.Summary, doc.ModelName, doc.ModelDesc, doc.Content)); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func (s *ContentI18nService) Apply(ctx context.Context, entityType, entityKey, locale string, target interface{}) error {
	return s.ApplyBatch(ctx, entityType, locale, map[string]interface{}{entityKey: target})
}

func (s *ContentI18nService) ApplyBatch(ctx context.Context, entityType, locale string, targets map[string]interface{}) error {
	locale = normalizeContentLocale(locale)
	if len(targets) == 0 || locale == "" || locale == s.SourceLocale(ctx) || strings.HasPrefix(locale, "zh-") {
		return nil
	}
	entityKeys := make([]string, 0, len(targets))
	for entityKey := range targets {
		entityKeys = append(entityKeys, entityKey)
	}
	rows, err := s.db.Query(ctx, `
		SELECT s.entity_key, s.field_path, t.locale, t.value
		FROM content_translation_sources s
		JOIN content_translations t ON t.source_id=s.id AND t.source_hash=s.source_hash
		WHERE s.entity_type=$1 AND s.entity_key = ANY($2)
		  AND t.locale = ANY($3)
		  AND t.status IN ('translated','reviewed') AND t.value<>''
		ORDER BY CASE WHEN t.locale=$4 THEN 0 ELSE 1 END`, entityType, entityKeys, []string{locale, "en-US"}, locale)
	if err != nil {
		return err
	}
	defer rows.Close()
	translations := map[string]map[string]string{}
	for rows.Next() {
		var entityKey, path, rowLocale, value string
		if err := rows.Scan(&entityKey, &path, &rowLocale, &value); err != nil {
			return err
		}
		if translations[entityKey] == nil {
			translations[entityKey] = map[string]string{}
		}
		if _, exists := translations[entityKey][path]; !exists {
			translations[entityKey][path] = value
		}
	}
	if len(translations) == 0 {
		return rows.Err()
	}
	for entityKey, values := range translations {
		if target := targets[entityKey]; target != nil {
			if err := applyContentTranslations(target, values); err != nil {
				return err
			}
		}
	}
	return rows.Err()
}

func applyContentTranslations(target interface{}, translations map[string]string) error {
	raw, err := json.Marshal(target)
	if err != nil {
		return err
	}
	var document interface{}
	if err := json.Unmarshal(raw, &document); err != nil {
		return err
	}
	for path, value := range translations {
		document = setJSONPointer(document, path, value)
	}
	localized, err := json.Marshal(document)
	if err != nil {
		return err
	}
	return json.Unmarshal(localized, target)
}

func (s *ContentI18nService) List(ctx context.Context, locale, entityType, status, search string, page, pageSize int) ([]ContentTranslationRow, int, error) {
	locale = normalizeContentLocale(locale)
	if locale == "" {
		locale = "en-US"
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 50
	}
	where := []string{"t.locale=$1"}
	args := []interface{}{locale}
	add := func(sql string, value interface{}) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(sql, len(args)))
	}
	if entityType != "" {
		add("s.entity_type=$%d", entityType)
	}
	if status != "" {
		add("t.status=$%d", status)
	}
	if strings.TrimSpace(search) != "" {
		args = append(args, strings.TrimSpace(search))
		index := len(args)
		where = append(where, fmt.Sprintf("(s.entity_key ILIKE '%%' || $%d || '%%' OR s.field_path ILIKE '%%' || $%d || '%%' OR s.source_text ILIKE '%%' || $%d || '%%' OR t.value ILIKE '%%' || $%d || '%%')", index, index, index, index))
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM content_translation_sources s JOIN content_translations t ON t.source_id=s.id WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(ctx, `
		SELECT s.id, s.entity_type, s.entity_key, s.field_path, s.source_locale, s.source_text, s.source_hash,
		       t.locale, t.value, t.status, t.translation_source, COALESCE(t.error_message,''), t.updated_at
		FROM content_translation_sources s JOIN content_translations t ON t.source_id=s.id
		WHERE `+whereSQL+` ORDER BY t.updated_at DESC, s.id ASC LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := []ContentTranslationRow{}
	for rows.Next() {
		var item ContentTranslationRow
		var updated time.Time
		if err := rows.Scan(&item.SourceID, &item.EntityType, &item.EntityKey, &item.FieldPath, &item.SourceLocale,
			&item.SourceText, &item.SourceHash, &item.Locale, &item.Value, &item.Status, &item.TranslationSource, &item.ErrorMessage, &updated); err != nil {
			return nil, 0, err
		}
		item.UpdatedAt = updated.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, total, rows.Err()
}

func (s *ContentI18nService) SaveManual(ctx context.Context, sourceID int64, locale, value string, reviewed bool) error {
	locale = normalizeContentLocale(locale)
	value = strings.TrimSpace(value)
	if sourceID <= 0 || locale == "" || value == "" {
		return errors.New("翻译来源、语言和内容不能为空")
	}
	status := "translated"
	var reviewedAt interface{}
	if reviewed {
		status = "reviewed"
		reviewedAt = time.Now()
	}
	tag, err := s.db.Exec(ctx, `
		INSERT INTO content_translations (source_id, locale, value, source_hash, status, translation_source, reviewed_at, updated_at)
		SELECT id,$2,$3,source_hash,$4,'manual',$5,now() FROM content_translation_sources WHERE id=$1
		ON CONFLICT (source_id, locale) DO UPDATE SET value=$3, source_hash=EXCLUDED.source_hash,
		status=$4, translation_source='manual', error_message=NULL, reviewed_at=$5, updated_at=now()`, sourceID, locale, value, status, reviewedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("翻译来源不存在")
	}
	return nil
}

func (s *ContentI18nService) Pending(ctx context.Context, locale, entityType, entityKey string, limit int) ([]PendingContentTranslation, error) {
	locale = normalizeContentLocale(locale)
	if locale == "" {
		return nil, errors.New("目标语言无效")
	}
	if limit < 1 || limit > 100 {
		limit = 30
	}
	args := []interface{}{locale, limit}
	extra := ""
	if entityType != "" {
		args = append(args, entityType)
		extra = fmt.Sprintf(" AND s.entity_type=$%d", len(args))
	}
	if entityKey != "" {
		args = append(args, entityKey)
		extra += fmt.Sprintf(" AND s.entity_key=$%d", len(args))
	}
	rows, err := s.db.Query(ctx, `
		SELECT s.id, s.entity_type, s.entity_key, s.field_path, s.source_text, t.locale
		FROM content_translation_sources s JOIN content_translations t ON t.source_id=s.id
		WHERE t.locale=$1 AND (t.status IN ('pending','failed') OR t.source_hash<>s.source_hash)`+extra+`
		ORDER BY s.updated_at ASC LIMIT $2`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []PendingContentTranslation{}
	for rows.Next() {
		var item PendingContentTranslation
		if err := rows.Scan(&item.SourceID, &item.EntityType, &item.EntityKey, &item.FieldPath, &item.SourceText, &item.Locale); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *ContentI18nService) SaveAI(ctx context.Context, locale string, values map[int64]string) (int, error) {
	locale = normalizeContentLocale(locale)
	count := 0
	for sourceID, value := range values {
		value = strings.TrimSpace(value)
		if sourceID <= 0 || value == "" {
			continue
		}
		tag, err := s.db.Exec(ctx, `
			UPDATE content_translations t SET value=$1, source_hash=s.source_hash, status='translated',
			translation_source='ai', error_message=NULL, reviewed_at=NULL, updated_at=now()
			FROM content_translation_sources s
			WHERE t.source_id=s.id AND s.id=$2 AND t.locale=$3`, value, sourceID, locale)
		if err != nil {
			return count, err
		}
		count += int(tag.RowsAffected())
	}
	return count, nil
}

func (s *ContentI18nService) MarkFailed(ctx context.Context, locale string, sourceIDs []int64, cause error) error {
	locale = normalizeContentLocale(locale)
	if locale == "" || len(sourceIDs) == 0 || cause == nil {
		return nil
	}
	message := strings.TrimSpace(cause.Error())
	if len(message) > 1000 {
		message = message[:1000]
	}
	_, err := s.db.Exec(ctx, `
		UPDATE content_translations
		SET status='failed', error_message=$1, updated_at=now()
		WHERE locale=$2 AND source_id = ANY($3) AND status<>'reviewed'`, message, locale, sourceIDs)
	return err
}

func (s *ContentI18nService) Stats(ctx context.Context, entityType string) ([]ContentTranslationStats, error) {
	args := []interface{}{}
	filter := ""
	if entityType = strings.TrimSpace(entityType); entityType != "" {
		args = append(args, entityType)
		filter = " WHERE s.entity_type=$1"
	}
	rows, err := s.db.Query(ctx, `
		SELECT t.locale, COUNT(*),
		       COUNT(*) FILTER (WHERE t.status='pending' OR t.source_hash<>s.source_hash),
		       COUNT(*) FILTER (WHERE t.status='translated' AND t.source_hash=s.source_hash),
		       COUNT(*) FILTER (WHERE t.status='reviewed' AND t.source_hash=s.source_hash),
		       COUNT(*) FILTER (WHERE t.status='failed')
		FROM content_translations t JOIN content_translation_sources s ON s.id=t.source_id`+filter+`
		GROUP BY t.locale ORDER BY t.locale`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ContentTranslationStats{}
	for rows.Next() {
		var item ContentTranslationStats
		if err := rows.Scan(&item.Locale, &item.Total, &item.Pending, &item.Translated, &item.Reviewed, &item.Failed); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func ExtractModelTranslationFields(displayName, description string, tags []string, schema, runtimeRule map[string]interface{}) map[string]string {
	fields := map[string]string{}
	putTranslationField(fields, "/display_name", displayName)
	putTranslationField(fields, "/description", description)
	for i, tag := range tags {
		putTranslationField(fields, fmt.Sprintf("/tags/%d", i), tag)
	}
	extractVisibleJSONFields(fields, "/input_schema", schema)
	extractVisibleJSONFields(fields, "/runtime_rule", runtimeRule)
	return fields
}

func ExtractWorkflowTranslationFields(name, description string, nodes []WorkflowNode, schema, display map[string]interface{}) map[string]string {
	fields := map[string]string{}
	putTranslationField(fields, "/name", name)
	putTranslationField(fields, "/description", description)
	for i, node := range nodes {
		putTranslationField(fields, fmt.Sprintf("/nodes/%d/name", i), node.Name)
	}
	extractVisibleJSONFields(fields, "/input_schema", schema)
	extractVisibleJSONFields(fields, "/display_config", display)
	return fields
}

func ExtractAPIDocTranslationFields(title, summary, modelName, modelDescription string, content map[string]interface{}) map[string]string {
	fields := map[string]string{}
	putTranslationField(fields, "/title", title)
	putTranslationField(fields, "/summary", summary)
	putTranslationField(fields, "/model_name", modelName)
	putTranslationField(fields, "/model_description", modelDescription)
	extractVisibleJSONFields(fields, "/content", content)
	return fields
}

var visibleContentKeys = map[string]bool{
	"title": true, "subtitle": true, "description": true, "placeholder": true, "label": true,
	"name": true, "tip": true, "hint": true, "help": true, "text": true, "unit": true, "reason": true,
	"image_label": true, "empty_text": true, "button_text": true, "notes": true,
	"prompt": true, "input": true, "content": true,
	"prompt_hint": true, "secondary_prompt_hint": true, "upload_hint": true, "search_placeholder": true,
}

var visibleContentListKeys = map[string]bool{
	"tags": true, "hero_tags": true, "feature_tags": true, "modes": true, "timeline": true,
	"features": true, "notes": true,
}

func extractVisibleJSONFields(fields map[string]string, path string, value interface{}) {
	switch current := value.(type) {
	case map[string]interface{}:
		for key, child := range current {
			childPath := path + "/" + escapeJSONPointer(key)
			if key == "x-enum-labels" {
				if labels, ok := child.([]interface{}); ok {
					for i, label := range labels {
						if text, ok := label.(string); ok {
							putTranslationField(fields, childPath+"/"+strconv.Itoa(i), text)
						}
					}
				}
				continue
			}
			if visibleContentListKeys[key] {
				if items, ok := child.([]interface{}); ok {
					for i, item := range items {
						if text, ok := item.(string); ok {
							putTranslationField(fields, childPath+"/"+strconv.Itoa(i), text)
						}
					}
				}
			}
			if visibleContentKeys[key] {
				if text, ok := child.(string); ok {
					putTranslationField(fields, childPath, text)
					continue
				}
			}
			if key == "enum" {
				// Parameter values must remain stable. Only synthesize display
				// labels from enum values when the schema has no explicit labels.
				if _, hasLabels := current["x-enum-labels"]; hasLabels {
					continue
				}
				if options, ok := child.([]interface{}); ok {
					for i, option := range options {
						if text, ok := option.(string); ok {
							putTranslationField(fields, path+"/x-enum-labels/"+strconv.Itoa(i), text)
						}
					}
				}
				continue
			}
			extractVisibleJSONFields(fields, childPath, child)
		}
	case []interface{}:
		for i, child := range current {
			extractVisibleJSONFields(fields, path+"/"+strconv.Itoa(i), child)
		}
	}
}

func putTranslationField(fields map[string]string, path, value string) {
	if value = strings.TrimSpace(value); value != "" {
		fields[path] = value
	}
}

func setJSONPointer(document interface{}, pointer, value string) interface{} {
	if pointer == "" || pointer == "/" {
		return value
	}
	parts := strings.Split(strings.TrimPrefix(pointer, "/"), "/")
	for i := range parts {
		parts[i] = unescapeJSONPointer(parts[i])
	}
	return setJSONPath(document, parts, value)
}

func setJSONPath(current interface{}, parts []string, value string) interface{} {
	if len(parts) == 0 {
		return value
	}
	head := parts[0]
	if index, err := strconv.Atoi(head); err == nil {
		array, _ := current.([]interface{})
		for len(array) <= index {
			array = append(array, nil)
		}
		array[index] = setJSONPath(array[index], parts[1:], value)
		return array
	}
	object, _ := current.(map[string]interface{})
	if object == nil {
		object = map[string]interface{}{}
	}
	object[head] = setJSONPath(object[head], parts[1:], value)
	return object
}

func contentSourceHash(value string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(sum[:])
}

func normalizeContentLocale(value string) string {
	value = strings.TrimSpace(strings.Split(value, ",")[0])
	value = strings.TrimSpace(strings.Split(value, ";")[0])
	if value == "" {
		return ""
	}
	parts := strings.Split(strings.ReplaceAll(value, "_", "-"), "-")
	language := strings.ToLower(parts[0])
	defaults := map[string]string{"zh": "zh-CN", "en": "en-US", "ja": "ja-JP", "ko": "ko-KR", "vi": "vi-VN"}
	if len(parts) == 1 {
		return defaults[language]
	}
	return language + "-" + strings.ToUpper(parts[1])
}

func normalizeContentLocales(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		locale := normalizeContentLocale(value)
		if locale != "" && !seen[locale] {
			seen[locale] = true
			result = append(result, locale)
		}
	}
	return result
}

func escapeJSONPointer(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, "~", "~0"), "/", "~1")
}

func unescapeJSONPointer(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, "~1", "/"), "~0", "~")
}
