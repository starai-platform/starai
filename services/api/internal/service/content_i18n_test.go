package service

import (
	"reflect"
	"testing"
)

func TestExtractModelTranslationFieldsKeepsEnumValuesStable(t *testing.T) {
	schema := map[string]interface{}{
		"properties": map[string]interface{}{
			"style": map[string]interface{}{
				"type": "string", "title": "风格", "enum": []interface{}{"自然", "写实"},
			},
		},
	}
	fields := ExtractModelTranslationFields("图像模型", "生成图片", []string{"热门"}, schema)
	for path, want := range map[string]string{
		"/display_name":                        "图像模型",
		"/description":                         "生成图片",
		"/tags/0":                              "热门",
		"/input_schema/properties/style/title": "风格",
		"/input_schema/properties/style/x-enum-labels/0": "自然",
	} {
		if fields[path] != want {
			t.Fatalf("field %s = %q, want %q", path, fields[path], want)
		}
	}
	if _, changed := fields["/input_schema/properties/style/enum/0"]; changed {
		t.Fatal("enum parameter values must not be translated directly")
	}
}

func TestSetJSONPointerCreatesEnumLabels(t *testing.T) {
	document := map[string]interface{}{
		"input_schema": map[string]interface{}{
			"properties": map[string]interface{}{
				"style": map[string]interface{}{"enum": []interface{}{"自然", "写实"}},
			},
		},
	}
	document = setJSONPointer(document, "/input_schema/properties/style/x-enum-labels/1", "Realistic").(map[string]interface{})
	style := document["input_schema"].(map[string]interface{})["properties"].(map[string]interface{})["style"].(map[string]interface{})
	if !reflect.DeepEqual(style["enum"], []interface{}{"自然", "写实"}) {
		t.Fatal("enum values changed")
	}
	labels := style["x-enum-labels"].([]interface{})
	if labels[1] != "Realistic" {
		t.Fatalf("enum label = %#v", labels)
	}
}

func TestExtractWorkflowTranslationFieldsIncludesConfigLists(t *testing.T) {
	display := map[string]interface{}{
		"input": map[string]interface{}{
			"image_label": "风格参考图",
			"modes":       []interface{}{"逐步确认", "智能托管"},
		},
		"timeline": []interface{}{"漫剧规划", "关键帧生成", "视频合成"},
	}
	fields := ExtractWorkflowTranslationFields("AI 漫剧", "一键生成漫剧", nil, nil, display)
	for path, want := range map[string]string{
		"/name":                             "AI 漫剧",
		"/description":                      "一键生成漫剧",
		"/display_config/input/image_label": "风格参考图",
		"/display_config/input/modes/0":     "逐步确认",
		"/display_config/timeline/2":        "视频合成",
	} {
		if fields[path] != want {
			t.Fatalf("field %s = %q, want %q", path, fields[path], want)
		}
	}
}

func TestExtractAPIDocTranslationFields(t *testing.T) {
	content := map[string]interface{}{
		"features":        []interface{}{"流式输出", "多轮对话"},
		"parameters":      []interface{}{map[string]interface{}{"name": "prompt", "description": "用户提示词"}},
		"notes":           []interface{}{"请妥善保管密钥"},
		"request_example": map[string]interface{}{"prompt": "一只赛博朋克风格的猫"},
	}
	fields := ExtractAPIDocTranslationFields("开放接口", "模型调用文档", "图像模型", "生成图片", content)
	for path, want := range map[string]string{
		"/title":                            "开放接口",
		"/summary":                          "模型调用文档",
		"/model_name":                       "图像模型",
		"/content/features/0":               "流式输出",
		"/content/parameters/0/description": "用户提示词",
		"/content/notes/0":                  "请妥善保管密钥",
		"/content/request_example/prompt":   "一只赛博朋克风格的猫",
	} {
		if fields[path] != want {
			t.Fatalf("field %s = %q, want %q", path, fields[path], want)
		}
	}
}

func TestNormalizeContentLocale(t *testing.T) {
	for input, want := range map[string]string{"en": "en-US", "en_us": "en-US", "ja-JP,ja;q=0.9": "ja-JP", "zh-CN": "zh-CN"} {
		if got := normalizeContentLocale(input); got != want {
			t.Fatalf("normalizeContentLocale(%q) = %q, want %q", input, got, want)
		}
	}
}
