package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type WebSearchConfig struct {
	Enabled       bool
	Provider      string
	APIKey        string
	ExaAPIKey     string
	BaseURL       string
	RedFoxAPIKey  string
	RedFoxBaseURL string
	RedFoxEngine  string
	SearchDepth   string
	MaxResults    int
	TimeoutSec    int
	DailyLimit    int
	CacheTTLSec   int
	UnitPrice     float64
}

type WebSearchResult struct {
	Title         string  `json:"title"`
	URL           string  `json:"url"`
	Snippet       string  `json:"snippet"`
	PublishedDate string  `json:"published_date,omitempty"`
	Score         float64 `json:"score,omitempty"`
	Provider      string  `json:"provider,omitempty"`
}

type WebSearchRequest struct {
	Query          string
	Topic          string
	TimeRange      string
	IncludeDomains []string
}

var tavilySearchURL = "https://api.tavily.com/search"
var exaSearchURL = "https://api.exa.ai/search"

var ErrWebSearchNoResults = errors.New("搜索服务未返回有效结果")
var ErrWebSearchUnavailable = errors.New("搜索上游引擎不可用")

const defaultRedFoxBaseURL = "https://redfox.hk"

func ParseWebSearchConfig(values map[string]interface{}) WebSearchConfig {
	cfg := WebSearchConfig{
		Enabled:       boolConfigValue(values["web_search_enabled"]),
		Provider:      strings.ToLower(strings.TrimSpace(stringConfigValue(values["web_search_provider"]))),
		APIKey:        strings.TrimSpace(stringConfigValue(values["web_search_api_key"])),
		ExaAPIKey:     strings.TrimSpace(stringConfigValue(values["web_search_exa_api_key"])),
		BaseURL:       strings.TrimSpace(stringConfigValue(values["web_search_base_url"])),
		RedFoxAPIKey:  strings.TrimSpace(stringConfigValue(values["web_search_redfox_api_key"])),
		RedFoxBaseURL: strings.TrimSpace(stringConfigValue(values["web_search_redfox_base_url"])),
		RedFoxEngine:  strings.ToLower(strings.TrimSpace(stringConfigValue(values["web_search_redfox_engine"]))),
		SearchDepth:   strings.ToLower(strings.TrimSpace(stringConfigValue(values["web_search_depth"]))),
		MaxResults:    intConfigValue(values["web_search_max_results"], 5),
		TimeoutSec:    intConfigValue(values["web_search_timeout_sec"], 12),
		DailyLimit:    intConfigValue(values["web_search_daily_limit"], 100),
		CacheTTLSec:   intConfigValue(values["web_search_cache_ttl_sec"], 600),
		UnitPrice:     floatConfigValue(values["web_search_unit_price"]),
	}
	if cfg.Provider == "" {
		cfg.Provider = "tavily"
	}
	if cfg.SearchDepth != "advanced" {
		cfg.SearchDepth = "basic"
	}
	if cfg.RedFoxEngine == "" {
		cfg.RedFoxEngine = "kimi"
	}
	if cfg.MaxResults < 1 {
		cfg.MaxResults = 1
	} else if cfg.MaxResults > 10 {
		cfg.MaxResults = 10
	}
	if cfg.TimeoutSec < 3 {
		cfg.TimeoutSec = 3
	} else if cfg.TimeoutSec > 30 {
		cfg.TimeoutSec = 30
	}
	if cfg.DailyLimit < 0 {
		cfg.DailyLimit = 0
	}
	if cfg.CacheTTLSec < 0 {
		cfg.CacheTTLSec = 0
	} else if cfg.CacheTTLSec > 3600 {
		cfg.CacheTTLSec = 3600
	}
	return cfg
}

func ValidateWebSearchConfig(cfg WebSearchConfig) error {
	if cfg.UnitPrice < 0 || math.IsNaN(cfg.UnitPrice) || math.IsInf(cfg.UnitPrice, 0) {
		return errors.New("智能搜索单次费用必须是大于或等于 0 的有效数字")
	}
	switch cfg.Provider {
	case "exa":
		if cfg.Enabled && cfg.ExaAPIKey == "" {
			return errors.New("启用 Exa 前请填写 Exa API Key")
		}
	case "tavily", "brave":
		if cfg.Enabled && cfg.APIKey == "" {
			return errors.New("启用联网搜索前请填写搜索服务 API Key")
		}
	case "hybrid":
		if cfg.Enabled && (cfg.APIKey == "" || cfg.BaseURL == "") {
			return errors.New("启用混合搜索前请同时填写 Tavily API Key 和 SearXNG 服务地址")
		}
		if cfg.BaseURL != "" {
			if _, err := searchEndpoint(cfg.BaseURL, "/search"); err != nil {
				return errors.New("SearXNG 服务地址必须是有效的 HTTP/HTTPS 地址")
			}
		}
	case "searxng":
		if cfg.Enabled && cfg.BaseURL == "" {
			return errors.New("启用 SearXNG 前请填写服务地址")
		}
		if cfg.BaseURL != "" {
			if _, err := searchEndpoint(cfg.BaseURL, "/search"); err != nil {
				return errors.New("SearXNG 服务地址必须是有效的 HTTP/HTTPS 地址")
			}
		}
	case "redfox":
		if cfg.Enabled && cfg.RedFoxAPIKey == "" {
			return errors.New("启用 RedFox 联网搜索前请填写 RedFox API Key")
		}
		if cfg.RedFoxBaseURL != "" {
			if _, err := redFoxEndpoint(cfg.RedFoxBaseURL, "/story/api/dyData/searchUser"); err != nil {
				return errors.New("RedFox 服务地址必须是有效的 HTTP/HTTPS 地址")
			}
		}
	default:
		return errors.New("联网搜索服务商参数错误")
	}
	return nil
}

func SearchWeb(ctx context.Context, cfg WebSearchConfig, query string) ([]WebSearchResult, error) {
	return SearchWebWithOptions(ctx, cfg, WebSearchRequest{Query: query})
}

func SearchWebWithOptions(ctx context.Context, cfg WebSearchConfig, input WebSearchRequest) ([]WebSearchResult, error) {
	input = normalizeWebSearchRequest(input)
	if !cfg.Enabled {
		return nil, errors.New("联网搜索尚未启用")
	}
	if input.Query == "" {
		return nil, errors.New("搜索关键词不能为空")
	}
	if err := ValidateWebSearchConfig(cfg); err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: time.Duration(cfg.TimeoutSec) * time.Second}
	var results []WebSearchResult
	var err error
	switch cfg.Provider {
	case "exa":
		results, err = searchExa(ctx, client, cfg, input)
	case "tavily":
		results, err = searchTavily(ctx, client, cfg, input)
	case "brave":
		results, err = searchBrave(ctx, client, cfg, input)
	case "searxng":
		results, err = searchSearXNG(ctx, client, cfg, input)
	case "redfox":
		results, err = searchRedFox(ctx, client, cfg, input)
		results = cleanWebSearchResults(results, cfg.MaxResults, input)
		// RedFox is a social-data provider, so unsupported or empty queries fall
		// through to normal web search rather than being reported as an outage.
		if (err != nil || len(results) == 0) && strings.TrimSpace(cfg.BaseURL) != "" {
			fallbackCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			fallbackClient := &http.Client{Timeout: 5 * time.Second}
			fallbackResults, fallbackErr := searchSearXNG(fallbackCtx, fallbackClient, cfg, input)
			cancel()
			fallbackResults = cleanWebSearchResults(fallbackResults, cfg.MaxResults, input)
			if fallbackErr == nil && len(fallbackResults) > 0 {
				results, err = fallbackResults, nil
			}
		}
		if (err != nil || len(results) == 0) && strings.TrimSpace(cfg.APIKey) != "" {
			results, err = searchTavily(ctx, client, cfg, input)
		}
	case "hybrid":
		// Self-hosted search is the free first choice, but it must never hold the
		// whole Agent request hostage when public engines are slow or blocked.
		searxCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		searxClient := &http.Client{Timeout: 3 * time.Second}
		results, err = searchSearXNG(searxCtx, searxClient, cfg, input)
		cancel()
		if err == nil {
			results = cleanWebSearchResults(results, cfg.MaxResults, input)
		}
		if err != nil || len(results) == 0 {
			results, err = searchTavily(ctx, client, cfg, input)
		}
	}
	if err != nil {
		return nil, err
	}
	results = cleanWebSearchResults(results, cfg.MaxResults, input)
	if len(results) == 0 {
		return nil, ErrWebSearchNoResults
	}
	return results, nil
}

func searchExa(ctx context.Context, client *http.Client, cfg WebSearchConfig, input WebSearchRequest) ([]WebSearchResult, error) {
	payloadBody := map[string]interface{}{
		"query": input.Query, "type": "auto", "numResults": cfg.MaxResults,
		"moderation": true,
		"contents":   map[string]interface{}{"highlights": map[string]interface{}{"maxCharacters": 1200}},
	}
	if input.Topic == "news" {
		payloadBody["category"] = "news"
	}
	// Finance questions include prices and exchange rates, not just reports;
	// leave category unrestricted instead of forcing "financial report".
	if days := map[string]int{"day": 1, "week": 7, "month": 30, "year": 365}[input.TimeRange]; days > 0 {
		payloadBody["startPublishedDate"] = time.Now().UTC().AddDate(0, 0, -days).Format(time.RFC3339)
	}
	if len(input.IncludeDomains) > 0 {
		payloadBody["includeDomains"] = input.IncludeDomains
	}
	body, err := json.Marshal(payloadBody)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, exaSearchURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-api-key", cfg.ExaAPIKey)
	var payload struct {
		Results []struct {
			Title         string   `json:"title"`
			URL           string   `json:"url"`
			Text          string   `json:"text"`
			Highlights    []string `json:"highlights"`
			PublishedDate string   `json:"publishedDate"`
			Score         float64  `json:"score"`
		} `json:"results"`
	}
	if err := doSearchRequest(client, req, &payload); err != nil {
		return nil, fmt.Errorf("Exa: %w", err)
	}
	results := make([]WebSearchResult, 0, len(payload.Results))
	for _, item := range payload.Results {
		results = append(results, WebSearchResult{
			Title: item.Title, URL: item.URL,
			Snippet:       firstNonEmptyWebSearchString(strings.Join(item.Highlights, "\n"), item.Text),
			PublishedDate: item.PublishedDate, Score: item.Score, Provider: "exa",
		})
	}
	return results, nil
}

func searchRedFox(ctx context.Context, client *http.Client, cfg WebSearchConfig, input WebSearchRequest) ([]WebSearchResult, error) {
	baseURL := cfg.RedFoxBaseURL
	if baseURL == "" {
		baseURL = defaultRedFoxBaseURL
	}
	if !regexp.MustCompile(`(?i)抖音|douyin`).MatchString(input.Query) {
		return nil, fmt.Errorf("%w: RedFox 当前配置仅用于抖音数据搜索", ErrWebSearchNoResults)
	}
	path := "/story/api/dyData/searchArticle"
	if regexp.MustCompile(`(?i)账号|用户|博主|达人|作者|粉丝|account|creator|user`).MatchString(input.Query) {
		path = "/story/api/dyData/searchUser"
	}
	var payload map[string]interface{}
	body := map[string]interface{}{"keyword": redFoxSearchKeyword(input.Query), "offset": 0, "sortType": "default"}
	if err := redFoxPost(ctx, client, baseURL, cfg.RedFoxAPIKey, path, body, &payload); err != nil {
		return nil, err
	}
	results := redFoxWebResults(payload)
	if len(results) == 0 {
		return nil, fmt.Errorf("%w: RedFox 抖音数据接口未返回匹配结果", ErrWebSearchNoResults)
	}
	return results, nil
}

func redFoxSearchKeyword(query string) string {
	keyword := regexp.MustCompile(`(?i)https?://\S+|\btop\s*\d+\b|\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?`).ReplaceAllString(query, " ")
	keyword = regexp.MustCompile(`(?i)麻烦(?:你)?|请(?:你)?|能否|可以|帮我|给我|替我|为我|整理|列出|列一下|搜索|查找|查一下|看看|告诉我|今天|今日|当前|现在|抖音|douyin|账号|用户|博主|达人|作者|粉丝|视频|作品|热门|热搜|热点|排行|排行榜|榜单|有哪些|关于|的`).ReplaceAllString(keyword, " ")
	keyword = strings.TrimSpace(regexp.MustCompile(`[，。！？、,:;；\s]+`).ReplaceAllString(keyword, " "))
	if keyword == "" {
		return "热门"
	}
	if runes := []rune(keyword); len(runes) > 40 {
		keyword = string(runes[:40])
	}
	return keyword
}

func redFoxEndpoint(baseURL, path string) (*url.URL, error) {
	endpoint, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.User != nil {
		return nil, errors.New("invalid RedFox service URL")
	}
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + path
	endpoint.RawQuery = ""
	endpoint.Fragment = ""
	return endpoint, nil
}

func redFoxPost(ctx context.Context, client *http.Client, baseURL, apiKey, path string, bodyValue interface{}, target interface{}) error {
	endpoint, err := redFoxEndpoint(baseURL, path)
	if err != nil {
		return err
	}
	body, err := json.Marshal(bodyValue)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("REDFOX_API_KEY", apiKey)
	var envelope map[string]json.RawMessage
	if err := doSearchRequest(client, req, &envelope); err != nil {
		return err
	}
	if raw := envelope["code"]; len(raw) > 0 {
		var code int
		if json.Unmarshal(raw, &code) != nil {
			var text string
			_ = json.Unmarshal(raw, &text)
			code, _ = strconv.Atoi(text)
		}
		if code != 0 && code != 2000 {
			message := redFoxRawString(envelope["msg"])
			if message == "" {
				message = redFoxRawString(envelope["message"])
			}
			if message == "" {
				message = "未知错误"
			}
			return fmt.Errorf("RedFox API 返回错误 %d: %s", code, message)
		}
	}
	raw := envelope["data"]
	if len(raw) == 0 || string(raw) == "null" {
		raw, _ = json.Marshal(envelope)
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return fmt.Errorf("RedFox API 响应解析失败: %w", err)
	}
	return nil
}

func redFoxRawString(raw json.RawMessage) string {
	var value string
	_ = json.Unmarshal(raw, &value)
	return strings.TrimSpace(value)
}

func redFoxMapValue(payload map[string]interface{}, keys ...string) interface{} {
	for _, key := range keys {
		if value, ok := payload[key]; ok {
			return value
		}
	}
	for _, container := range []string{"result", "data"} {
		if nested, ok := payload[container].(map[string]interface{}); ok {
			if value := redFoxMapValue(nested, keys...); value != nil {
				return value
			}
		}
	}
	return nil
}

func redFoxScalar(value interface{}) string {
	switch item := value.(type) {
	case string:
		return strings.TrimSpace(item)
	case json.Number:
		return item.String()
	case float64:
		return strconv.FormatFloat(item, 'f', -1, 64)
	case int:
		return strconv.Itoa(item)
	default:
		return ""
	}
}

func redFoxWebResults(payload map[string]interface{}) []WebSearchResult {
	results := make([]WebSearchResult, 0)
	seen := make(map[string]bool)
	var visit func(interface{}, bool)
	visit = func(value interface{}, resultCollection bool) {
		switch item := value.(type) {
		case []interface{}:
			for _, child := range item {
				visit(child, resultCollection)
			}
		case map[string]interface{}:
			if resultCollection {
				nickname := redFoxScalar(redFoxMapValue(item, "nickname", "accountName", "displayName"))
				result := WebSearchResult{
					Title:         firstNonEmptyWebSearchString(redFoxScalar(redFoxMapValue(item, "title", "name", "siteName", "noteTitle")), nickname),
					URL:           redFoxScalar(redFoxMapValue(item, "url", "link", "href", "workUrl", "opusUrl", "articleUrl", "sourceUrl", "noteUrl")),
					Snippet:       redFoxScalar(redFoxMapValue(item, "snippet", "summary", "content", "description", "text")),
					PublishedDate: redFoxScalar(redFoxMapValue(item, "publishedDate", "published_date", "publishTime", "releaseTime", "crawlTime", "lastCreateTime", "date", "time")),
					Provider:      "redfox",
				}
				if result.URL == "" && nickname != "" {
					result.URL = "https://www.douyin.com/search/" + url.PathEscape(nickname) + "?type=user"
					result.Snippet = strings.Join([]string{
						"账号：" + nickname,
						"简介：" + redFoxScalar(redFoxMapValue(item, "signature", "bio")),
						"粉丝数：" + redFoxScalar(redFoxMapValue(item, "followerCount", "fansCount")),
						"获赞数：" + redFoxScalar(redFoxMapValue(item, "totalFavorited", "totalLikes")),
						"作品数：" + redFoxScalar(redFoxMapValue(item, "awemeCount", "videoCount")),
					}, "；")
				}
				if score, ok := redFoxMapValue(item, "score", "relevance").(float64); ok {
					result.Score = score
				}
				if result.URL != "" && !seen[result.URL] {
					seen[result.URL] = true
					results = append(results, result)
				}
			}
			for key, child := range item {
				switch key {
				case "webPages", "web_pages", "sources", "references", "searchGuid", "search_guid", "list", "workList":
					visit(child, true)
				case "result", "data", "search_result", "searchResult":
					visit(child, resultCollection)
				}
			}
		case string:
			candidate := strings.TrimSpace(item)
			if resultCollection && (strings.HasPrefix(candidate, "https://") || strings.HasPrefix(candidate, "http://")) && !seen[candidate] {
				seen[candidate] = true
				results = append(results, WebSearchResult{Title: candidate, URL: candidate, Provider: "redfox"})
			}
		}
	}
	visit(payload, false)
	return results
}

func firstNonEmptyWebSearchString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func searchTavily(ctx context.Context, client *http.Client, cfg WebSearchConfig, input WebSearchRequest) ([]WebSearchResult, error) {
	payloadBody := map[string]interface{}{
		"query": input.Query, "search_depth": cfg.SearchDepth, "max_results": cfg.MaxResults,
		"include_answer": false, "include_raw_content": false, "topic": input.Topic,
	}
	if input.TimeRange != "" {
		payloadBody["time_range"] = input.TimeRange
	}
	if len(input.IncludeDomains) > 0 {
		payloadBody["include_domains"] = input.IncludeDomains
	}
	body, _ := json.Marshal(payloadBody)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tavilySearchURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	var payload struct {
		Results []struct {
			Title         string  `json:"title"`
			URL           string  `json:"url"`
			Content       string  `json:"content"`
			Score         float64 `json:"score"`
			PublishedDate string  `json:"published_date"`
		} `json:"results"`
	}
	if err := doSearchRequest(client, req, &payload); err != nil {
		return nil, err
	}
	results := make([]WebSearchResult, 0, len(payload.Results))
	for _, item := range payload.Results {
		if item.Score > 0 && item.Score < 0.25 {
			continue
		}
		results = append(results, WebSearchResult{Title: item.Title, URL: item.URL, Snippet: item.Content, PublishedDate: item.PublishedDate, Score: item.Score, Provider: "tavily"})
	}
	return results, nil
}

func searchBrave(ctx context.Context, client *http.Client, cfg WebSearchConfig, input WebSearchRequest) ([]WebSearchResult, error) {
	endpoint, _ := url.Parse("https://api.search.brave.com/res/v1/web/search")
	params := endpoint.Query()
	params.Set("q", searchQueryWithDomains(input))
	params.Set("count", strconv.Itoa(cfg.MaxResults))
	params.Set("text_decorations", "false")
	if input.TimeRange != "" {
		params.Set("freshness", map[string]string{"day": "pd", "week": "pw", "month": "pm", "year": "py"}[input.TimeRange])
	}
	endpoint.RawQuery = params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Subscription-Token", cfg.APIKey)
	var payload struct {
		Web struct {
			Results []struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Description string `json:"description"`
				Age         string `json:"age"`
			} `json:"results"`
		} `json:"web"`
	}
	if err := doSearchRequest(client, req, &payload); err != nil {
		return nil, err
	}
	results := make([]WebSearchResult, 0, len(payload.Web.Results))
	for _, item := range payload.Web.Results {
		results = append(results, WebSearchResult{Title: item.Title, URL: item.URL, Snippet: item.Description, PublishedDate: item.Age, Provider: "brave"})
	}
	return results, nil
}

func searchSearXNG(ctx context.Context, client *http.Client, cfg WebSearchConfig, input WebSearchRequest) ([]WebSearchResult, error) {
	endpoint, err := searchEndpoint(cfg.BaseURL, "/search")
	if err != nil {
		return nil, err
	}
	type searXNGPayload struct {
		UnresponsiveEngines [][]string `json:"unresponsive_engines"`
		Results             []struct {
			Title         string  `json:"title"`
			URL           string  `json:"url"`
			Content       string  `json:"content"`
			Score         float64 `json:"score"`
			PublishedDate string  `json:"publishedDate"`
		} `json:"results"`
	}
	search := func(category, timeRange string) (searXNGPayload, error) {
		requestURL := *endpoint
		params := requestURL.Query()
		params.Set("q", searXNGSearchQuery(input))
		params.Set("format", "json")
		params.Set("language", searchLanguage(input.Query))
		params.Set("safesearch", "1")
		params.Del("categories")
		params.Del("time_range")
		if category != "" {
			params.Set("categories", category)
		}
		if timeRange != "" {
			params.Set("time_range", timeRange)
		}
		requestURL.RawQuery = params.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
		if err != nil {
			return searXNGPayload{}, err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("X-Forwarded-For", "127.0.0.1")
		req.Header.Set("X-Real-IP", "127.0.0.1")
		var payload searXNGPayload
		err = doSearchRequest(client, req, &payload)
		return payload, err
	}
	usableResults := func(payload searXNGPayload) []WebSearchResult {
		results := make([]WebSearchResult, 0, len(payload.Results))
		for _, item := range payload.Results {
			results = append(results, WebSearchResult{Title: item.Title, URL: item.URL, Snippet: item.Content, PublishedDate: item.PublishedDate, Score: item.Score, Provider: "searxng"})
		}
		return cleanWebSearchResults(results, cfg.MaxResults, input)
	}

	category := ""
	if input.Topic == "news" {
		category = "news"
	}
	payload, err := search(category, input.TimeRange)
	if err != nil {
		return nil, err
	}
	if len(usableResults(payload)) == 0 && input.TimeRange != "" {
		payload, err = search(category, "")
	}
	if err == nil && len(usableResults(payload)) == 0 && category != "" {
		payload, err = search("", "")
	}
	if err != nil {
		return nil, err
	}
	results := usableResults(payload)
	if len(results) == 0 && len(payload.UnresponsiveEngines) > 0 {
		failures := make([]string, 0, len(payload.UnresponsiveEngines))
		for _, engine := range payload.UnresponsiveEngines {
			if len(engine) >= 2 {
				failures = append(failures, engine[0]+": "+engine[1])
			}
		}
		return nil, fmt.Errorf("%w: SearXNG 未获得可用结果（%s）；请检查引擎限流、验证码及容器出站网络", ErrWebSearchUnavailable, strings.Join(failures, "; "))
	}
	return results, nil
}

func searchEndpoint(baseURL, path string) (*url.URL, error) {
	endpoint, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.User != nil {
		return nil, errors.New("invalid search service URL")
	}
	if endpoint.Path == "" || endpoint.Path == "/" {
		endpoint.Path = path
	} else if strings.HasSuffix(endpoint.Path, "/") {
		endpoint.Path = strings.TrimRight(endpoint.Path, "/")
		if !strings.HasSuffix(endpoint.Path, path) {
			endpoint.Path += path
		}
	}
	return endpoint, nil
}

func doSearchRequest(client *http.Client, req *http.Request, target interface{}) error {
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("联网搜索请求失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("联网搜索返回 HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(message)))
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(target); err != nil {
		return fmt.Errorf("联网搜索响应解析失败: %w", err)
	}
	return nil
}

func cleanWebSearchResults(items []WebSearchResult, limit int, input WebSearchRequest) []WebSearchResult {
	out := make([]WebSearchResult, 0, limit)
	seen := make(map[string]bool)
	hostCounts := make(map[string]int)
	for _, item := range items {
		item.Title = strings.TrimSpace(item.Title)
		item.URL = strings.TrimSpace(item.URL)
		item.Snippet = strings.TrimSpace(item.Snippet)
		item.PublishedDate = strings.TrimSpace(item.PublishedDate)
		parsed, err := url.Parse(item.URL)
		if err != nil || parsed == nil {
			continue
		}
		host := strings.ToLower(parsed.Hostname())
		hostLimit := 2
		if item.Provider == "redfox" {
			hostLimit = limit
		}
		if host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || seen[item.URL] || hostCounts[host] >= hostLimit ||
			!searchResultMatchesDomains(item.URL, input.IncludeDomains) || unsafeWebSearchResult(host, item.Title, item.Snippet) ||
			!relevantWebSearchResult(input, item) {
			continue
		}
		seen[item.URL] = true
		hostCounts[host]++
		if item.Title == "" {
			item.Title = parsed.Host
		}
		if runes := []rune(item.Snippet); len(runes) > 1200 {
			item.Snippet = string(runes[:1200]) + "…"
		}
		out = append(out, item)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func searchResultMatchesDomains(rawURL string, domains []string) bool {
	if len(domains) == 0 {
		return true
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	for _, domain := range domains {
		domain = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(domain)), "www.")
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

func normalizeWebSearchRequest(input WebSearchRequest) WebSearchRequest {
	input.Query = strings.TrimSpace(input.Query)
	input.Topic = strings.ToLower(strings.TrimSpace(input.Topic))
	if input.Topic != "news" && input.Topic != "finance" {
		input.Topic = "general"
	}
	input.TimeRange = strings.ToLower(strings.TrimSpace(input.TimeRange))
	if input.TimeRange != "day" && input.TimeRange != "week" && input.TimeRange != "month" && input.TimeRange != "year" {
		input.TimeRange = ""
	}
	domains := make([]string, 0, len(input.IncludeDomains))
	seen := make(map[string]bool)
	for _, domain := range input.IncludeDomains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		domain = strings.TrimPrefix(strings.TrimPrefix(domain, "https://"), "http://")
		domain = strings.Trim(domain, "/")
		if domain == "" || strings.ContainsAny(domain, " ?#") || seen[domain] {
			continue
		}
		seen[domain] = true
		domains = append(domains, domain)
		if len(domains) == 8 {
			break
		}
	}
	input.IncludeDomains = domains
	return input
}

func searchQueryWithDomains(input WebSearchRequest) string {
	query := input.Query
	if len(input.IncludeDomains) == 1 {
		return query + " site:" + input.IncludeDomains[0]
	}
	if len(input.IncludeDomains) > 1 {
		parts := make([]string, 0, len(input.IncludeDomains))
		for _, domain := range input.IncludeDomains {
			parts = append(parts, "site:"+domain)
		}
		return query + " (" + strings.Join(parts, " OR ") + ")"
	}
	return query
}

func searXNGSearchQuery(input WebSearchRequest) string {
	// SearXNG aggregates engines with inconsistent support for site: filters.
	// Domain filtering is applied to the returned URLs below.
	query := regexp.MustCompile(`(?i)麻烦(?:你)?|请(?:你)?|能否|可以|帮我|给我|替我|为我|整理一下|整理一份|整一份|搜索一下|搜一下|查一下|查找一下|看一下|看看|告诉我|列出|列一下|汇总一下`).ReplaceAllString(input.Query, " ")
	query = regexp.MustCompile(`(?:的)?前\s*\d+\s*(?:条|个|篇|则)?`).ReplaceAllString(query, " ")
	if input.TimeRange != "" {
		query = regexp.MustCompile(`今天|今日|当前|现在|此时此刻|此时|此刻`).ReplaceAllString(query, " ")
	}
	for _, keyword := range []string{"热搜", "热点", "新闻", "资讯", "科技", "财经", "天气", "气温", "预报", "价格", "股价", "汇率", "比分", "赛程"} {
		query = strings.ReplaceAll(query, keyword, " "+keyword+" ")
	}
	query = strings.Join(strings.Fields(query), " ")
	if query == "" {
		return input.Query
	}
	return query
}

func searchLanguage(query string) string {
	if regexp.MustCompile(`[\p{Han}]`).MatchString(query) {
		return "zh-CN"
	}
	return "en"
}

func unsafeWebSearchResult(host, title, snippet string) bool {
	value := strings.ToLower(host + " " + title + " " + snippet)
	// Some upstream SearXNG/Bing builds can return their engine self-test query
	// instead of the user's query. Treat those healthy-looking HTTP responses as
	// unusable so hybrid search can fall back to the configured managed provider.
	if strings.Contains(value, "test query for encyclopedia backstage") {
		return true
	}
	blockedHosts := []string{"f95zone.", "nhentai.", "pornhub.", "xvideos.", "xnxx.", "redgifs.", "rule34."}
	for _, blocked := range blockedHosts {
		if strings.Contains(value, blocked) {
			return true
		}
	}
	return regexp.MustCompile(`(?i)\b(?:nsfw|hentai|porn|xxx|sex game|adult game)\b|成人视频|色情|成人游戏`).MatchString(value)
}

func relevantWebSearchResult(input WebSearchRequest, item WebSearchResult) bool {
	if len(input.IncludeDomains) > 0 {
		return true
	}
	if item.Provider == "redfox" {
		return true
	}
	signals := searchRelevanceSignals(input.Query)
	if len(signals) == 0 {
		return input.Topic != "news" || trustedNewsResult(item)
	}
	value := strings.ToLower(item.Title + " " + item.Snippet)
	for _, signal := range signals {
		if strings.Contains(value, signal) {
			return true
		}
	}
	return false
}

func trustedNewsResult(item WebSearchResult) bool {
	parsed, err := url.Parse(item.URL)
	if err != nil {
		return false
	}
	host := strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
	trusted := []string{
		"reuters.com", "apnews.com", "bbc.com", "cnn.com", "theguardian.com", "aljazeera.com", "cnbc.com",
		"bloomberg.com", "ft.com", "nytimes.com", "washingtonpost.com", "wsj.com", "dw.com", "yahoo.com",
		"msn.com", "thehindu.com", "indianexpress.com", "news.cn", "xinhuanet.com", "people.com.cn", "cctv.com",
		"chinanews.com.cn", "thepaper.cn", "ifeng.com", "sina.com.cn", "sina.cn", "qq.com", "163.com", "sohu.com",
		"stcn.com", "yicai.com", "caixin.com", "36kr.com", "ithome.com",
	}
	for _, domain := range trusted {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return strings.Contains(host, "news")
}

func searchRelevanceSignals(query string) []string {
	value := strings.ToLower(query)
	value = regexp.MustCompile(`\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\d+`).ReplaceAllString(value, " ")
	noise := []string{
		"帮我", "请问", "整理", "整一份", "列出", "列一下", "看看", "搜索", "查找", "一下",
		"今天", "今日", "当前", "目前", "现在", "此时", "此刻", "最新", "近期", "最近", "热门", "热搜",
		"新闻", "资讯", "热点", "焦点", "头条", "全球", "世界", "国际", "top", "latest", "current",
		"today", "recent", "trending", "breaking", "news", "headline", "global", "world", "august",
		"凤凰网", "凤凰新闻", "新华网", "央视新闻", "人民网", "新浪新闻", "腾讯新闻", "网易新闻",
	}
	for _, word := range noise {
		value = strings.ReplaceAll(value, word, " ")
	}
	value = regexp.MustCompile(`[^\p{Han}a-z0-9]+`).ReplaceAllString(value, " ")
	signals := make([]string, 0)
	seen := make(map[string]bool)
	for _, token := range strings.Fields(value) {
		if regexp.MustCompile(`^[a-z][a-z0-9.+-]*$`).MatchString(token) {
			if len(token) >= 2 && !seen[token] {
				seen[token] = true
				signals = append(signals, token)
			}
			continue
		}
		runes := []rune(token)
		if len(runes) == 1 {
			continue
		}
		for index := 0; index < len(runes)-1; index++ {
			signal := string(runes[index : index+2])
			if !seen[signal] {
				seen[signal] = true
				signals = append(signals, signal)
			}
		}
	}
	return signals
}

func boolConfigValue(value interface{}) bool {
	switch item := value.(type) {
	case bool:
		return item
	case string:
		parsed, _ := strconv.ParseBool(strings.TrimSpace(item))
		return parsed
	default:
		return false
	}
}

func stringConfigValue(value interface{}) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func intConfigValue(value interface{}, fallback int) int {
	switch item := value.(type) {
	case float64:
		return int(item)
	case int:
		return item
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(item)); err == nil {
			return parsed
		}
	}
	return fallback
}

func floatConfigValue(value interface{}) float64 {
	switch item := value.(type) {
	case float64:
		return item
	case float32:
		return float64(item)
	case int:
		return float64(item)
	case int64:
		return float64(item)
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(item), 64)
		return parsed
	default:
		return 0
	}
}
