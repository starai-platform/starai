package handler

import (
	"errors"
	"io"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/starai/api/internal/middleware"
	"github.com/starai/api/internal/service"
	"github.com/starai/api/internal/util"
)

func (h *Handler) ListAgents(c *gin.Context) {
	items, err := h.agents.List(c.Request.Context(), false)
	if err != nil {
		util.InternalError(c, err.Error())
		return
	}
	locale := requestContentLocale(c)
	localized := make(map[string]interface{}, len(items))
	for i := range items {
		localized[items[i].Code] = &items[i]
	}
	_ = h.contentI18n.ApplyBatch(c.Request.Context(), "workflow", locale, localized)
	c.Header("Cache-Control", "public, max-age=30, stale-while-revalidate=120")
	c.Header("Vary", "Accept-Language, X-Locale")
	util.OK(c, map[string]interface{}{"items": items})
}

func (h *Handler) GetAgent(c *gin.Context) {
	item, err := h.agents.Get(c.Request.Context(), c.Param("code"))
	if err != nil || item == nil || !item.IsEnabled {
		util.NotFound(c, "智能体不存在")
		return
	}
	_ = h.contentI18n.Apply(c.Request.Context(), "workflow", item.Code, requestContentLocale(c), item)
	c.Header("Cache-Control", "public, max-age=30, stale-while-revalidate=120")
	if item.Code == "general_creative_agent" {
		if item.RuntimeConfig == nil {
			item.RuntimeConfig = map[string]interface{}{}
		}
		capability := service.ReasoningCapability{Message: "当前模型尚未配置思考能力。"}
		if model, modelErr := h.models.GetFullByCode(c.Request.Context(), stringAny(item.RuntimeConfig["analysis_model_code"])); modelErr == nil {
			capability = h.models.ChatReasoningCapability(c.Request.Context(), model)
		}
		item.RuntimeConfig["reasoning_capability"] = capability
		c.Header("Cache-Control", "no-store")
	}
	c.Header("Vary", "Accept-Language, X-Locale")
	util.OK(c, item)
}

func (h *Handler) CreateAgentProject(c *gin.Context) {
	var req struct {
		Inputs map[string]interface{} `json:"inputs"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		util.BadRequest(c, "参数错误")
		return
	}
	if !h.enforceContentSafety(c, c.GetInt64("user_id"), "agent", req.Inputs) {
		return
	}
	project, err := h.agents.CreateProject(c.Request.Context(), c.GetInt64("user_id"), c.Param("code"), req.Inputs)
	if err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.Created(c, project)
}

func (h *Handler) enforceContentSafety(c *gin.Context, userID int64, source string, input interface{}) bool {
	blocked, err := h.admin.CheckContentSafety(c.Request.Context(), userID, source, input)
	if err != nil {
		util.InternalError(c, "内容安全服务暂时不可用")
		return false
	}
	if blocked {
		middleware.RecordContentSafetyBlocked()
		util.BadRequest(c, "输入内容未通过平台安全规则，请修改后重试")
		return false
	}
	return true
}

func (h *Handler) ListAgentProjects(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	workflowCode := c.Query("workflow_code")
	items, total, err := h.agents.ListProjects(c.Request.Context(), c.GetInt64("user_id"), page, pageSize, workflowCode)
	if err != nil {
		util.InternalError(c, err.Error())
		return
	}
	util.OK(c, map[string]interface{}{"items": items, "total": total})
}

func (h *Handler) GetAgentProject(c *gin.Context) {
	project, err := h.agents.GetProject(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"))
	if err != nil {
		util.NotFound(c, "项目不存在")
		return
	}
	util.OK(c, project)
}

func (h *Handler) RecordCreativeAgentFeedback(c *gin.Context) {
	var req struct {
		ConversationID string `json:"conversation_id"`
		ProjectID      string `json:"project_id"`
		Rating         int    `json:"rating"`
	}
	if c.ShouldBindJSON(&req) != nil || (req.Rating != -1 && req.Rating != 1) || strings.TrimSpace(req.ConversationID) == "" || strings.TrimSpace(req.ProjectID) == "" {
		util.BadRequest(c, "评价参数错误")
		return
	}
	if err := h.agents.RecordExplicitWorkflowFeedback(c.Request.Context(), c.GetInt64("user_id"), req.ConversationID, req.ProjectID, req.Rating); err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.OK(c, map[string]int{"rating": req.Rating})
}

func (h *Handler) RetryAgentProject(c *gin.Context) {
	h.retryAgentProject(c, false)
}

func (h *Handler) CancelAgentProject(c *gin.Context) {
	if err := h.agents.CancelProject(c.Request.Context(), c.GetInt64("user_id"), c.Param("id")); err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.OK(c, nil)
}

func (h *Handler) RetryAgentProjectNode(c *gin.Context) {
	h.retryAgentProject(c, true)
}

func (h *Handler) retryAgentProject(c *gin.Context, retryNode bool) {
	var req struct {
		Confirmed          bool   `json:"confirmed"`
		NodeID             string `json:"node_id"`
		ImageModelCode     string `json:"image_model_code"`
		VideoModelCode     string `json:"video_model_code"`
		NarrationModelCode string `json:"narration_model_code"`
		ConversationID     string `json:"conversation_id"`
		UserMessage        string `json:"user_message"`
	}
	if err := c.ShouldBindJSON(&req); err != nil && (retryNode || !errors.Is(err, io.EOF)) {
		util.BadRequest(c, "参数错误")
		return
	}
	if strings.TrimSpace(req.ConversationID) != "" && !req.Confirmed {
		util.BadRequest(c, "请先确认继续执行工作流")
		return
	}
	modelOverrides := map[string]string{
		"image_model_code":     strings.TrimSpace(req.ImageModelCode),
		"video_model_code":     strings.TrimSpace(req.VideoModelCode),
		"narration_model_code": strings.TrimSpace(req.NarrationModelCode),
	}
	if strings.TrimSpace(req.ConversationID) != "" {
		creativeRuntime := h.creativeAgentRuntimeConfig(c.Request.Context())
		if code := strings.TrimSpace(stringAny(creativeRuntime["analysis_model_code"])); code != "" {
			modelOverrides["dialogue_model_code"] = code
		}
		for runtimeKey, inputKey := range map[string]string{
			"image_model_code":  "image_model_code",
			"video_model_code":  "video_model_code",
			"speech_model_code": "narration_model_code",
		} {
			if code := strings.TrimSpace(stringAny(creativeRuntime[runtimeKey])); code != "" && modelOverrides[inputKey] == "" {
				modelOverrides[inputKey] = code
			}
		}
	}
	var err error
	if retryNode {
		err = h.agents.RetryProjectNode(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"), req.NodeID, modelOverrides)
	} else {
		err = h.agents.RetryProject(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"), modelOverrides)
	}
	if err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	_ = h.agents.RecordWorkflowRetryFeedback(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"))
	if conversationID, userMessage := strings.TrimSpace(req.ConversationID), strings.TrimSpace(req.UserMessage); conversationID != "" && userMessage != "" {
		_ = h.chat.AppendConversationMessage(c.Request.Context(), c.GetInt64("user_id"), conversationID, "user", userMessage)
		_ = h.chat.AppendConversationMessage(c.Request.Context(), c.GetInt64("user_id"), conversationID, "assistant", "已从失败节点继续执行，已完成的步骤和分段不会重新生成。")
	}
	util.OK(c, nil)
}

func (h *Handler) ReplaceComicProjectKeyframe(c *gin.Context) {
	h.replaceComicProjectMedia(c, "keyframes")
}

func (h *Handler) ReplaceComicProjectSegment(c *gin.Context) {
	h.replaceComicProjectMedia(c, "segments")
}

func (h *Handler) replaceComicProjectMedia(c *gin.Context, kind string) {
	index, err := strconv.Atoi(c.Param("index"))
	if err != nil || index < 0 {
		util.BadRequest(c, "序号无效")
		return
	}
	var req struct {
		URL     string `json:"url"`
		AssetID string `json:"asset_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		util.BadRequest(c, "参数错误")
		return
	}
	// 只允许使用当前用户已经上传到平台对象存储的资产，避免 Worker 在合成时
	// 下载任意 URL 所形成的 SSRF。URL 字段继续兼容旧客户端，但必须与资产地址匹配。
	if strings.TrimSpace(req.AssetID) == "" {
		util.BadRequest(c, "请先上传素材并提交 asset_id")
		return
	}
	_, objectKey, _, err := h.assets.Get(c.Request.Context(), c.GetInt64("user_id"), strings.TrimSpace(req.AssetID))
	if err != nil {
		util.BadRequest(c, "素材不存在或无权访问")
		return
	}
	trustedURL := h.storage.PublicURL(objectKey)
	if supplied := strings.TrimSpace(req.URL); supplied != "" && supplied != trustedURL {
		util.BadRequest(c, "素材地址与资产不匹配")
		return
	}
	req.URL = trustedURL
	if err := h.agents.ReplaceComicProjectMedia(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"), kind, index, req.URL); err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.OK(c, nil)
}

func (h *Handler) ConfirmAgentProjectStep(c *gin.Context) {
	var req struct {
		Payload map[string]interface{} `json:"payload"`
	}
	_ = c.ShouldBindJSON(&req)
	if err := h.agents.ConfirmStep(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"), c.Param("step"), req.Payload); err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.OK(c, nil)
}

func (h *Handler) SetAgentProjectAutopilot(c *gin.Context) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	_ = c.ShouldBindJSON(&req)
	if err := h.agents.SetAutopilot(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"), req.Enabled); err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.OK(c, nil)
}

func (h *Handler) ListComicDramaProjects(c *gin.Context) {
	includeArchived := c.Query("include_archived") == "true"
	items, err := h.agents.ListComicDramaProjects(c.Request.Context(), c.GetInt64("user_id"), includeArchived)
	if err != nil {
		util.InternalError(c, err.Error())
		return
	}
	util.OK(c, map[string]interface{}{"items": items})
}

func (h *Handler) ListComicDramaAssets(c *gin.Context) {
	items, err := h.agents.ListComicDramaAssets(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"))
	if err != nil {
		util.InternalError(c, err.Error())
		return
	}
	util.OK(c, map[string]interface{}{"items": items})
}

func (h *Handler) CreateComicDramaAsset(c *gin.Context) {
	h.upsertComicDramaAsset(c, "")
}

func (h *Handler) UpdateComicDramaAsset(c *gin.Context) {
	h.upsertComicDramaAsset(c, c.Param("asset_id"))
}

func (h *Handler) upsertComicDramaAsset(c *gin.Context, assetID string) {
	var req service.ComicDramaAssetInput
	if err := c.ShouldBindJSON(&req); err != nil {
		util.BadRequest(c, "参数错误")
		return
	}
	item, err := h.agents.UpsertComicDramaAsset(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"), assetID, req)
	if err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	if assetID == "" {
		util.Created(c, item)
	} else {
		util.OK(c, item)
	}
}

func (h *Handler) DeleteComicDramaAsset(c *gin.Context) {
	if err := h.agents.DeleteComicDramaAsset(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"), c.Param("asset_id")); err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.OK(c, nil)
}

func (h *Handler) CloneComicDramaProject(c *gin.Context) {
	project, err := h.agents.CloneComicDramaProject(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"))
	if err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.Created(c, project)
}

func (h *Handler) ArchiveComicDramaProject(c *gin.Context) {
	var req struct {
		Archived bool `json:"archived"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		util.BadRequest(c, "参数错误")
		return
	}
	if err := h.agents.ArchiveComicDramaProject(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"), req.Archived); err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.OK(c, nil)
}

func (h *Handler) DeleteComicDramaProject(c *gin.Context) {
	if err := h.agents.DeleteComicDramaProject(c.Request.Context(), c.GetInt64("user_id"), c.Param("id")); err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.OK(c, nil)
}

func (h *Handler) CreateComicDramaProject(c *gin.Context) {
	var input service.ComicDramaProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		util.BadRequest(c, "参数错误")
		return
	}
	project, err := h.agents.CreateComicDramaProject(c.Request.Context(), c.GetInt64("user_id"), input)
	if err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.Created(c, project)
}

func (h *Handler) GetComicDramaProject(c *gin.Context) {
	project, err := h.agents.GetComicDramaProject(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"))
	if err != nil {
		util.NotFound(c, "项目不存在")
		return
	}
	util.OK(c, project)
}

func (h *Handler) UpdateComicDramaProject(c *gin.Context) {
	var input service.ComicDramaProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		util.BadRequest(c, "参数错误")
		return
	}
	project, err := h.agents.UpdateComicDramaProject(c.Request.Context(), c.GetInt64("user_id"), c.Param("id"), input)
	if err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.OK(c, project)
}

func (h *Handler) ListComicDramaStyles(c *gin.Context) {
	items, err := h.agents.ListComicDramaStyles(c.Request.Context(), c.GetInt64("user_id"), c.Query("source"))
	if err != nil {
		util.InternalError(c, err.Error())
		return
	}
	util.OK(c, map[string]interface{}{"items": items})
}

func (h *Handler) CreateComicDramaStyle(c *gin.Context) {
	var input service.ComicDramaStyleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		util.BadRequest(c, "参数错误")
		return
	}
	style, err := h.agents.CreateComicDramaStyle(c.Request.Context(), c.GetInt64("user_id"), input)
	if err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.Created(c, style)
}

func (h *Handler) DeleteComicDramaStyle(c *gin.Context) {
	if err := h.agents.DeleteComicDramaStyle(c.Request.Context(), c.GetInt64("user_id"), c.Param("id")); err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	util.OK(c, nil)
}

func (h *Handler) AdminListAgents(c *gin.Context) {
	items, err := h.agents.List(c.Request.Context(), true)
	if err != nil {
		util.InternalError(c, err.Error())
		return
	}
	util.OK(c, map[string]interface{}{"items": items})
}

func (h *Handler) AdminToggleAgent(c *gin.Context) {
	var req struct {
		IsEnabled bool `json:"is_enabled"`
	}
	c.ShouldBindJSON(&req)
	if err := h.agents.SetEnabled(c.Request.Context(), c.Param("code"), req.IsEnabled); err != nil {
		util.InternalError(c, err.Error())
		return
	}
	h.admin.LogOperation(c.Request.Context(), c.GetInt64("admin_id"), "toggle_agent", "workflow", c.Param("code"), map[string]interface{}{"is_enabled": req.IsEnabled})
	util.OK(c, nil)
}

func (h *Handler) AdminCreateAgent(c *gin.Context) {
	var input service.AgentUpsertInput
	if err := c.ShouldBindJSON(&input); err != nil {
		util.BadRequest(c, "参数错误")
		return
	}
	if err := h.agents.Upsert(c.Request.Context(), input); err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	_ = h.contentI18n.SyncEntity(c.Request.Context(), "workflow", input.Code,
		service.ExtractWorkflowTranslationFields(input.Name, input.Description, input.Nodes, input.InputSchema, input.DisplayConfig))
	h.triggerContentAutoTranslation("workflow", input.Code)
	h.admin.LogOperation(c.Request.Context(), c.GetInt64("admin_id"), "create_agent", "workflow", input.Code, nil)
	util.Created(c, nil)
}

func (h *Handler) AdminUpdateAgent(c *gin.Context) {
	var input service.AgentUpsertInput
	if err := c.ShouldBindJSON(&input); err != nil {
		util.BadRequest(c, "参数错误")
		return
	}
	input.Code = c.Param("code")
	if err := h.agents.Upsert(c.Request.Context(), input); err != nil {
		util.BadRequest(c, err.Error())
		return
	}
	_ = h.contentI18n.SyncEntity(c.Request.Context(), "workflow", input.Code,
		service.ExtractWorkflowTranslationFields(input.Name, input.Description, input.Nodes, input.InputSchema, input.DisplayConfig))
	h.triggerContentAutoTranslation("workflow", input.Code)
	h.admin.LogOperation(c.Request.Context(), c.GetInt64("admin_id"), "update_agent", "workflow", input.Code, nil)
	util.OK(c, nil)
}

func (h *Handler) AdminDeleteAgent(c *gin.Context) {
	if err := h.agents.Delete(c.Request.Context(), c.Param("code")); err != nil {
		util.InternalError(c, err.Error())
		return
	}
	_ = h.contentI18n.DeleteEntity(c.Request.Context(), "workflow", c.Param("code"))
	h.admin.LogOperation(c.Request.Context(), c.GetInt64("admin_id"), "delete_agent", "workflow", c.Param("code"), nil)
	util.OK(c, nil)
}
