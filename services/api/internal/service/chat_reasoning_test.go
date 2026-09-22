package service

import "testing"

func TestGLMThinkingToggle(t *testing.T) {
	model := &ModelFull{NewAPIModel: "GLM-4.6V"}
	for _, enabled := range []bool{false, true} {
		params, err := buildChatUpstreamParams(model, map[string]interface{}{"deep_think": enabled})
		if err != nil {
			t.Fatal(err)
		}
		want := "disabled"
		if enabled {
			want = "enabled"
		}
		if params["thinking"].(map[string]interface{})["type"] != want {
			t.Fatal(params)
		}
	}
	params, err := buildChatUpstreamParams(model, nil)
	if err != nil || params["thinking"] != nil {
		t.Fatal("unspecified thinking must retain provider default", params, err)
	}
	_, err = buildChatUpstreamParams(model, map[string]interface{}{"deep_think": "false"})
	if err == nil {
		t.Fatal("invalid toggle accepted")
	}
	model.RuntimeRule = map[string]interface{}{"reasoning": map[string]interface{}{"mode": "nvidia_chat_template"}}
	params, err = buildChatUpstreamParams(model, map[string]interface{}{"deep_think": false})
	if err != nil || params["thinking"] != nil || params["chat_template_kwargs"] == nil {
		t.Fatal("explicit provider mapping must take precedence", params, err)
	}
}

func TestBuildChatUpstreamParamsEnablesNVIDIAReasoningWithDefaultBudget(t *testing.T) {
	model := &ModelFull{
		RuntimeRule: map[string]interface{}{
			"reasoning": map[string]interface{}{
				"mode":           "nvidia_chat_template",
				"default_budget": 16384,
				"max_budget":     32768,
			},
		},
	}

	params, err := buildChatUpstreamParams(model, map[string]interface{}{"deep_think": true})
	if err != nil {
		t.Fatal(err)
	}
	template, ok := params["chat_template_kwargs"].(map[string]interface{})
	if !ok || template["enable_thinking"] != true {
		t.Fatalf("chat_template_kwargs=%#v", params["chat_template_kwargs"])
	}
	if params["reasoning_budget"] != 16384 {
		t.Fatalf("reasoning_budget=%#v", params["reasoning_budget"])
	}
}

func TestBuildChatUpstreamParamsRejectsBudgetOverModelLimit(t *testing.T) {
	model := &ModelFull{RuntimeRule: map[string]interface{}{
		"reasoning": map[string]interface{}{
			"mode":       "nvidia_chat_template",
			"max_budget": 16384,
		},
	}}

	_, err := buildChatUpstreamParams(model, map[string]interface{}{
		"deep_think":       true,
		"reasoning_budget": 16385,
	})
	if err == nil {
		t.Fatal("expected an error for a budget over the model limit")
	}
}

func TestBuildChatUpstreamParamsRejectsUnknownReasoningMapping(t *testing.T) {
	_, err := buildChatUpstreamParams(&ModelFull{}, map[string]interface{}{
		"deep_think":       true,
		"reasoning_budget": 1024,
	})
	if err == nil {
		t.Fatal("unknown model silently accepted deep thinking")
	}
}
