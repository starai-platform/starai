package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestDetailPackagingExclusionPreservesModuleAndRepeatedCleaning(t *testing.T) {
	for _, exclusion := range []string{"不生成包装盒", "禁止添加包装盒", "避免虚构包装", "无需包装盒"} {
		section := map[string]interface{}{"type": "material", "title": "领口特写", "objective": "展示领口结构", "image_prompt": "领口微距；" + exclusion, "copy_title": "圆领设计"}
		inputs := map[string]interface{}{"user_prompt": "根据参考图生成详情"}
		clean := groundedDetailAnalysis(map[string]interface{}{"detail_sections": []interface{}{section}}, inputs)
		got := clean["detail_sections"].([]interface{})[0].(map[string]interface{})
		if got["image_prompt"] != section["image_prompt"] || got["type"] != "material" || got["copy_title"] != "圆领设计" {
			t.Fatalf("negative packaging instruction destroyed the plan: %#v", got)
		}
		if again := groundedDetailAnalysis(clean, inputs); !reflect.DeepEqual(clean, again) {
			t.Fatalf("cleaning changed an already cleaned plan: %#v", again)
		}
	}
}

func TestDetailCopyDropsUnsupportedClaimsAndEmptySpecifications(t *testing.T) {
	analysis := map[string]interface{}{"detail_sections": []interface{}{
		map[string]interface{}{"type": "material", "copy_title": "柔软亲肤", "copy_points": []interface{}{"米白到灰色渐变", "保暖透气"}},
		map[string]interface{}{"type": "specification", "copy_title": "规格参数"},
	}}
	clean := groundedDetailAnalysis(analysis, map[string]interface{}{"user_prompt": "请根据参考图生成衣服详情"})
	sections := clean["detail_sections"].([]interface{})
	material := sections[0].(map[string]interface{})
	if material["copy_title"] != "" || len(stringSlice(material["copy_points"])) != 1 || stringSlice(material["copy_points"])[0] != "米白到灰色渐变" {
		t.Fatalf("unsupported copy retained: %#v", material)
	}
	if sections[1].(map[string]interface{})["type"] != "closing" {
		t.Fatal("empty specifications should not become a blank module")
	}
	if analysis["detail_sections"].([]interface{})[0].(map[string]interface{})["copy_title"] != "柔软亲肤" {
		t.Fatal("mutated stored analysis")
	}
	clean = groundedDetailAnalysis(analysis, map[string]interface{}{"user_prompt": "已确认卖点：保暖透气"})
	if len(stringSlice(clean["detail_sections"].([]interface{})[0].(map[string]interface{})["copy_points"])) != 2 {
		t.Fatal("user-confirmed copy removed")
	}
}

func TestDetailCopyRejectsInventedMeasurementsAndPackaging(t *testing.T) {
	analysis := map[string]interface{}{"detail_sections": []interface{}{
		map[string]interface{}{"type": "specification", "copy_title": "尺寸参考", "copy_points": []interface{}{"衣长120cm"}, "image_prompt": "尺寸箭头展示"},
		map[string]interface{}{"type": "closing", "copy_title": "品牌收尾", "image_prompt": "商品与包装盒组合展示"},
	}}
	clean := groundedDetailAnalysis(analysis, map[string]interface{}{"user_prompt": "根据参考图生成详情"})
	sections := clean["detail_sections"].([]interface{})
	if sections[0].(map[string]interface{})["type"] != "closing" || len(stringSlice(sections[0].(map[string]interface{})["copy_points"])) != 0 {
		t.Fatalf("invented measurement retained: %#v", sections[0])
	}
	packaging := sections[1].(map[string]interface{})
	if strings.Contains(stringAny(packaging["image_prompt"]), "包装盒组合") || stringAny(packaging["title"]) != "商品收尾" {
		t.Fatalf("invented packaging retained: %#v", packaging)
	}
}

func TestDetailCopyKeepsAppearanceAndDropsInferredPerformance(t *testing.T) {
	analysis := map[string]interface{}{"detail_sections": []interface{}{
		map[string]interface{}{"type": "hero", "copy_title": "儿童长款透明雨衣", "copy_points": []interface{}{"蓝色透明设计，轻便防雨", "白色按扣清晰可见", "连帽按扣，穿脱便捷", "按扣闭合，牢固耐用"}},
	}}
	clean := groundedDetailAnalysis(analysis, map[string]interface{}{"user_prompt": "根据参考图生成详情"})
	section := clean["detail_sections"].([]interface{})[0].(map[string]interface{})
	points := stringSlice(section["copy_points"])
	if stringAny(section["copy_title"]) != "儿童长款透明雨衣" || len(points) != 1 || points[0] != "白色按扣清晰可见" {
		t.Fatalf("visual facts and inferred claims were not separated: %#v", section)
	}
}

func TestDetailCopyDoesNotTurnAudienceIntoAProductClaim(t *testing.T) {
	analysis := map[string]interface{}{"detail_sections": []interface{}{
		map[string]interface{}{"type": "benefit", "copy_points": []interface{}{"学生青年航拍入门首选"}},
	}}
	clean := groundedDetailAnalysis(analysis, map[string]interface{}{"user_prompt": "目标受众：学生青年"})
	section := clean["detail_sections"].([]interface{})[0].(map[string]interface{})
	if len(stringSlice(section["copy_points"])) != 0 {
		t.Fatalf("target audience became an unsupported selling claim: %#v", section)
	}
}

func TestDetailCopyKeepsSupportedKeywordsWithoutRequiringExactSentence(t *testing.T) {
	analysis := map[string]interface{}{"detail_sections": []interface{}{
		map[string]interface{}{"type": "benefit", "title": "设计特点", "copy_title": "透气设计", "copy_points": []interface{}{"透气网眼", "尺码36–42"}},
	}}
	clean := groundedDetailAnalysis(analysis, map[string]interface{}{"user_prompt": "舒爽透气，36-42码都有"})
	section := clean["detail_sections"].([]interface{})[0].(map[string]interface{})
	if stringAny(section["copy_title"]) != "透气设计" || len(stringSlice(section["copy_points"])) != 2 {
		t.Fatalf("supported paraphrase was removed: %#v", section)
	}
}

func TestDetailCopyDropsInventedTechnologyAndUsesSafeSectionLabel(t *testing.T) {
	analysis := map[string]interface{}{"detail_sections": []interface{}{
		map[string]interface{}{"type": "material", "title": "可见细节", "copy_title": "Hyperlite鞋底技术"},
	}}
	clean := groundedDetailAnalysis(analysis, map[string]interface{}{"user_prompt": "运动鞋，舒爽透气"})
	section := clean["detail_sections"].([]interface{})[0].(map[string]interface{})
	if stringAny(section["copy_title"]) != "可见细节" {
		t.Fatalf("invented technology was retained or safe fallback was lost: %#v", section)
	}
}
