package main

import (
	"strings"
	"unicode"
)

// Precise mode keeps uncertain sales claims only when supported by user input.
func groundedDetailAnalysis(analysis, inputs map[string]interface{}) map[string]interface{} {
	out := copyMap(analysis)
	if commerceFreeCreation(inputs) {
		// Free mode keeps the AI's editable concept copy, including invented specs and benefits.
		return out
	}
	sections, ok := analysis["detail_sections"].([]interface{})
	if !ok {
		return out
	}
	userFacts := firstNonEmpty(stringAny(inputs["user_prompt"]), firstUserPrompt(inputs))
	grounded := func(text string) string {
		text = strings.TrimSpace(text)
		for _, token := range numericTokens(text) {
			if !strings.Contains(userFacts, token) {
				return ""
			}
		}
		for _, claim := range []string{"柔软", "舒适", "亲肤", "透气", "轻盈", "轻便", "无负担", "方便", "便捷", "实用", "环保", "安全", "无异味", "保暖", "弹性", "弹力", "不紧绷", "防风", "防水", "防雨", "防护", "保护", "活动自如", "一甩即干", "牢固", "耐用", "耐磨", "防滑", "抗菌", "防晒", "防皱", "不起球", "塑料", "纯棉", "羊毛", "羊绒", "新款", "销量", "认证", "售后", "首选", "必备", "春秋", "冬季", "技术", "科技", "专利", "专业", "高密度", "空气流通", "长时间", "保持干爽", "不闷脚", "吸湿", "速干", "缓震", "减震"} {
			if strings.Contains(text, claim) && !strings.Contains(userFacts, claim) {
				return ""
			}
		}
		return text
	}
	cleaned := make([]interface{}, 0, len(sections))
	for _, raw := range sections {
		section, ok := mapAny(raw)
		if !ok {
			continue
		}
		next := copyMap(section)
		next["copy_title"] = grounded(stringAny(section["copy_title"]))
		points := []string{}
		for _, point := range stringSlice(section["copy_points"]) {
			if text := grounded(point); text != "" {
				points = append(points, text)
			}
		}
		next["copy_points"] = points
		if stringAny(next["copy_title"]) == "" && len(points) == 0 {
			for _, safeTitle := range []string{"商品首屏", "设计特点", "可见细节", "外观细节", "使用情境", "使用场景", "商品识别", "商品收尾"} {
				if stringAny(section["title"]) == safeTitle {
					next["copy_title"] = safeTitle
					break
				}
			}
		}
		if stringAny(section["type"]) == "specification" && len(points) == 0 {
			next["type"], next["title"], next["copy_title"] = "closing", "外观收尾", "外观细节"
			next["objective"] = "以已观察到的外观细节收尾；用户未提供规格，不制作空参数表"
			next["image_prompt"] = "参考商品正面可见局部的单处近景，保留原有颜色和结构，与整页统一底色和光线；不制作尺寸图、参数表、多角度阵列或留白占位表格"
		}
		sectionPlan := strings.Join([]string{stringAny(section["title"]), stringAny(section["objective"]), stringAny(section["image_prompt"])}, "\n")
		if hasPositivePackagingMention(sectionPlan) && !strings.Contains(userFacts, "包装") {
			next["type"], next["title"], next["copy_title"] = "closing", "商品收尾", ""
			next["copy_points"] = []string{}
			next["objective"] = "回到参考商品本身完成详情页收尾"
			next["image_prompt"] = "参考商品完整或半身英雄式展示，保持原商品与人物身份，延续整页背景和光线；不生成包装盒、吊牌、赠品或品牌道具"
		}
		cleaned = append(cleaned, next)
	}
	out["detail_sections"] = cleaned
	return out
}

func numericTokens(text string) []string {
	tokens := []string{}
	var current strings.Builder
	flush := func() {
		if current.Len() > 0 {
			tokens = append(tokens, current.String())
			current.Reset()
		}
	}
	for _, r := range text {
		if unicode.IsDigit(r) || (r == '.' && current.Len() > 0) {
			current.WriteRune(r)
			continue
		}
		flush()
	}
	flush()
	return tokens
}

// A prohibition such as "不生成包装盒" is not a request to invent packaging.
// Keep this conservative heuristic idempotent when cleaned plans are read again.
func hasPositivePackagingMention(plan string) bool {
	for _, clause := range strings.FieldsFunc(plan, func(r rune) bool {
		return strings.ContainsRune("，,。.;；\n", r)
	}) {
		index := strings.Index(clause, "包装")
		if index < 0 {
			continue
		}
		prefix := clause[:index]
		negative := false
		for _, word := range []string{"不", "禁止", "避免", "无需", "无须"} {
			negative = negative || strings.Contains(prefix, word)
		}
		if !negative {
			return true
		}
	}
	return false
}
