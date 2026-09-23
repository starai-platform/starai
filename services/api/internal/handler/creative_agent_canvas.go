package handler

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/starai/api/internal/service"
	"github.com/starai/api/internal/util"
)

func creativeCanvasTemplate(kind, workflow, prompt string, params map[string]interface{}) string {
	if kind == "text" {
		return "agent-text"
	}
	if workflow == "content_image_post" {
		return "content-image-post"
	}
	if workflow == "one_click_viral_remake" || ((kind == "video" || kind == "workflow") && (strings.Contains(prompt, "爆款复刻") || strings.Contains(prompt, "一键复刻"))) {
		return "one-click-viral-remake"
	}
	if workflow == "viral_remake" {
		return "viral-remake"
	}
	if workflow == "video_creation_v2" {
		return "story-short-video-v2"
	}
	if workflow == "video_creation" || ((kind == "video" || kind == "workflow") && creativeAgentPositiveInt(params["storyboard_grid"]) > 1) {
		return "story-short-video"
	}
	if kind == "workflow" {
		return "story-short-video"
	}
	if kind == "image" {
		if len(stringSliceAny(params["reference_images"])) > 0 {
			if stringAny(params["image_operation"]) == "edit" || regexp.MustCompile(`(?i)修改|编辑|改图|修图|重绘|换背景|替换|去掉|移除|擦除|抠图|扩图|局部|\bedit\b|\binpaint\b`).MatchString(prompt) {
				return "image-edit"
			}
			return "image-image"
		}
		return "text-image"
	}
	if kind == "video" {
		if len(stringSliceAny(params["reference_images"])) > 0 {
			return "image-video"
		}
		return "text-video"
	}
	return "agent-audio"
}

// The approved plan uses the canvas executor behind the Agent conversation.
// Never dispatch finished media through a second, unrelated workflow engine.
func (h *Handler) createCreativeCanvas(c *gin.Context, conversation string, version int64, kind, workflow, prompt string, params map[string]interface{}) {
	template := creativeCanvasTemplate(kind, workflow, prompt, params)
	workflowCode := strings.TrimSpace(workflow)
	if workflowCode == "" {
		workflowCode = map[string]string{"story-short-video": "video_creation", "story-short-video-v2": "video_creation_v2", "one-click-viral-remake": "one_click_viral_remake", "viral-remake": "viral_remake", "content-image-post": "content_image_post"}[template]
	}
	if workflowCode != "" {
		definition, err := h.agents.Get(c.Request.Context(), workflowCode)
		if err != nil || definition == nil || !definition.IsEnabled {
			message := "对应的无限画布工作流未启用，请在后台配置后重新确认"
			_ = h.chat.CompleteAgentDraft(context.Background(), c.GetInt64("user_id"), conversation, version, "canvas", "", message)
			util.BadRequest(c, message)
			return
		}
		if stringAny(params["analysis_model_code"]) == "" {
			codes := stringSliceAny(params["dialogue_model_codes"])
			if len(codes) > 0 {
				params["analysis_model_code"] = codes[0]
			} else {
				params["analysis_model_code"] = stringAny(definition.RuntimeConfig["analysis_model_code"])
			}
		}
	}
	mode := "auto"
	if stringAny(params["_mode"]) == "step" {
		mode = "step"
	}
	document, err := json.Marshal(map[string]interface{}{
		"version": 1, "nodes": []interface{}{}, "edges": []interface{}{},
		"viewport":     map[string]interface{}{"x": 0, "y": 0, "zoom": 1},
		"submitted_at": time.Now().Format(time.RFC3339), "execution_mode": mode,
		"agent_request": map[string]interface{}{"template_id": template, "kind": kind, "prompt": prompt, "params": params},
	})
	var canvas *service.CanvasDTO
	if err == nil {
		canvas, err = h.canvases.Create(c.Request.Context(), c.GetInt64("user_id"), service.SaveCanvasInput{WorkflowCode: "infinite_canvas", Title: "Agent · " + template, Document: document})
	}
	if err != nil {
		_ = h.chat.CompleteAgentDraft(context.Background(), c.GetInt64("user_id"), conversation, version, "canvas", "", err.Error())
		util.BadRequest(c, err.Error())
		return
	}
	_ = h.chat.CompleteAgentDraft(context.Background(), c.GetInt64("user_id"), conversation, version, "canvas", canvas.PublicID, "")
	h.appendCreativeAgentEvent(c.Request.Context(), c.GetInt64("user_id"), conversation, map[string]interface{}{"type": "creative_agent_canvas", "canvas_id": canvas.PublicID, "template_id": template})
	util.Created(c, map[string]interface{}{"canvas_id": canvas.PublicID, "template_id": template})
}
