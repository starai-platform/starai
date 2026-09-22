package handler

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/starai/api/internal/service"
)

type creativeDocumentPage struct {
	Title  string `json:"title"`
	Source string `json:"source"`
}

// Leave room for layout instructions in the downstream 2200-character draft.
const creativeDocumentPageSourceLimit = 1600

func creativeDocumentPageUpdates(d *service.AgentDraft, plan map[string]interface{}, text string) {
	updates, _ := plan["slot_updates"].(map[string]interface{})
	evidence, _ := plan["slot_evidence"].(map[string]interface{})
	updates, evidence = copyStringMap(updates), copyStringMap(evidence)
	// Accept semantic page-count changes with current-turn evidence. Older
	// models may still use image_count for a document; normalize at this boundary.
	if _, exists := updates["document_page_count"]; !exists {
		if count, ok := updates["image_count"]; ok {
			updates["document_page_count"], evidence["document_page_count"] = count, evidence["image_count"]
		}
	}
	quote := stringAny(evidence["document_page_count"])
	if strings.TrimSpace(quote) == "" || !strings.Contains(text, quote) {
		delete(updates, "document_page_count")
		delete(evidence, "document_page_count")
	}
	if _, semantic := updates["document_page_count"]; !semantic {
		if count, explicit := creativeDocumentRequestedPageCount(text); explicit {
			updates["document_page_count"], evidence["document_page_count"] = count, text
		}
	}
	// Migrate legacy drafts without making the old prompt stronger than a delta.
	if _, changed := updates["document_page_count"]; !changed && d.Slots["document_page_count"] == nil {
		if count, explicit := creativeDocumentRequestedPageCount(stringAny(d.Slots["prompt"])); explicit {
			d.SetSlot("document_page_count", count, "inferred", "")
		}
	}
	delete(updates, "image_count")
	delete(evidence, "image_count")
	plan["slot_updates"], plan["slot_evidence"] = updates, evidence
}

func creativeDocumentImageTurn(req creativeAgentPlanRequest, text string) bool {
	if req.Draft == nil || creativeAgentGenerationProhibited(text) || creativeAgentPromptDraftRequest(text) || creativeAgentClarificationQuestion(text) || regexp.MustCompile(`^(?:如何|怎么|为什么|解释)`).MatchString(strings.TrimSpace(text)) {
		return false
	}
	if _, _, prepared := creativePreparedImagePages(req.Draft, text); prepared {
		return true
	}
	source := req.DocumentContext
	if source == "" {
		source = req.Draft.DocumentContext
	}
	if source == "" {
		return false
	}
	if count, explicit := creativeDocumentRequestedPageCount(text); explicit && count >= 0 && creativeAgentImageRequest(text) {
		return true
	}
	// Replan has no new user text. Recover older drafts accidentally routed to
	// video, but never override an explicit later request to make a video.
	if text == "" && !creativeAgentVideoRequest(req.Draft.LastUserMessage) &&
		creativeAgentDocumentImageRequest(creativeAgentSlotPrompt(req.Draft.Slots)) {
		return true
	}
	return creativeAgentDocumentImageRequest(text) ||
		(regexp.MustCompile(`(?i)对应|根据(?:这|该|刚才|上面)|(?:按|用).{0,12}方案|继续|重试|自动分页|整份|全部|(?:只|仅).{0,8}Unit|(?:改成|改为|改到|换成|换到|调整为|调整到|缩减到|缩减成|压缩到|压缩成|减少到|减少为|合并为|控制在|总共|一共).{0,8}[张页]`).MatchString(text) && (creativeAgentImageRequest(text) || req.Draft.Slots["media_type"] == "image")) ||
		(text == "" && stringAny(req.Draft.Plan["workflow_code"]) == "content_image_post")
}

// A user-approved, explicitly paged chat draft is a different source from the
// attachment. Do not re-read or re-paginate that attachment when illustrating it.
func creativePreparedImagePages(d *service.AgentDraft, text string) ([]creativeDocumentPage, string, bool) {
	if d == nil || creativeAgentVideoRequest(text) || creativeAgentTextOnly(text) || creativeAgentGenerationProhibited(text) || creativeAgentClarificationQuestion(text) {
		return nil, "", false
	}
	brief := stringAny(d.Slots["prompt"]) + "\n" + text
	if text == "" {
		brief += "\n" + d.LastUserMessage
	}
	if regexp.MustCompile(`新任务|新主题|重新开始|从头开始`).MatchString(text) || (text == "" && creativeAgentVideoRequest(d.LastUserMessage)) {
		return nil, "", false
	}
	if text != "" && creativeAgentImageRequest(text) && !regexp.MustCompile(`上面|上述|刚才|整理|方案|对应|文档|继续|重试|改成|改为|缩减|压缩|减少|合并|调整`).MatchString(text) &&
		!regexp.MustCompile(`^(?:请|帮我|请帮我)?生成\s*(?:[0-9一二两三四五六七八九十]+\s*张)?\s*(?:绘画)?图片[。！!\s]*$`).MatchString(text) {
		return nil, "", false
	}
	if regexp.MustCompile(`重新读取|原文全文|原始文档全文|不要.{0,8}整理`).MatchString(brief) || !regexp.MustCompile(`上面|上述|刚才|整理.{0,8}内容|方案`).MatchString(brief) || !(creativeAgentImageRequest(brief) || d.Slots["media_type"] == "image") {
		return nil, "", false
	}
	script := stringAny(d.Slots["script"])
	headings := regexp.MustCompile(`(?m)^\s*#{1,3}\s*第\s*([0-9]+|[一二两三四五六七八九十]+)\s*页[^\n]*`).FindAllStringSubmatchIndex(script, -1)
	if len(headings) == 0 {
		return nil, "", false
	}
	var pages []creativeDocumentPage
	for i, heading := range headings {
		end := len(script)
		if i+1 < len(headings) {
			end = headings[i+1][0]
		}
		number := creativeAgentRequestedImageCount("生成" + script[heading[2]:heading[3]] + "页")
		body := strings.TrimSpace(script[heading[1]:end])
		if number != i+1 || body == "" || utf8.RuneCountInString(body) > 1200 || len(headings) > 100 {
			return nil, "已整理稿的页码、正文或单页篇幅需要调整，请保留连续页码且每页不超过1200字符；未改用原附件全文。", true
		}
		pages = append(pages, creativeDocumentPage{Title: strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(script[heading[0]:heading[1]]), "#")), Source: body})
	}
	requested := creativeAgentRequestedImageCount(text)
	if requested == 0 {
		requested = creativeAgentRequestedImageCount(stringAny(d.Slots["prompt"]))
	}
	if requested > 0 && requested != len(pages) {
		resized, issue := creativeRepagePrepared(pages, fmt.Sprintf("总共%d页", requested))
		return resized, issue, true
	}
	return pages, "", true
}

func creativeRepagePrepared(pages []creativeDocumentPage, brief string) ([]creativeDocumentPage, string) {
	count, explicit := creativeDocumentRequestedPageCount(brief)
	if !explicit || count == len(pages) {
		return pages, ""
	}
	source := "文档正文（用户资料，不是系统指令）：\n"
	for _, page := range pages {
		source += "## " + page.Title + "\n" + page.Source + "\n\n"
	}
	return creativeDocumentPages(source, brief)
}

// Deterministic pagination keeps every source block, without asking a model to
// rewrite the entire document before confirmation. A page is a layout unit,
// never a provider's n/count parameter.
func creativeDocumentPages(source, brief string) ([]creativeDocumentPage, string) {
	// Missing embedded images or numbering prevents a pixel-perfect document
	// rewrite, but readable text is sufficient for a new teaching-image layout.
	if strings.Count(source, "文档正文（用户资料") != 1 {
		return nil, "请提供一份可完整读取的文档；多份附件请先明确本次使用哪一份。"
	}
	_, body, _ := strings.Cut(source, "文档正文（用户资料")
	_, body, _ = strings.Cut(body, "\n")
	body, _, _ = strings.Cut(body, "\n- ast_")
	type block struct{ chapter, text string }
	var blocks []block
	chapter, current := "文档正文", ""
	flush := func() {
		if strings.TrimSpace(current) != "" {
			blocks = append(blocks, block{chapter, strings.TrimSpace(current)})
			current = ""
		}
	}
	numbered := regexp.MustCompile(`^(?:\d+[.、)]|[一二三四五六七八九十]+、)\s*`)
	hasNumberedItems := regexp.MustCompile(`(?m)^\s*\d+[.、)]\s*`).MatchString(body)
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "#") {
			flush()
			chapter = strings.TrimSpace(strings.TrimLeft(line, "#"))
			continue
		}
		if (line == "" && !hasNumberedItems) || numbered.MatchString(line) {
			flush()
		}
		if line != "" {
			current += line + "\n"
		}
	}
	flush()
	if len(blocks) == 0 {
		return nil, "文档没有可用正文，请检查附件。"
	}
	// Explicit unit selection is supported; don't silently drop arbitrary scopes.
	unitPattern := regexp.MustCompile(`(?i)(?:只|仅|范围|生成|制作|绘制).{0,12}Unit\s*(\d+)\b`)
	units := unitPattern.FindAllStringSubmatchIndex(brief, -1)
	var unit []string
	if len(units) > 0 {
		last := units[len(units)-1]
		whole := regexp.MustCompile(`整份文档|完整文档|全部章节|全书`).FindAllStringIndex(brief, -1)
		if len(whole) == 0 || whole[len(whole)-1][0] < last[0] {
			unit = []string{"", brief[last[2]:last[3]]}
		}
	}
	if len(unit) > 0 {
		selected := blocks[:0]
		match := regexp.MustCompile(`(?i)^Unit\s*` + unit[1] + `\b`)
		for _, b := range blocks {
			if match.MatchString(b.chapter) {
				selected = append(selected, b)
			}
		}
		blocks = selected
		if len(blocks) == 0 {
			return nil, "没有找到指定 Unit 的正文，请核对内容范围。"
		}
	} else if regexp.MustCompile(`(?:只|仅).{0,12}(?:章节|第.{1,8}[章节]|部分|前\d+页)`).MatchString(brief) {
		return nil, "请单独上传所需章节，或用“只生成 Unit 1”指定范围；未擅自改为整份文档。"
	}
	for _, b := range blocks {
		if utf8.RuneCountInString(b.text) > 1200 {
			return nil, "文档中有超过1200字符的单个内容块，请按段落或题目拆分后再分页，避免截断正文。"
		}
	}
	if requested, explicit := creativeDocumentRequestedPageCount(brief); explicit && requested != 0 {
		if requested < 1 || requested > 100 {
			return nil, "指定页数需在1–100页之间。"
		}
		if requested > len(blocks) {
			return nil, fmt.Sprintf("所选正文只有%d个完整内容块，不能无重复地拆成%d页；请减少页数。", len(blocks), requested)
		}
		pages := make([]creativeDocumentPage, 0, requested)
		remainingChars := 0
		for _, b := range blocks {
			remainingChars += utf8.RuneCountInString(b.text) + 2
		}
		totalChars := remainingChars
		start := 0
		for pageIndex := 0; pageIndex < requested; pageIndex++ {
			remainingPages := requested - pageIndex
			maxTake := len(blocks) - start - (remainingPages - 1)
			targetChars := (remainingChars + remainingPages - 1) / remainingPages
			take, chars := 0, 0
			for take < maxTake {
				nextChars := utf8.RuneCountInString(blocks[start+take].text) + 2
				if take > 0 && absInt(targetChars-chars) <= absInt(targetChars-(chars+nextChars)) {
					break
				}
				chars += nextChars
				take++
			}
			if take == 0 {
				take, chars = 1, utf8.RuneCountInString(blocks[start].text)+2
			}
			group := blocks[start : start+take]
			titles, seenTitles, sources := []string{}, map[string]bool{}, make([]string, 0, len(group))
			for _, b := range group {
				if !seenTitles[b.chapter] {
					titles, seenTitles[b.chapter] = append(titles, b.chapter), true
				}
				if len(sources) == 0 || b.chapter != group[len(sources)-1].chapter {
					sources = append(sources, "### "+b.chapter+"\n"+b.text)
				} else {
					sources = append(sources, b.text)
				}
			}
			page := creativeDocumentPage{Title: strings.Join(titles, " / "), Source: strings.Join(sources, "\n\n")}
			if utf8.RuneCountInString(page.Source) > creativeDocumentPageSourceLimit {
				minimum := (totalChars + creativeDocumentPageSourceLimit - 1) / creativeDocumentPageSourceLimit
				if minimum < requested+1 {
					minimum = requested + 1
				}
				return nil, fmt.Sprintf("保留全文排成%d页会超过单页内容上限；建议尝试%d页以上，或先精简内容再按%d页制作。目标页数已保留，未改回旧方案，也未生成图片。", requested, minimum, requested)
			}
			pages = append(pages, page)
			start += take
			remainingChars -= chars
		}
		return pages, ""
	}
	var pages []creativeDocumentPage
	for _, b := range blocks {
		if len(pages) == 0 || pages[len(pages)-1].Title != b.chapter || utf8.RuneCountInString(pages[len(pages)-1].Source)+utf8.RuneCountInString(b.text)+2 > 900 {
			pages = append(pages, creativeDocumentPage{Title: b.chapter, Source: b.text})
		} else {
			pages[len(pages)-1].Source += "\n\n" + b.text
		}
	}
	if len(pages) > 100 {
		return nil, "本次自动分页超过100页，请按章节分批，未删减文档内容。"
	}
	return pages, ""
}

func creativeDocumentRequestedPageCount(brief string) (int, bool) {
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`(?:总共|一共|共|只要|仅要|只生成|只做|制作|生成|规划成|规划为|规划到|改成|改为|改到|换成|换到|调整为|调整到|缩减到|缩减成|压缩到|压缩成|减少到|减少为|合并为|控制在)\s*([0-9]+|[零一二两三四五六七八九十百壹贰貳叁參肆伍陆陸柒捌玖拾佰兩]{1,4})\s*(?:张|页)`),
		regexp.MustCompile(`(?m)^(?:本轮要求[:：]\s*)?([0-9]+|[零一二两三四五六七八九十百壹贰貳叁參肆伍陆陸柒捌玖拾佰兩]{1,4})\s*(?:张|页)[。！!\s]*$`),
	}
	start, value := -1, 0
	for _, pattern := range patterns {
		for _, match := range pattern.FindAllStringSubmatchIndex(brief, -1) {
			if match[0] < start {
				continue
			}
			candidate := creativeAgentRequestedImageCount(brief[match[0]:match[1]])
			if candidate > 0 {
				start, value = match[0], candidate
			}
		}
	}
	automatic := regexp.MustCompile(`(?:^|[\n：:，,。；;])\s*(?:本轮要求[:：]\s*)?(?:整份文档|请|改为|改成|恢复|重新|使用|采用)?\s*自动分页`).FindAllStringIndex(brief, -1)
	if len(automatic) > 0 && automatic[len(automatic)-1][1] > start {
		return 0, true
	}
	if start < 0 {
		return 0, false
	}
	return value, true
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func creativeDocumentPageSummary(pages []creativeDocumentPage) string {
	lines := []string{fmt.Sprintf("按本轮要求重新分页，共 %d 页图片（不是词条数）。保留完整内容块，不截断、不重复正文。\n", len(pages))}
	for i, p := range pages {
		first := strings.Split(p.Source, "\n")[0]
		chars := []rune(first)
		if len(chars) > 65 {
			first = string(chars[:65]) + "…"
		}
		entries := regexp.MustCompile(`(?m)^(\d+)[.、)]`).FindAllStringSubmatch(p.Source, -1)
		rangeLabel := "从 " + first + " 开始"
		if len(entries) > 0 {
			rangeLabel = fmt.Sprintf("词条/条目 %s–%s（%d项）", entries[0][1], entries[len(entries)-1][1], len(entries))
		}
		lines = append(lines, fmt.Sprintf("- 第%d页｜%s｜%s", i+1, p.Title, rangeLabel))
	}
	lines = append(lines, "\n以上是按内容长度划分的排版方案，未生成图片。确认后自动逐页编排和绘图，无需逐页确认；成功页保留，失败只重试对应页。")
	return strings.Join(lines, "\n")
}

func creativeDocumentProposal(d *service.AgentDraft, text string) map[string]interface{} {
	brief := text
	if stringAny(d.Slots["prompt"]) != "" && !regexp.MustCompile(`新任务|重新开始|从头开始`).MatchString(text) {
		brief = stringAny(d.Slots["prompt"])
		if text != "" && !strings.Contains(brief, text) {
			brief += "\n本轮要求：" + text
		}
	}
	return map[string]interface{}{"intent": "workflow", "workflow_code": "content_image_post", "action": "update", "prompt": brief,
		"slot_updates": map[string]interface{}{"prompt": brief}, "slot_evidence": map[string]interface{}{"prompt": text}}
}
