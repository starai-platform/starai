package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var detailRevisionHex = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func validateDetailRevisionLayers(layers []map[string]interface{}) error {
	if len(layers) > 24 {
		return errors.New("文字图层过多")
	}
	for _, layer := range layers {
		text, ok := layer["text"].(string)
		if !ok || len([]rune(text)) > 1000 {
			return errors.New("文字图层内容无效")
		}
		for _, key := range []string{"x", "y", "width", "font_size"} {
			value, ok := layer[key].(float64)
			if !ok || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
				return fmt.Errorf("文字图层 %s 无效", key)
			}
		}
		if layer["width"].(float64) < 0.04 || layer["x"].(float64)+layer["width"].(float64) > 1.001 || layer["font_size"].(float64) < 0.012 {
			return errors.New("文字图层超出画面范围")
		}
		for _, key := range []string{"color", "background"} {
			if value, exists := layer[key]; exists && (!detailRevisionHex.MatchString(stringValue(value))) {
				return fmt.Errorf("文字图层 %s 颜色无效", key)
			}
		}
	}
	return nil
}

func applyDetailSectionRevision(outputs map[string]interface{}, index int, imageURL string, layers []map[string]interface{}) error {
	page, ok := outputs["detail_page"].(map[string]interface{})
	if !ok {
		return errors.New("未找到商品详情图")
	}
	sections, ok := page["sections"].([]interface{})
	if !ok || index < 0 || index >= len(sections) {
		return errors.New("详情图序号不存在")
	}
	section, ok := sections[index].(map[string]interface{})
	if !ok || stringValue(section["status"]) != "succeeded" || stringValue(section["source_image_url"]) == "" {
		return errors.New("此详情图没有可复用的无字底图")
	}
	section["text_layers"] = layers
	section["image_url"] = imageURL
	section["manually_revised"] = true
	sections[index] = section
	page["sections"] = sections
	page["compose_status"] = "not_requested"
	delete(page, "long_image_url")
	taskNo := stringValue(section["task_no"])
	if tasks, ok := outputs["media_tasks"].([]interface{}); ok {
		for _, raw := range tasks {
			task, ok := raw.(map[string]interface{})
			if !ok || stringValue(task["task_no"]) != taskNo {
				continue
			}
			output, _ := task["output"].(map[string]interface{})
			if output == nil {
				output = map[string]interface{}{}
			}
			output["image_url"] = imageURL
			output["images"] = []map[string]interface{}{{"url": imageURL}}
			task["output"] = output
			task["detail_section"] = section
		}
	}
	return nil
}

func (s *AgentService) ReviseDetailSection(ctx context.Context, userID int64, publicID string, index int, imageURL string, layers []map[string]interface{}) error {
	if err := validateDetailRevisionLayers(layers); err != nil {
		return err
	}
	parsed, err := url.Parse(strings.TrimSpace(imageURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || !strings.Contains(parsed.Path, "/uploads/"+strconv.FormatInt(userID, 10)+"/") {
		return errors.New("修订图片地址无效")
	}
	var projectID int64
	var status, code string
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT p.id,p.status,p.outputs,w.code FROM workflow_projects p JOIN workflow_definitions w ON w.id=p.workflow_id WHERE p.public_id=$1 AND p.user_id=$2`, publicID, userID).Scan(&projectID, &status, &raw, &code); err != nil {
		return err
	}
	if code != "ecommerce_image" || status != "succeeded" {
		return errors.New("仅已完成的电商详情图可以修改文案")
	}
	outputs := map[string]interface{}{}
	if err := json.Unmarshal(raw, &outputs); err != nil {
		return err
	}
	page, _ := outputs["detail_page"].(map[string]interface{})
	sections, _ := page["sections"].([]interface{})
	if index < 0 || index >= len(sections) {
		return errors.New("详情图序号不存在")
	}
	section, _ := sections[index].(map[string]interface{})
	source, err := url.Parse(stringValue(section["source_image_url"]))
	if err != nil || source.Host == "" || !strings.EqualFold(parsed.Host, source.Host) {
		return errors.New("修订图片与原图来源不一致")
	}
	if err := applyDetailSectionRevision(outputs, index, imageURL, layers); err != nil {
		return err
	}
	tag, err := s.db.Exec(ctx, `UPDATE workflow_projects SET outputs=$1,updated_at=now() WHERE id=$2 AND outputs=$3::jsonb AND status='succeeded'`, mustAgentJSON(outputs), projectID, raw)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("项目已更新，请刷新后重试")
	}
	return nil
}
