package service

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/util"
)

const (
	routeFailureThreshold = 5
	routeHistoryWindow    = 200
)

// ModelRoute is one independently configurable upstream for a platform model.
// PriceRule on ModelFull remains the user-facing price; CostRule is private
// provider cost metadata used only for margin reporting.
type ModelRoute struct {
	ID                  int64                  `json:"id"`
	ModelID             int64                  `json:"model_id"`
	RouteName           string                 `json:"route_name"`
	Provider            string                 `json:"provider"`
	Protocol            string                 `json:"protocol"`
	UpstreamModel       string                 `json:"upstream_model"`
	Endpoint            string                 `json:"endpoint"`
	BaseURL             string                 `json:"base_url"`
	APIKey              string                 `json:"api_key,omitempty"`
	AuthType            string                 `json:"auth_type"`
	APIKeyHeader        string                 `json:"api_key_header"`
	Headers             map[string]interface{} `json:"headers"`
	ExtraParams         map[string]interface{} `json:"extra_params"`
	RuntimeRule         map[string]interface{} `json:"runtime_rule"`
	CostRule            map[string]interface{} `json:"cost_rule"`
	Priority            int                    `json:"priority"`
	Weight              int                    `json:"weight"`
	TimeoutSeconds      int                    `json:"timeout_seconds"`
	MaxRetries          int                    `json:"max_retries"`
	IsEnabled           bool                   `json:"is_enabled"`
	HealthStatus        string                 `json:"health_status"`
	ConsecutiveFailures int                    `json:"consecutive_failures"`
	SuccessCount        int64                  `json:"success_count"`
	FailureCount        int64                  `json:"failure_count"`
	LastSuccessAt       *time.Time             `json:"last_success_at,omitempty"`
	LastFailureAt       *time.Time             `json:"last_failure_at,omitempty"`
	CooldownUntil       *time.Time             `json:"cooldown_until,omitempty"`
}

type ModelRouteInput struct {
	RouteName      string                 `json:"route_name"`
	Provider       string                 `json:"provider"`
	Protocol       string                 `json:"protocol"`
	UpstreamModel  string                 `json:"upstream_model"`
	Endpoint       string                 `json:"endpoint"`
	BaseURL        string                 `json:"base_url"`
	APIKey         string                 `json:"api_key"`
	AuthType       string                 `json:"auth_type"`
	APIKeyHeader   string                 `json:"api_key_header"`
	Headers        map[string]interface{} `json:"headers"`
	ExtraParams    map[string]interface{} `json:"extra_params"`
	RuntimeRule    map[string]interface{} `json:"runtime_rule"`
	CostRule       map[string]interface{} `json:"cost_rule"`
	Priority       int                    `json:"priority"`
	Weight         int                    `json:"weight"`
	TimeoutSeconds int                    `json:"timeout_seconds"`
	MaxRetries     int                    `json:"max_retries"`
	IsEnabled      bool                   `json:"is_enabled"`
}

type ModelRouteAttempt struct {
	ID           int64   `json:"id"`
	RequestID    string  `json:"request_id"`
	RouteID      *int64  `json:"route_id,omitempty"`
	RouteName    string  `json:"route_name"`
	Attempt      int     `json:"attempt"`
	Status       string  `json:"status"`
	StatusCode   *int    `json:"status_code,omitempty"`
	ErrorCode    *string `json:"error_code,omitempty"`
	LatencyMS    int     `json:"latency_ms"`
	ProviderCost float64 `json:"provider_cost"`
	CreatedAt    string  `json:"created_at"`
}

type ModelRouteProfit struct {
	RouteID      int64   `json:"route_id"`
	RouteName    string  `json:"route_name"`
	RequestCount int64   `json:"request_count"`
	Revenue      float64 `json:"revenue"`
	ProviderCost float64 `json:"provider_cost"`
	GrossProfit  float64 `json:"gross_profit"`
	MarginRate   float64 `json:"margin_rate"`
}

func normalizeModelRouteInput(in *ModelRouteInput) error {
	in.RouteName = strings.TrimSpace(in.RouteName)
	in.Provider = strings.TrimSpace(in.Provider)
	in.Protocol = strings.TrimSpace(strings.ToLower(in.Protocol))
	if in.Protocol == "openai_compatible" || in.Protocol == "new_api" {
		in.Protocol = "openai"
	}
	in.UpstreamModel = strings.TrimSpace(in.UpstreamModel)
	in.Endpoint = normalizeModelEndpoint(in.Endpoint)
	in.BaseURL = strings.TrimRight(strings.TrimSpace(in.BaseURL), "/")
	in.AuthType = strings.TrimSpace(strings.ToLower(in.AuthType))
	in.APIKeyHeader = strings.TrimSpace(in.APIKeyHeader)
	if in.RouteName == "" || in.UpstreamModel == "" || in.BaseURL == "" {
		return errors.New("线路名称、上游模型和 Base URL 不能为空")
	}
	if in.Protocol == "" {
		in.Protocol = "openai"
	}
	if in.AuthType == "" {
		in.AuthType = "bearer"
	}
	if in.APIKeyHeader == "" {
		in.APIKeyHeader = "Authorization"
	}
	if in.Weight < 0 {
		return errors.New("线路权重不能为负数")
	}
	if in.Weight == 0 {
		in.Weight = 100
	}
	if in.TimeoutSeconds <= 0 {
		in.TimeoutSeconds = 120
	}
	if in.MaxRetries < 0 || in.MaxRetries > 3 {
		return errors.New("单线路重试次数必须在 0 到 3 之间")
	}
	if in.Headers == nil {
		in.Headers = map[string]interface{}{}
	}
	if in.ExtraParams == nil {
		in.ExtraParams = map[string]interface{}{}
	}
	if in.RuntimeRule == nil {
		in.RuntimeRule = map[string]interface{}{}
	}
	if in.CostRule == nil {
		in.CostRule = map[string]interface{}{}
	}
	if err := validateRouteCostRule(in.CostRule); err != nil {
		return err
	}
	return nil
}

func defaultModelRouteTimeout(requestMode string) int {
	switch strings.ToLower(strings.TrimSpace(requestMode)) {
	case "images":
		return 600
	default:
		return 120
	}
}

func validateRouteCostRule(rule map[string]interface{}) error {
	if len(rule) == 0 {
		return nil
	}
	billingType := strings.ToLower(strings.TrimSpace(stringValue(rule["billing_type"])))
	if billingType == "" {
		// Compatibility for default routes created before route costs had an
		// explicit billing type. Token cost fields imply per-token accounting.
		for _, key := range []string{"input_cost_per_m", "output_cost_per_m", "cache_read_cost_per_m", "cache_write_cost_per_m"} {
			if _, exists := rule[key]; exists {
				rule["billing_type"] = "per_token"
				billingType = "per_token"
				break
			}
		}
	}
	allowed := map[string]bool{"per_token": true, "per_request": true, "per_image": true, "per_second": true}
	if !allowed[billingType] {
		return errors.New("线路成本计费方式无效")
	}
	for _, key := range []string{"input_cost_per_m", "output_cost_per_m", "cache_read_cost_per_m", "cache_write_cost_per_m", "unit_cost"} {
		if floatValue(rule[key]) < 0 {
			return errors.New("线路成本不能为负数")
		}
	}
	if costs, ok := rule["unit_cost_by_size"].(map[string]interface{}); ok {
		for _, cost := range costs {
			if floatValue(cost) < 0 {
				return errors.New("线路图片档位成本不能为负数")
			}
		}
	}
	return nil
}

func scanModelRoute(row pgx.Row, cipherKey string) (*ModelRoute, error) {
	var route ModelRoute
	var headers, extra, runtimeRule, costRule []byte
	err := row.Scan(&route.ID, &route.ModelID, &route.RouteName, &route.Provider, &route.Protocol,
		&route.UpstreamModel, &route.Endpoint, &route.BaseURL, &route.APIKey, &route.AuthType,
		&route.APIKeyHeader, &headers, &extra, &runtimeRule, &costRule, &route.Priority,
		&route.Weight, &route.TimeoutSeconds, &route.MaxRetries, &route.IsEnabled,
		&route.HealthStatus, &route.ConsecutiveFailures, &route.SuccessCount, &route.FailureCount,
		&route.LastSuccessAt, &route.LastFailureAt, &route.CooldownUntil)
	if err != nil {
		return nil, err
	}
	if route.APIKey != "" {
		decrypted, err := util.DecryptSecret(route.APIKey, cipherKey)
		if err != nil {
			return nil, errors.New("线路密钥解密失败，请检查 MODEL_ROUTE_CIPHER_KEY")
		}
		route.APIKey = decrypted
	}
	_ = json.Unmarshal(headers, &route.Headers)
	_ = json.Unmarshal(extra, &route.ExtraParams)
	_ = json.Unmarshal(runtimeRule, &route.RuntimeRule)
	_ = json.Unmarshal(costRule, &route.CostRule)
	return &route, nil
}

const modelRouteColumns = `id, model_id, route_name, provider, protocol, upstream_model, endpoint,
	base_url, api_key, auth_type, api_key_header, headers, extra_params, runtime_rule, cost_rule,
	priority, weight, timeout_seconds, max_retries, is_enabled, health_status,
	consecutive_failures, success_count, failure_count, last_success_at, last_failure_at, cooldown_until`

func (s *ModelService) ListModelRoutes(ctx context.Context, modelID int64, maskSecrets bool) ([]ModelRoute, error) {
	rows, err := s.db.Query(ctx, `SELECT `+modelRouteColumns+` FROM model_routes WHERE model_id=$1 ORDER BY priority, id`, modelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	routes := []ModelRoute{}
	for rows.Next() {
		route, err := scanModelRoute(rows, s.routeCipherKey)
		if err != nil {
			return nil, err
		}
		if maskSecrets && route.APIKey != "" {
			route.APIKey = maskSecret(route.APIKey)
		}
		routes = append(routes, *route)
	}
	return routes, rows.Err()
}

func (s *ModelService) ListModelRouteAttempts(ctx context.Context, modelID, routeID int64, limit int) ([]ModelRouteAttempt, error) {
	if limit < 1 || limit > 100 {
		limit = 20
	}
	query := `SELECT a.id,a.request_id,a.route_id,COALESCE(r.route_name,'兼容线路'),a.attempt,a.status,a.status_code,a.error_code,a.latency_ms,a.provider_cost,a.created_at
		FROM model_route_attempts a LEFT JOIN model_routes r ON r.id=a.route_id WHERE a.model_id=$1`
	args := []interface{}{modelID}
	if routeID > 0 {
		query += ` AND a.route_id=$2`
		args = append(args, routeID)
	}
	query += ` ORDER BY a.created_at DESC,a.id DESC LIMIT $` + strconv.Itoa(len(args)+1)
	args = append(args, limit)
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ModelRouteAttempt{}
	for rows.Next() {
		var item ModelRouteAttempt
		var created time.Time
		if err := rows.Scan(&item.ID, &item.RequestID, &item.RouteID, &item.RouteName, &item.Attempt, &item.Status, &item.StatusCode, &item.ErrorCode, &item.LatencyMS, &item.ProviderCost, &created); err != nil {
			return nil, err
		}
		item.CreatedAt = created.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *ModelService) ModelRouteProfit(ctx context.Context, modelID int64, days int) ([]ModelRouteProfit, error) {
	if days < 1 || days > 366 {
		days = 30
	}
	rows, err := s.db.Query(ctx, `WITH usage AS (
		SELECT route_id,cost AS revenue,provider_cost FROM ai_call_logs WHERE model_id=$1 AND route_id IS NOT NULL AND status='success' AND created_at>=now()-make_interval(days=>$2)
		UNION ALL
		SELECT route_id,actual_cost AS revenue,provider_cost FROM tasks WHERE model_id=$1 AND route_id IS NOT NULL AND status='succeeded' AND created_at>=now()-make_interval(days=>$2)
	) SELECT r.id,r.route_name,COUNT(u.route_id),COALESCE(SUM(u.revenue),0),COALESCE(SUM(u.provider_cost),0)
		FROM model_routes r LEFT JOIN usage u ON u.route_id=r.id WHERE r.model_id=$1 GROUP BY r.id,r.route_name ORDER BY r.priority,r.id`, modelID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ModelRouteProfit{}
	for rows.Next() {
		var item ModelRouteProfit
		if err := rows.Scan(&item.RouteID, &item.RouteName, &item.RequestCount, &item.Revenue, &item.ProviderCost); err != nil {
			return nil, err
		}
		item.GrossProfit = item.Revenue - item.ProviderCost
		if item.Revenue > 0 {
			item.MarginRate = item.GrossProfit / item.Revenue
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// RuntimeRoutes returns enabled routes in failover order. Routes sharing a
// priority are selected by weight, then retained as fallbacks for this request.
// 熔断降级仅在多条启用线路时生效；单线路模型保持旧的直连行为，
// 不受冷却窗口限制，并自愈残留的熔断状态。
func (s *ModelService) RuntimeRoutes(ctx context.Context, model *ModelFull) ([]ModelRoute, error) {
	rows, err := s.db.Query(ctx, `SELECT `+modelRouteColumns+` FROM model_routes
		WHERE model_id=$1 AND is_enabled=true
		ORDER BY priority, id`, model.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	routes := []ModelRoute{}
	for rows.Next() {
		route, err := scanModelRoute(rows, s.routeCipherKey)
		if err != nil {
			return nil, err
		}
		routes = append(routes, *route)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(routes) == 1 {
		s.healSingleRouteState(ctx, &routes[0])
	} else if len(routes) > 1 {
		now := time.Now()
		active := make([]ModelRoute, 0, len(routes))
		for _, route := range routes {
			if route.CooldownUntil == nil || !route.CooldownUntil.After(now) {
				active = append(active, route)
			}
		}
		if len(active) == 0 {
			return nil, errors.New("all model routes are cooling down")
		}
		routes = active
	}
	for start := 0; start < len(routes); {
		end := start + 1
		for end < len(routes) && routes[end].Priority == routes[start].Priority {
			end++
		}
		weightedRouteOrder(routes[start:end])
		spreadModelRouteFailureDomains(routes[start:end])
		start = end
	}
	return routes, nil
}

// Keep the weighted primary choice, then spread fallbacks across independent
// gateway hosts. Two credentials behind the same Cloudflare/NewAPI host are
// one failure domain and should not be tried back-to-back when another host is
// available at the same priority.
func spreadModelRouteFailureDomains(routes []ModelRoute) {
	seen := map[string]bool{}
	for pos := 0; pos < len(routes); pos++ {
		selected := -1
		for i := pos; i < len(routes); i++ {
			if !seen[modelRouteFailureDomain(routes[i])] {
				selected = i
				break
			}
		}
		if selected < 0 {
			clear(seen)
			selected = pos
		}
		routes[pos], routes[selected] = routes[selected], routes[pos]
		seen[modelRouteFailureDomain(routes[pos])] = true
	}
}

func modelRouteFailureDomain(route ModelRoute) string {
	if parsed, err := url.Parse(strings.TrimSpace(route.BaseURL)); err == nil {
		if host := strings.ToLower(strings.TrimSpace(parsed.Hostname())); host != "" {
			return "host:" + host
		}
	}
	if provider := strings.ToLower(strings.TrimSpace(route.Provider)); provider != "" {
		return "provider:" + provider
	}
	return "route:" + strconv.FormatInt(route.ID, 10)
}

func weightedRouteOrder(routes []ModelRoute) {
	for pos := 0; pos < len(routes)-1; pos++ {
		total := 0
		for i := pos; i < len(routes); i++ {
			total += modelRouteSelectionWeight(routes[i])
		}
		if total <= 0 {
			return
		}
		pick := rand.Intn(total)
		selected := pos
		for i := pos; i < len(routes); i++ {
			pick -= modelRouteSelectionWeight(routes[i])
			if pick < 0 {
				selected = i
				break
			}
		}
		routes[pos], routes[selected] = routes[selected], routes[pos]
	}
}

// Blend the configured weight with observed reliability. A small Bayesian
// prior avoids overreacting to the first few calls while sustained failures
// naturally reduce how often a route is selected as the primary.
func modelRouteSelectionWeight(route ModelRoute) int {
	if route.Weight <= 0 {
		return 0
	}
	effective := int(float64(route.Weight) * (float64(route.SuccessCount) + 9) / (float64(route.SuccessCount) + float64(route.FailureCount) + 10))
	if effective < 1 {
		return 1
	}
	return effective
}

func (r ModelRoute) RequestExtra(model *ModelFull) map[string]interface{} {
	return r.RequestExtraForRequest(model, "")
}

func (r ModelRoute) RequestExtraForRequest(model *ModelFull, requestID string) map[string]interface{} {
	out := mergeModelRouteMaps(model.NewAPIExtraParams, r.ExtraParams)
	delete(out, "connection")
	headers := copyMap(r.Headers)
	if strings.TrimSpace(requestID) != "" {
		if _, exists := headers["Idempotency-Key"]; !exists {
			headers["Idempotency-Key"] = requestID
		}
	}
	connection := map[string]interface{}{
		"base_url": r.BaseURL, "api_key": r.APIKey, "auth_type": r.AuthType,
		"api_key_header": r.APIKeyHeader, "headers": headers, "protocol": r.Protocol,
	}
	out["connection"] = connection
	if strings.HasSuffix(strings.TrimRight(r.Endpoint, "/"), "/responses") || (r.Endpoint == "" && model.RequestMode == "responses") {
		out["request_mode"] = "responses"
	}
	if r.TimeoutSeconds > 0 {
		out["timeout_seconds"] = r.TimeoutSeconds
	}
	return out
}

func mergeModelRouteMaps(base, override map[string]interface{}) map[string]interface{} {
	out := copyMap(base)
	for key, value := range override {
		baseMap, baseOK := out[key].(map[string]interface{})
		overrideMap, overrideOK := value.(map[string]interface{})
		if baseOK && overrideOK {
			out[key] = mergeModelRouteMaps(baseMap, overrideMap)
		} else {
			out[key] = value
		}
	}
	return out
}

func (s *ModelService) CreateModelRoute(ctx context.Context, modelID int64, in ModelRouteInput) (*ModelRoute, error) {
	if err := normalizeModelRouteInput(&in); err != nil {
		return nil, err
	}
	headers, _ := json.Marshal(in.Headers)
	extra, _ := json.Marshal(in.ExtraParams)
	runtimeRule, _ := json.Marshal(in.RuntimeRule)
	costRule, _ := json.Marshal(in.CostRule)
	storedAPIKey, err := util.EncryptSecret(in.APIKey, s.routeCipherKey)
	if err != nil {
		return nil, errors.New("线路密钥加密失败")
	}
	row := s.db.QueryRow(ctx, `INSERT INTO model_routes
		(model_id,route_name,provider,protocol,upstream_model,endpoint,base_url,api_key,auth_type,api_key_header,headers,extra_params,runtime_rule,cost_rule,priority,weight,timeout_seconds,max_retries,is_enabled)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING `+modelRouteColumns,
		modelID, in.RouteName, in.Provider, in.Protocol, in.UpstreamModel, in.Endpoint, in.BaseURL, storedAPIKey, in.AuthType, in.APIKeyHeader, headers, extra, runtimeRule, costRule, in.Priority, in.Weight, in.TimeoutSeconds, in.MaxRetries, in.IsEnabled)
	route, err := scanModelRoute(row, s.routeCipherKey)
	if err != nil {
		return nil, err
	}
	if err := s.syncModelFromPrimaryRoute(ctx, modelID, route); err != nil {
		return nil, err
	}
	return route, nil
}

func (s *ModelService) EnsureDefaultModelRoute(ctx context.Context, modelID int64, modelInput CreateModelInput) error {
	var count int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM model_routes WHERE model_id=$1`, modelID).Scan(&count); err != nil || count > 0 {
		return err
	}
	connection, _ := modelInput.NewAPIExtraParams["connection"].(map[string]interface{})
	baseURL := strings.TrimSpace(stringValue(connection["base_url"]))
	if baseURL == "" || modelInput.Category == "multi_collab" {
		return nil
	}
	headers := mapValue(connection["headers"])
	routeName := strings.TrimSpace(modelInput.DisplayName)
	if routeName == "" {
		routeName = strings.TrimSpace(modelInput.Code)
	}
	if routeName == "" {
		routeName = "默认"
	}
	_, err := s.CreateModelRoute(ctx, modelID, ModelRouteInput{
		RouteName: routeName + " · 主线路", Provider: stringValue(connection["provider"]), Protocol: stringValue(connection["protocol"]),
		UpstreamModel: modelInput.NewAPIModel, Endpoint: modelInput.NewAPIEndpoint, BaseURL: baseURL,
		APIKey: stringValue(connection["api_key"]), AuthType: stringValue(connection["auth_type"]), APIKeyHeader: stringValue(connection["api_key_header"]),
		Headers: headers, ExtraParams: map[string]interface{}{}, RuntimeRule: map[string]interface{}{}, CostRule: defaultRouteCostRule(modelInput.PriceRule), Priority: 100, Weight: 100, TimeoutSeconds: defaultModelRouteTimeout(modelInput.RequestMode), IsEnabled: modelInput.IsEnabled,
	})
	return err
}

func defaultRouteCostRule(priceRule map[string]interface{}) map[string]interface{} {
	billingType := strings.ToLower(strings.TrimSpace(stringValue(priceRule["billing_type"])))
	switch billingType {
	case "per_request", "per_image", "per_second":
		return map[string]interface{}{"billing_type": billingType, "unit_cost": float64(0)}
	default:
		return map[string]interface{}{"billing_type": "per_token", "input_cost_per_m": float64(0), "output_cost_per_m": float64(0)}
	}
}

// SyncPrimaryModelRoute keeps the legacy/basic model connection fields aligned
// with the primary route. Arbitrary advanced JSON and the user-facing price_rule
// deliberately remain model-owned and are never copied into route cost settings.
func (s *ModelService) SyncPrimaryModelRoute(ctx context.Context, modelID int64, modelInput CreateModelInput) error {
	var routeID int64
	var existingStoredKey string
	err := s.db.QueryRow(ctx, `SELECT id,api_key FROM model_routes WHERE model_id=$1 ORDER BY priority,id LIMIT 1`, modelID).Scan(&routeID, &existingStoredKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.EnsureDefaultModelRoute(ctx, modelID, modelInput)
	}
	if err != nil {
		return err
	}
	connection, _ := modelInput.NewAPIExtraParams["connection"].(map[string]interface{})
	if connection == nil || strings.TrimSpace(stringValue(connection["base_url"])) == "" || modelInput.Category == "multi_collab" {
		return nil
	}
	apiKey := stringValue(connection["api_key"])
	if apiKey == "" || isMaskedSecret(apiKey) {
		apiKey = existingStoredKey
	}
	storedAPIKey, err := util.EncryptSecret(apiKey, s.routeCipherKey)
	if err != nil {
		return errors.New("线路密钥加密失败")
	}
	protocol := strings.ToLower(strings.TrimSpace(stringValue(connection["protocol"])))
	if protocol == "" || protocol == "openai_compatible" || protocol == "new_api" {
		protocol = "openai"
	}
	provider := strings.TrimSpace(stringValue(connection["provider"]))
	headers, _ := json.Marshal(mapValue(connection["headers"]))
	_, err = s.db.Exec(ctx, `UPDATE model_routes SET
		provider=CASE WHEN $1='' THEN provider ELSE $1 END,protocol=$2,upstream_model=$3,endpoint=$4,
		base_url=$5,api_key=$6,auth_type=$7,api_key_header=$8,headers=$9,updated_at=now() WHERE id=$10`,
		provider, protocol, strings.TrimSpace(modelInput.NewAPIModel), normalizeModelEndpoint(modelInput.NewAPIEndpoint),
		strings.TrimRight(strings.TrimSpace(stringValue(connection["base_url"])), "/"), storedAPIKey,
		firstNonEmptyService(strings.ToLower(strings.TrimSpace(stringValue(connection["auth_type"]))), "bearer"),
		firstNonEmptyService(strings.TrimSpace(stringValue(connection["api_key_header"])), "Authorization"), headers, routeID)
	return err
}

func (s *ModelService) UpdateModelRoute(ctx context.Context, modelID, routeID int64, in ModelRouteInput) (*ModelRoute, error) {
	if err := normalizeModelRouteInput(&in); err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.APIKey) == "" || isMaskedSecret(in.APIKey) {
		_ = s.db.QueryRow(ctx, `SELECT api_key FROM model_routes WHERE id=$1 AND model_id=$2`, routeID, modelID).Scan(&in.APIKey)
	}
	storedAPIKey, err := util.EncryptSecret(in.APIKey, s.routeCipherKey)
	if err != nil {
		return nil, errors.New("线路密钥加密失败")
	}
	headers, _ := json.Marshal(in.Headers)
	extra, _ := json.Marshal(in.ExtraParams)
	runtimeRule, _ := json.Marshal(in.RuntimeRule)
	costRule, _ := json.Marshal(in.CostRule)
	row := s.db.QueryRow(ctx, `UPDATE model_routes SET route_name=$1,provider=$2,protocol=$3,upstream_model=$4,endpoint=$5,base_url=$6,api_key=$7,auth_type=$8,api_key_header=$9,headers=$10,extra_params=$11,runtime_rule=$12,cost_rule=$13,priority=$14,weight=$15,timeout_seconds=$16,max_retries=$17,is_enabled=$18,updated_at=now()
		WHERE id=$19 AND model_id=$20 RETURNING `+modelRouteColumns,
		in.RouteName, in.Provider, in.Protocol, in.UpstreamModel, in.Endpoint, in.BaseURL, storedAPIKey, in.AuthType, in.APIKeyHeader, headers, extra, runtimeRule, costRule, in.Priority, in.Weight, in.TimeoutSeconds, in.MaxRetries, in.IsEnabled, routeID, modelID)
	route, err := scanModelRoute(row, s.routeCipherKey)
	if err != nil {
		return nil, err
	}
	if err := s.syncModelFromPrimaryRoute(ctx, modelID, route); err != nil {
		return nil, err
	}
	return route, nil
}

func (s *ModelService) SetModelRouteEnabled(ctx context.Context, modelID, routeID int64, enabled bool) (*ModelRoute, error) {
	row := s.db.QueryRow(ctx, `UPDATE model_routes SET is_enabled=$1,updated_at=now() WHERE id=$2 AND model_id=$3 RETURNING `+modelRouteColumns, enabled, routeID, modelID)
	route, err := scanModelRoute(row, s.routeCipherKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("线路不存在")
	}
	return route, err
}

func (s *ModelService) syncModelFromPrimaryRoute(ctx context.Context, modelID int64, route *ModelRoute) error {
	var primary *ModelRoute
	if route != nil {
		var primaryID int64
		if err := s.db.QueryRow(ctx, `SELECT id FROM model_routes WHERE model_id=$1 ORDER BY priority,id LIMIT 1`, modelID).Scan(&primaryID); err != nil {
			return err
		}
		if primaryID == route.ID {
			primary = route
		}
	}
	if primary == nil {
		loaded, err := scanModelRoute(s.db.QueryRow(ctx, `SELECT `+modelRouteColumns+` FROM model_routes WHERE model_id=$1 ORDER BY priority,id LIMIT 1`, modelID), s.routeCipherKey)
		if err != nil {
			return err
		}
		primary = loaded
	}
	protocol := primary.Protocol
	if protocol == "openai" {
		protocol = "openai_compatible"
	}
	storedAPIKey := primary.APIKey
	if !isEnvSecretRef(storedAPIKey) {
		var err error
		storedAPIKey, err = util.EncryptSecret(storedAPIKey, s.routeCipherKey)
		if err != nil {
			return errors.New("模型密钥加密失败")
		}
	}
	connectionPatch, _ := json.Marshal(map[string]interface{}{
		"provider": primary.Provider, "protocol": protocol, "base_url": primary.BaseURL,
		"api_key": storedAPIKey, "auth_type": primary.AuthType, "api_key_header": primary.APIKeyHeader,
	})
	_, err := s.db.Exec(ctx, `UPDATE models SET new_api_model=$1,new_api_endpoint=$2,
		new_api_extra_params=jsonb_set(COALESCE(new_api_extra_params,'{}'::jsonb),'{connection}',COALESCE(new_api_extra_params->'connection','{}'::jsonb)||$3::jsonb,true),updated_at=now()
		WHERE id=$4`, primary.UpstreamModel, primary.Endpoint, connectionPatch, modelID)
	return err
}

func firstNonEmptyService(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (s *ModelService) DeleteModelRoute(ctx context.Context, modelID, routeID int64) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM model_routes WHERE id=$1 AND model_id=$2`, routeID, modelID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("线路不存在")
	}
	var remaining bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM model_routes WHERE model_id=$1)`, modelID).Scan(&remaining); err != nil || !remaining {
		return err
	}
	return s.syncModelFromPrimaryRoute(ctx, modelID, nil)
}

func (s *ModelService) ResetModelRouteHealth(ctx context.Context, modelID, routeID int64) error {
	_, err := s.db.Exec(ctx, `UPDATE model_routes SET health_status='healthy',consecutive_failures=0,cooldown_until=NULL,updated_at=now() WHERE id=$1 AND model_id=$2`, routeID, modelID)
	return err
}

func (s *ModelService) MarkRouteSuccess(ctx context.Context, routeID int64) {
	if routeID <= 0 {
		return
	}
	_, _ = s.db.Exec(ctx, `UPDATE model_routes SET
		health_status='healthy',consecutive_failures=0,
		success_count=CASE WHEN success_count+failure_count >= $2 THEN success_count/2+1 ELSE success_count+1 END,
		failure_count=CASE WHEN success_count+failure_count >= $2 THEN failure_count/2 ELSE failure_count END,
		last_success_at=now(),cooldown_until=NULL,updated_at=now() WHERE id=$1`, routeID, routeHistoryWindow)
}

// AcquireRouteProbe prevents a recovered circuit from receiving a burst of
// concurrent half-open probes. Healthy/degraded routes need no lease.
// 单线路模型没有可切换目标，不走探测限流，直接放行并自愈。
func (s *ModelService) AcquireRouteProbe(ctx context.Context, route *ModelRoute) bool {
	if route == nil || route.ID <= 0 {
		return true
	}
	if route.HealthStatus != "open" && route.HealthStatus != "half_open" {
		return true
	}
	var hasAlternate bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM model_routes WHERE model_id=$1 AND is_enabled=true AND id<>$2)`, route.ModelID, route.ID).Scan(&hasAlternate); err == nil && !hasAlternate {
		s.healSingleRouteState(ctx, route)
		return true
	}
	tag, err := s.db.Exec(ctx, `UPDATE model_routes SET health_status='half_open',cooldown_until=now()+interval '30 seconds',updated_at=now()
		WHERE id=$1 AND health_status IN ('open','half_open') AND (cooldown_until IS NULL OR cooldown_until<=now())`, route.ID)
	return err == nil && tag.RowsAffected() == 1
}

// healSingleRouteState 清除单线路模型残留的熔断/冷却状态，避免无降级可走时自伤。
func (s *ModelService) healSingleRouteState(ctx context.Context, route *ModelRoute) {
	if route == nil || route.ID <= 0 {
		return
	}
	if route.HealthStatus != "open" && route.HealthStatus != "half_open" && route.CooldownUntil == nil {
		return
	}
	_, _ = s.db.Exec(ctx, `UPDATE model_routes SET health_status='healthy',cooldown_until=NULL,updated_at=now() WHERE id=$1`, route.ID)
	route.HealthStatus = "healthy"
	route.CooldownUntil = nil
}

func (s *ModelService) MarkRouteFailure(ctx context.Context, routeID int64) {
	if routeID <= 0 {
		return
	}
	// 熔断降级仅在存在其他启用线路时生效；单线路只累计失败统计，
	// 不进入 open 状态也不设置冷却，保持旧的直连重试行为。
	_, _ = s.db.Exec(ctx, `UPDATE model_routes r SET
		consecutive_failures=r.consecutive_failures+1,
		success_count=CASE WHEN r.success_count+r.failure_count >= $3 THEN r.success_count/2 ELSE r.success_count END,
		failure_count=CASE WHEN r.success_count+r.failure_count >= $3 THEN r.failure_count/2+1 ELSE r.failure_count+1 END,
		health_status=CASE
			WHEN EXISTS(SELECT 1 FROM model_routes p WHERE p.model_id=r.model_id AND p.is_enabled=true AND p.id<>r.id)
				THEN CASE WHEN r.consecutive_failures+1 >= $2 THEN 'open' ELSE 'degraded' END
			ELSE r.health_status END,
		cooldown_until=CASE
			WHEN EXISTS(SELECT 1 FROM model_routes p WHERE p.model_id=r.model_id AND p.is_enabled=true AND p.id<>r.id)
				AND r.consecutive_failures+1 >= $2 THEN now()+interval '60 seconds'
			ELSE r.cooldown_until END,
		last_failure_at=now(),updated_at=now() WHERE r.id=$1`, routeID, routeFailureThreshold, routeHistoryWindow)
}

func (s *ModelService) LogRouteAttempt(ctx context.Context, requestID string, modelID, routeID int64, attempt int, status string, statusCode int, errorCode string, latencyMS int, providerCost float64) {
	var routeRef interface{} = routeID
	if routeID <= 0 {
		routeRef = nil
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO model_route_attempts(request_id,model_id,route_id,attempt,status,status_code,error_code,latency_ms,provider_cost) VALUES($1,$2,$3,$4,$5,NULLIF($6,0),NULLIF($7,''),$8,$9)`, requestID, modelID, routeRef, attempt, status, statusCode, errorCode, latencyMS, providerCost)
}

func (s *ModelService) UpdateSuccessfulRouteAttemptCost(ctx context.Context, requestID string, routeID int64, providerCost float64) {
	if strings.TrimSpace(requestID) == "" || routeID <= 0 || providerCost < 0 {
		return
	}
	_, _ = s.db.Exec(ctx, `UPDATE model_route_attempts SET provider_cost=$1 WHERE id=(
		SELECT id FROM model_route_attempts WHERE request_id=$2 AND route_id=$3 AND status='success' ORDER BY attempt DESC,id DESC LIMIT 1
	)`, providerCost, requestID, routeID)
}

func (s *ModelService) MarkStreamRouteAttemptFailed(ctx context.Context, requestID string, routeID int64, attempt int, err error) {
	status, code := "failed", "STREAM_ERROR"
	var pe *runtime.PlatformError
	if errors.As(err, &pe) {
		code = pe.Code
	}
	if !isRouteFailoverError(err) {
		status = "rejected"
	}
	_, _ = s.db.Exec(ctx, `UPDATE model_route_attempts SET status=$4,error_code=$5
		WHERE id=(SELECT id FROM model_route_attempts WHERE request_id=$1 AND route_id=$2 AND attempt=$3 ORDER BY id DESC LIMIT 1)`, requestID, routeID, attempt, status, code)
}

func (s *ModelService) SuccessfulRouteForRequest(ctx context.Context, requestID string) (*ModelRoute, error) {
	row := s.db.QueryRow(ctx, `SELECT `+modelRouteColumns+` FROM model_routes WHERE id=(
		SELECT route_id FROM model_route_attempts WHERE request_id=$1 AND status='success' AND route_id IS NOT NULL ORDER BY attempt DESC LIMIT 1
	)`, requestID)
	route, err := scanModelRoute(row, s.routeCipherKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return route, err
}

func EstimateRouteProviderCost(route *ModelRoute, params map[string]interface{}, promptTokens, completionTokens int) float64 {
	return EstimateRouteProviderCostWithTokenDetails(route, params, promptTokens, completionTokens, 0, 0)
}

func EstimateRouteProviderCostWithTokenDetails(route *ModelRoute, params map[string]interface{}, promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens int) float64 {
	if route == nil {
		return 0
	}
	rule := route.CostRule
	typeName := strings.ToLower(strings.TrimSpace(stringValue(rule["billing_type"])))
	switch typeName {
	case "per_token":
		input := floatValue(rule["input_cost_per_m"])
		output := floatValue(rule["output_cost_per_m"])
		cacheRead := floatValue(rule["cache_read_cost_per_m"])
		cacheWrite := floatValue(rule["cache_write_cost_per_m"])
		if cacheRead <= 0 {
			cacheRead = input
		}
		if cacheWrite <= 0 {
			cacheWrite = input
		}
		if cacheReadTokens < 0 {
			cacheReadTokens = 0
		}
		if cacheWriteTokens < 0 {
			cacheWriteTokens = 0
		}
		if cacheReadTokens+cacheWriteTokens > promptTokens {
			cacheReadTokens, cacheWriteTokens = 0, 0
		}
		uncached := promptTokens - cacheReadTokens - cacheWriteTokens
		return (float64(uncached)*input + float64(cacheReadTokens)*cacheRead + float64(cacheWriteTokens)*cacheWrite + float64(completionTokens)*output) / 1_000_000
	case "per_image", "per_request":
		count := intFromAny(params["n"], 1)
		if count <= 0 {
			count = intFromAny(params["count"], 1)
		}
		unitCost := floatValue(rule["unit_cost"])
		if typeName == "per_image" {
			unitCost = imageTierPrice(rule, params, "unit_cost_by_size", "unit_cost")
		}
		return float64(count) * unitCost
	case "per_second":
		seconds := floatValue(params["duration"])
		if seconds <= 0 {
			seconds = 1
		}
		return seconds * floatValue(rule["unit_cost"])
	default:
		return floatValue(rule["unit_cost"])
	}
}

func mergeRouteRuntimeRule(modelRule, routeRule map[string]interface{}) map[string]interface{} {
	out := copyMap(modelRule)
	for key, value := range routeRule {
		out[key] = value
	}
	return out
}
