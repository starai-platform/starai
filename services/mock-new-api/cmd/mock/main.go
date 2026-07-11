package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3002"
	}
	failureRate := 0.0
	if v := os.Getenv("MOCK_FAILURE_RATE"); v != "" {
		fmt.Sscanf(v, "%f", &failureRate)
	}

	r := gin.Default()
	r.POST("/v1/chat/completions", func(c *gin.Context) {
		var req struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
			Stream bool `json:"stream"`
		}
		c.ShouldBindJSON(&req)

		msgs := make([]message, 0, len(req.Messages))
		for _, m := range req.Messages {
			msgs = append(msgs, message{Role: m.Role, Content: m.Content})
		}
		reply := buildReply(req.Model, msgs)

		if req.Stream {
			c.Writer.Header().Set("Content-Type", "text/event-stream")
			c.Writer.Header().Set("Cache-Control", "no-cache")
			flusher, _ := c.Writer.(http.Flusher)
			words := strings.Split(reply, "")
			for i, ch := range words {
				event := map[string]interface{}{
					"choices": []map[string]interface{}{
						{"delta": map[string]string{"content": ch}, "index": 0},
					},
				}
				data, _ := json.Marshal(event)
				fmt.Fprintf(c.Writer, "data: %s\n\n", data)
				flusher.Flush()
				if i%3 == 0 {
					time.Sleep(20 * time.Millisecond)
				}
			}
			usage := map[string]interface{}{
				"usage": map[string]int{"prompt_tokens": 50, "completion_tokens": len(words), "total_tokens": 50 + len(words)},
			}
			data, _ := json.Marshal(usage)
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			fmt.Fprintf(c.Writer, "data: [DONE]\n\n")
			return
		}

		c.JSON(200, gin.H{
			"choices": []gin.H{{"message": gin.H{"role": "assistant", "content": reply}}},
			"usage":   gin.H{"prompt_tokens": 50, "completion_tokens": 100, "total_tokens": 150},
		})
	})

	r.POST("/v1/images/generations", func(c *gin.Context) {
		if rand.Float64() < failureRate {
			c.JSON(500, gin.H{"error": gin.H{"message": "model provider error", "type": "server_error"}})
			return
		}
		var req struct {
			Prompt string `json:"prompt"`
			N      int    `json:"n"`
			Size   string `json:"size"`
		}
		c.ShouldBindJSON(&req)
		n := req.N
		if n < 1 {
			n = 1
		}
		var data []gin.H
		for i := 0; i < n; i++ {
			seed := rand.Intn(10000)
			url := fmt.Sprintf("https://picsum.photos/seed/%d/1024/1024", seed)
			data = append(data, gin.H{"url": url})
		}
		c.JSON(200, gin.H{"data": data, "created": time.Now().Unix()})
	})

	videoJobs := map[string]int64{}
	handleVideoCreate := func(c *gin.Context) {
		if rand.Float64() < failureRate {
			c.JSON(500, gin.H{"error": gin.H{"message": "model provider error", "type": "server_error"}})
			return
		}
		var req struct {
			Prompt string `json:"prompt"`
			Model  string `json:"model"`
		}
		c.ShouldBindJSON(&req)
		id := fmt.Sprintf("mock_vid_%d", time.Now().UnixNano())
		videoJobs[id] = time.Now().Unix()
		c.JSON(200, gin.H{
			"id":         id,
			"object":     "video",
			"status":     "queued",
			"model":      req.Model,
			"progress":   0,
			"created_at": time.Now().Unix(),
		})
	}
	r.POST("/v1/video/generations", handleVideoCreate)
	r.POST("/v1/videos", handleVideoCreate)
	handleVideoPoll := func(c *gin.Context) {
		id := c.Param("id")
		created, ok := videoJobs[id]
		if !ok {
			c.JSON(404, gin.H{"error": gin.H{"message": "task not found"}})
			return
		}
		if time.Now().Unix()-created < 2 {
			c.JSON(200, gin.H{"id": id, "object": "video", "status": "processing", "progress": 50})
			return
		}
		seed := rand.Intn(10000)
		c.JSON(200, gin.H{
			"id":           id,
			"object":       "video",
			"status":       "completed",
			"progress":     100,
			"video_url":    "https://www.w3schools.com/html/mov_bbb.mp4",
			"completed_at": time.Now().Unix(),
			"data": []gin.H{{
				"url":       "https://www.w3schools.com/html/mov_bbb.mp4",
				"thumbnail": fmt.Sprintf("https://picsum.photos/seed/%d/640/360", seed),
			}},
		})
	}
	r.GET("/v1/video/generations/:id", handleVideoPoll)
	r.GET("/v1/videos/:id", handleVideoPoll)

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	log.Printf("Mock NEW API listening on :%s (failure_rate=%.2f)", port, failureRate)
	r.Run(":" + port)
}

type message struct {
	Role    string
	Content string
}

type mockAnswer struct {
	ModelCode   string `json:"model_code"`
	DisplayName string `json:"display_name"`
	Content     string `json:"content"`
}

// buildReply produces a context-aware mock reply so that multi-model
// collaboration, summary models, and referenced asset documents can all be
// verified locally.
func buildReply(model string, messages []message) string {
	var systemParts []string
	lastUser := ""
	isSummary := false
	isTranslation := false
	for _, m := range messages {
		switch m.Role {
		case "system":
			systemParts = append(systemParts, m.Content)
			if strings.Contains(m.Content, `"translations"`) && strings.Contains(m.Content, "Return only") {
				isTranslation = true
			}
			if strings.Contains(m.Content, "多模型协作的总结模型") {
				isSummary = true
			}
		case "user":
			lastUser = m.Content
		}
	}
	if isTranslation {
		start := strings.Index(lastUser, "[")
		if start >= 0 {
			var rows []map[string]interface{}
			if json.Unmarshal([]byte(lastUser[start:]), &rows) == nil {
				translations := map[string]string{}
				for _, row := range rows {
					key := fmt.Sprint(row["key"])
					if key == "<nil>" || key == "" {
						key = fmt.Sprint(row["id"])
					}
					if key != "<nil>" && key != "" {
						translations[key] = "Translated: " + fmt.Sprint(row["text"])
					}
				}
				encoded, _ := json.Marshal(map[string]interface{}{"translations": translations})
				return string(encoded)
			}
		}
	}

	if isSummary {
		return buildSummaryReply(lastUser)
	}

	systemBlob := strings.Join(systemParts, "\n")
	assetExcerpt := extractAssetExcerpt(systemBlob)
	label := model
	if label == "" {
		label = "StarAI Mock"
	}
	return buildAnswerReply(label, lastUser, assetExcerpt, systemBlob)
}

func extractAssetExcerpt(systemBlob string) string {
	idx := strings.Index(systemBlob, "文档正文摘录：")
	if idx < 0 {
		return ""
	}
	rest := strings.TrimSpace(systemBlob[idx+len("文档正文摘录："):])
	if nl := strings.Index(rest, "\n- "); nl > 0 {
		rest = rest[:nl]
	}
	rest = strings.TrimSpace(rest)
	r := []rune(rest)
	if len(r) > 400 {
		return string(r[:400]) + "..."
	}
	return rest
}

func hasAssetContext(systemBlob string) bool {
	for _, kw := range []string{"用户资产", "文档正文摘录", "asset public_ids", "attachment asset", "引用了以下用户资产"} {
		if strings.Contains(systemBlob, kw) {
			return true
		}
	}
	return false
}

func buildAnswerReply(modelLabel, question, assetExcerpt, systemBlob string) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("## %s 的回答\n\n", modelLabel))

	if question != "" {
		b.WriteString(fmt.Sprintf("针对你的问题「%s」，建议从以下几个方面优化：\n\n", strings.TrimSpace(question)))
	}

	// Generate substantive mock content based on question keywords.
	lower := strings.ToLower(question)
	if strings.Contains(question, "并发") || strings.Contains(lower, "concurrent") || strings.Contains(question, "宕机") {
		b.WriteString("### 1. 应用层优化\n")
		b.WriteString("- 引入缓存（Redis）减少数据库压力\n")
		b.WriteString("- 异步化非核心任务（消息队列）\n")
		b.WriteString("- 限流与熔断（令牌桶、滑动窗口）\n\n")
		b.WriteString("### 2. 架构层优化\n")
		b.WriteString("- 水平扩展：无状态服务 + 负载均衡\n")
		b.WriteString("- 读写分离、分库分表\n")
		b.WriteString("- CDN 加速静态资源\n\n")
		b.WriteString("### 3. 运维监控\n")
		b.WriteString("- 完善监控告警（CPU、内存、QPS、错误率）\n")
		b.WriteString("- 自动扩缩容（K8s HPA）\n")
		b.WriteString("- 定期压测与容灾演练\n")
	} else {
		b.WriteString("### 分析与建议\n")
		b.WriteString("根据你的描述，建议先梳理当前系统瓶颈（CPU、IO、网络、数据库），再针对性优化。\n")
		b.WriteString("作为开发兼运维，优先保障核心链路稳定性，再逐步完善监控与自动化。\n")
	}

	if assetExcerpt != "" {
		b.WriteString("\n### 参考资产文档\n")
		b.WriteString("结合你引用的文档内容：\n> ")
		b.WriteString(strings.ReplaceAll(assetExcerpt, "\n", "\n> "))
		b.WriteString("\n")
	} else if hasAssetContext(systemBlob) {
		b.WriteString("\n> 已识别到你引用的资产，但文档正文暂未解析到可读文本。\n")
	}

	return b.String()
}

func buildSummaryReply(summaryUserPrompt string) string {
	question := summaryUserPrompt
	if idx := strings.Index(summaryUserPrompt, "问答模型输出 JSON"); idx >= 0 {
		question = strings.TrimSpace(strings.TrimPrefix(summaryUserPrompt[:idx], "用户问题："))
	}
	answers := parseAnswerJSON(summaryUserPrompt)

	var b strings.Builder
	b.WriteString("## 综合总结\n\n")
	if question != "" {
		b.WriteString(fmt.Sprintf("针对问题「%s」，综合 %d 个问答模型的回答，核心建议如下：\n\n", strings.TrimSpace(question), len(answers)))
	}
	if len(answers) == 0 {
		b.WriteString("（未能解析到各模型回答，请检查问答模型是否正常返回）")
		return b.String()
	}

	// Collect key points from each model's full content.
	seen := map[string]bool{}
	var points []string
	for _, a := range answers {
		for _, line := range strings.Split(a.Content, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			line = strings.TrimLeft(line, "- ")
			if len(line) < 4 || seen[line] {
				continue
			}
			seen[line] = true
			points = append(points, line)
		}
	}
	if len(points) > 0 {
		b.WriteString("### 核心要点\n")
		for i, p := range points {
			if i >= 8 {
				break
			}
			b.WriteString(fmt.Sprintf("- %s\n", p))
		}
		b.WriteString("\n")
	}

	b.WriteString("### 各模型观点\n")
	for i, a := range answers {
		name := a.DisplayName
		if name == "" {
			name = a.ModelCode
		}
		snippet := summarizeContent(a.Content)
		b.WriteString(fmt.Sprintf("%d. **%s**：%s\n", i+1, name, snippet))
	}
	b.WriteString("\n> 以上结论综合了各问答模型的输出，去重后形成最终建议。")
	return b.String()
}

func summarizeContent(s string) string {
	s = strings.TrimSpace(s)
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(strings.TrimLeft(line, "-# "))
		if len(line) > 10 && !strings.HasPrefix(line, "针对") && !strings.HasPrefix(line, "【") {
			r := []rune(line)
			if len(r) > 120 {
				return string(r[:120]) + "..."
			}
			return line
		}
	}
	r := []rune(s)
	if len(r) > 120 {
		return string(r[:120]) + "..."
	}
	return s
}

func parseAnswerJSON(prompt string) []mockAnswer {
	start := strings.Index(prompt, "[")
	end := strings.LastIndex(prompt, "]")
	if start < 0 || end <= start {
		return nil
	}
	var out []mockAnswer
	if err := json.Unmarshal([]byte(prompt[start:end+1]), &out); err != nil {
		return nil
	}
	return out
}
