package service

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/starai/api/internal/runtime"
)

type ReasoningCapability struct {
	Supported  bool   `json:"supported"`
	CanDisable bool   `json:"can_disable"`
	Message    string `json:"message"`
}

// Explicit model/route settings win over conservative, documented model defaults.
func chatReasoningConfig(model *ModelFull) map[string]interface{} {
	configured, _ := model.RuntimeRule["reasoning"].(map[string]interface{})
	cfg := copyMap(configured)
	mode := strings.ToLower(strings.TrimSpace(stringValue(cfg["mode"])))
	if mode != "" && mode != "auto" {
		cfg["mode"] = mode
		return cfg
	}
	name := strings.ToLower(model.NewAPIModel)
	conn, _ := model.NewAPIExtraParams["connection"].(map[string]interface{})
	protocol := strings.ToLower(stringValue(conn["protocol"]))
	mode = "unsupported"
	switch {
	case strings.HasPrefix(name, "glm-4.5"), strings.HasPrefix(name, "glm-4.6"), strings.HasPrefix(name, "glm-4.7"), strings.HasPrefix(name, "glm-5"):
		mode = "thinking_type"
	case strings.Contains(name, "deepseek") && (strings.Contains(name, "v3.1") || strings.Contains(name, "v3.2") || strings.Contains(name, "v4")):
		mode = "thinking_type"
	case strings.Contains(name, "deepseek-reasoner"), strings.Contains(name, "qwq"), strings.Contains(name, "qwen") && strings.Contains(name, "thinking"):
		mode = "always_on"
	case strings.Contains(name, "qwen3") && !strings.Contains(name, "instruct") && !strings.Contains(name, "coder"):
		mode = "enable_thinking"
	case strings.HasPrefix(name, "gpt-5"), strings.HasPrefix(name, "gpt-6"), strings.HasPrefix(name, "o3"), strings.HasPrefix(name, "o4"):
		if strings.Contains(name, "chat") || strings.Contains(name, "pro") {
			break
		}
		mode = "reasoning_effort"
		cfg["off_effort"] = "low"
		if (strings.HasPrefix(name, "gpt-5.1") || strings.HasPrefix(name, "gpt-5.2") || strings.HasPrefix(name, "gpt-5.4") || strings.HasPrefix(name, "gpt-5.5")) && !strings.Contains(name, "codex") {
			cfg["off_effort"] = "none"
		}
		if name == "gpt-5" || strings.HasPrefix(name, "gpt-5-mini") || strings.HasPrefix(name, "gpt-5-nano") {
			cfg["off_effort"] = "minimal"
		}
		cfg["omit_temperature"] = true
	case strings.HasPrefix(name, "gemini-3"), strings.HasPrefix(name, "gemini-2.5"):
		mode = "reasoning_effort"
		cfg["off_effort"] = "low"
		if strings.HasPrefix(name, "gemini-2.5-flash") {
			cfg["off_effort"] = "none"
		}
		if protocol == "gemini" || protocol == "google" || protocol == "gemini_native" || protocol == "google_gemini" {
			mode = "gemini_level"
			if strings.HasPrefix(name, "gemini-2.5") {
				mode = "gemini_budget"
				cfg["off_budget"] = 128
				if strings.Contains(name, "flash") {
					cfg["off_budget"] = 0
				}
			}
		}
	case strings.Contains(name, "claude") && (protocol == "claude" || protocol == "anthropic" || protocol == "anthropic_messages" || protocol == "claude_messages"):
		switch {
		case strings.Contains(name, "mythos"), strings.Contains(name, "fable"):
			mode = "claude_adaptive"
			cfg["can_disable"] = false
		case strings.Contains(name, "4-6"), strings.Contains(name, "4.6"), strings.Contains(name, "4-7"), strings.Contains(name, "4.7"), strings.Contains(name, "4-8"), strings.Contains(name, "4.8"), regexp.MustCompile(`(?:opus|sonnet|haiku)-5(?:[-.]|$)`).MatchString(name):
			mode = "claude_adaptive"
		case strings.Contains(name, "3-7"), strings.Contains(name, "3.7"), strings.Contains(name, "-4"), strings.Contains(name, "4."):
			mode = "claude_budget"
		}
	}
	cfg["mode"] = mode
	for key, value := range configured {
		if key != "mode" {
			cfg[key] = value
		}
	}
	return cfg
}

func reasoningCapability(cfg map[string]interface{}) ReasoningCapability {
	cap := ReasoningCapability{Supported: true, CanDisable: true, Message: "开启后增加思考深度，响应时间和费用可能增加。"}
	switch stringValue(cfg["mode"]) {
	case "glm_thinking", "thinking_type", "enable_thinking", "nvidia_chat_template", "claude_budget":
	case "claude_adaptive":
		if value, ok := cfg["can_disable"].(bool); ok {
			cap.CanDisable = value
		}
	case "reasoning_effort", "gemini_level":
		cap.CanDisable = stringValue(cfg["off_effort"]) == "none"
	case "gemini_budget":
		cap.CanDisable = floatValue(cfg["off_budget"]) == 0
	case "custom":
		on, onOK := cfg["on_params"].(map[string]interface{})
		off, offOK := cfg["off_params"].(map[string]interface{})
		a, _ := json.Marshal(on)
		b, _ := json.Marshal(off)
		cap.Supported = onOK && offOK && len(on) > 0 && len(off) > 0 && string(a) != string(b)
		cap.CanDisable, _ = cfg["can_disable"].(bool)
	default:
		cap.Supported = false
		cap.CanDisable = false
	}
	if !cap.Supported {
		cap.Message = "当前模型未配置可用的思考开关，请管理员检查模型或线路的思考参数映射。"
	}
	if stringValue(cfg["mode"]) == "always_on" {
		cap.Message = "当前模型固定开启思考，不支持通过按钮切换。"
	}
	if cap.Supported && !cap.CanDisable {
		cap.Message = "当前模型不能完全关闭思考：关闭按钮使用较低强度，开启使用较高强度。"
	}
	return cap
}

func effectiveChatRouteModel(model *ModelFull, route ModelRoute) *ModelFull {
	copy := *model
	copy.NewAPIModel = route.UpstreamModel
	copy.NewAPIEndpoint = route.Endpoint
	copy.RuntimeRule = mergeModelRouteMaps(model.RuntimeRule, route.RuntimeRule)
	copy.NewAPIExtraParams = route.RequestExtra(model)
	return &copy
}

func (s *ModelService) ChatReasoningCapability(ctx context.Context, model *ModelFull) ReasoningCapability {
	routes, err := s.ListModelRoutes(ctx, model.ID, true)
	if err != nil {
		return ReasoningCapability{Message: "暂时无法读取模型能力，请稍后重试。"}
	}
	if len(routes) == 0 {
		routes = []ModelRoute{legacyModelRoute(model)}
	}
	cap := ReasoningCapability{Supported: true, CanDisable: true}
	count := 0
	for _, route := range routes {
		if !route.IsEnabled {
			continue
		}
		count++
		current := reasoningCapability(chatReasoningConfig(effectiveChatRouteModel(model, route)))
		if !current.Supported {
			return current
		}
		cap.CanDisable = cap.CanDisable && current.CanDisable
		cap.Message = current.Message
	}
	if count == 0 {
		return ReasoningCapability{Message: "当前没有可用模型线路。"}
	}
	if !cap.CanDisable {
		cap.Message = "当前模型部分线路不能完全关闭思考；关闭按钮使用较低强度，开启使用较高强度。"
	}
	return cap
}

func applyChatReasoning(model *ModelFull, merged, out map[string]interface{}) (map[string]interface{}, error) {
	cfg := chatReasoningConfig(model)
	_, explicit := merged["deep_think"]
	if !explicit && cfg["default_enabled"] == nil {
		return out, nil
	}
	enabled, err := reasoningEnabled(merged, cfg)
	if err != nil {
		return nil, err
	}
	cap := reasoningCapability(cfg)
	if !cap.Supported {
		if enabled {
			return nil, errors.New(cap.Message)
		}
		return out, nil
	}
	// The per-turn switch overrides stale/default provider reasoning settings.
	for _, key := range []string{"reasoning_effort", "reasoning", "thinking", "enable_thinking", "thinkingConfig", "reasoning_budget", "thinking_budget"} {
		delete(out, key)
	}
	for _, entry := range []struct{ key, field string }{{"chat_template_kwargs", "enable_thinking"}, {"output_config", "effort"}} {
		if nested, ok := out[entry.key].(map[string]interface{}); ok {
			nested = copyMap(nested)
			delete(nested, entry.field)
			if len(nested) == 0 {
				delete(out, entry.key)
			} else {
				out[entry.key] = nested
			}
		}
	}
	budget, err := reasoningBudget(merged, cfg)
	if err != nil {
		return nil, err
	}
	if budget == 0 {
		budget = 4096
	}
	effort := firstNonEmptyService(stringValue(cfg["on_effort"]), "high")
	if !enabled {
		effort = firstNonEmptyService(stringValue(cfg["off_effort"]), "low")
	}
	switch stringValue(cfg["mode"]) {
	case "glm_thinking", "thinking_type":
		value := "disabled"
		if enabled {
			value = "enabled"
		}
		out["thinking"] = map[string]interface{}{"type": value}
	case "enable_thinking":
		out["enable_thinking"] = enabled
	case "nvidia_chat_template":
		template, _ := out["chat_template_kwargs"].(map[string]interface{})
		template = copyMap(template)
		template["enable_thinking"] = enabled
		out["chat_template_kwargs"] = template
		if enabled {
			out["reasoning_budget"] = budget
		}
	case "reasoning_effort":
		out["reasoning_effort"] = effort
	case "gemini_level":
		out["thinkingConfig"] = map[string]interface{}{"thinkingLevel": effort}
	case "gemini_budget":
		if !enabled {
			budget = int(floatValue(cfg["off_budget"]))
		}
		out["thinkingConfig"] = map[string]interface{}{"thinkingBudget": budget}
	case "claude_budget":
		out["thinking"] = map[string]interface{}{"type": "disabled"}
		if enabled {
			if budget < 1024 {
				return nil, errors.New("Claude 思考预算至少为 1024 Token")
			}
			maxTokens := firstPositiveIntValue(out, "max_tokens", "max_completion_tokens")
			if maxTokens == 0 {
				out["max_tokens"] = budget + 4096
			} else if maxTokens <= budget {
				return nil, errors.New("Claude 最大输出 Token 必须大于思考预算，请检查模型配置")
			}
			out["thinking"] = map[string]interface{}{"type": "enabled", "budget_tokens": budget}
		}
	case "claude_adaptive":
		out["thinking"] = map[string]interface{}{"type": "disabled"}
		if enabled || !cap.CanDisable {
			out["thinking"] = map[string]interface{}{"type": "adaptive"}
			out["output_config"] = map[string]interface{}{"effort": effort}
		}
	case "custom":
		key := "off_params"
		if enabled {
			key = "on_params"
		}
		patch := cfg[key].(map[string]interface{})
		for key, value := range patch {
			switch key {
			case "thinking", "reasoning", "reasoning_effort", "reasoning_budget", "enable_thinking", "thinking_budget", "thinkingConfig", "chat_template_kwargs", "output_config", "max_tokens", "max_completion_tokens":
				out[key] = value
			default:
				return nil, errors.New("自定义思考映射包含不支持的字段：" + key)
			}
		}
	}
	return out, nil
}

func chatRouteRequest(req runtime.ChatRequest, model *ModelFull, route ModelRoute, params map[string]interface{}) (runtime.ChatRequest, error) {
	effective := effectiveChatRouteModel(model, route)
	extra, err := buildChatUpstreamParams(effective, params)
	if err != nil {
		return req, err
	}
	req.Model = route.UpstreamModel
	req.Extra = extra
	cfg := chatReasoningConfig(effective)
	if _, explicit := params["deep_think"]; explicit {
		name := strings.ToLower(route.UpstreamModel)
		if cfg["omit_temperature"] == true || strings.HasPrefix(stringValue(cfg["mode"]), "claude_") || strings.HasPrefix(name, "gpt-5") || strings.HasPrefix(name, "gpt-6") || strings.HasPrefix(name, "o3") || strings.HasPrefix(name, "o4") {
			req.Temperature = nil
			delete(req.Extra, "temperature")
		}
	}
	return req, nil
}
