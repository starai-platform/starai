package handler

import (
	"fmt"
	"strconv"

	"github.com/starai/api/internal/service"
)

func creativeAgentTimedCopyGuidance(d *service.AgentDraft, text string) string {
	if !creativeAgentWritingRequest(text) && !creativeAgentSpeechRequest(text) {
		return ""
	}
	seconds := creativeAgentPositiveInt(d.Slots["target_duration_sec"])
	if lo, hi, ok := creativeAgentRequestedDuration(nil, text); ok {
		seconds = (lo + hi) / 2
	}
	if seconds <= 0 {
		return ""
	}
	rate, _ := strconv.ParseFloat(fmt.Sprint(d.Slots["speech_rate"]), 64)
	if current, _, ok := creativeAgentRequestedSpeechRates(text); ok {
		rate = current
	}
	if rate == 0 {
		if prior, _, ok := creativeAgentRequestedSpeechRates(stringAny(d.Slots["prompt"])); ok {
			rate = prior
		}
	}
	if rate < 0.5 || rate > 2 {
		rate = 1
	}
	return fmt.Sprintf("\n本轮为限时口播内容：目标%d秒、语速%g倍。中文可按常速约每秒4字粗估，正文控制在约%d个汉字以内，并为停顿留余量；这是写作预算，不是音频实测。交付一段自然口播正文，去掉标题、Markdown、序号、前言和总结套话。内容过长时保留核心意思压缩，不能把长文章原样朗读，也不能声称已实测20秒。纯文案用CHAT直接写正文；用户明确要求音频时，用speech计划，把精简后的完整朗读正文放入slot_updates.script供确认，保留用户指定的性别、语速及最高语速，不凭空提高倍速。", seconds, rate, int(float64(seconds)*4*rate))
}
