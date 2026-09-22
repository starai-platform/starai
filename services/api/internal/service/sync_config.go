package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strings"

	"github.com/starai/api/internal/util"
)

const SyncModelCode = "video_sync_lipsync"

func syncConfigDefaults() map[string]interface{} {
	return map[string]interface{}{"sync_provider": "sync", "sync_wavespeed_base_url": "https://api.wavespeed.ai", "sync_wavespeed_api_key": "", "sync_wavespeed_unit_price": float64(0), "sync_wavespeed_unit_cost": float64(0), "sync_enabled": false, "sync_base_url": "https://api.sync.so", "sync_api_key": "", "sync_model": "sync-3", "sync_unit_price": float64(0), "sync_unit_cost": float64(0), "sync_timeout_sec": float64(1800)}
}

func lipSyncActiveConfig(values map[string]interface{}) (provider, prefix, model string) {
	provider, _ = values["sync_provider"].(string)
	if provider == "" {
		provider = "sync"
	}
	prefix = "sync_"
	model, _ = values["sync_model"].(string)
	if provider == "wavespeed" {
		prefix = "sync_" + provider + "_"
		model = "wavespeed-ai/latentsync"
	}
	return
}

func validateSyncConfig(values map[string]interface{}) error {
	enabled, ok := values["sync_enabled"].(bool)
	if !ok {
		return fmt.Errorf("Sync 启用状态必须为布尔值")
	}
	provider, prefix, model := lipSyncActiveConfig(values)
	if provider != "sync" && provider != "wavespeed" {
		return fmt.Errorf("不支持的口型同步服务商")
	}
	address, addressOK := values[prefix+"base_url"].(string)
	if !addressOK {
		return fmt.Errorf("口型服务地址必须为字符串")
	}
	u, err := url.Parse(strings.TrimSpace(address))
	if (enabled || strings.TrimSpace(address) != "") && (err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "") {
		return fmt.Errorf("服务地址须为完整 HTTPS 地址，不能包含用户名、查询参数或片段")
	}
	if strings.TrimSpace(model) == "" || len(model) > 128 {
		return fmt.Errorf("请填写有效的 Sync 上游模型名称")
	}
	key, ok := values[prefix+"api_key"].(string)
	if !ok || (enabled && strings.TrimSpace(key) == "") {
		return fmt.Errorf("启用前请填写当前服务商的 API Key ")
	}
	for _, name := range []string{prefix + "unit_price", prefix + "unit_cost", "sync_timeout_sec"} {
		n, ok := values[name].(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 {
			return fmt.Errorf("Sync 价格和超时必须为有效非负数字")
		}
		if name == "sync_timeout_sec" && (n < 60 || n > 7200 || math.Trunc(n) != n) {
			return fmt.Errorf("Sync 超时必须为60–7200整数秒")
		}
	}
	return nil
}

// Save the settings and their dedicated model/route atomically. Secrets use the
// same encryption key as model routes and are masked by GetSystemConfigs.
func (s *ModelService) SaveSyncConfig(ctx context.Context, patch map[string]interface{}) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(2026091401)`); err != nil {
		return err
	}
	values := syncConfigDefaults()
	rows, err := tx.Query(ctx, `SELECT key,value FROM system_configs WHERE key LIKE 'sync_%'`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var key string
		var raw []byte
		if err = rows.Scan(&key, &raw); err != nil {
			rows.Close()
			return err
		}
		var value interface{}
		if err = json.Unmarshal(raw, &value); err != nil {
			rows.Close()
			return err
		}
		values[key] = value
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	for key, value := range patch {
		if !strings.HasPrefix(key, "sync_") {
			continue
		}
		if _, exists := syncConfigDefaults()[key]; !exists {
			return fmt.Errorf("未知 Sync 配置项：%s", key)
		}
		if text, ok := value.(string); strings.HasSuffix(key, "api_key") && ok && isMaskedAdminSecret(text) {
			continue
		}
		values[key] = value
	}
	if err = validateSyncConfig(values); err != nil {
		return err
	}
	provider, prefix, model := lipSyncActiveConfig(values)
	for _, name := range []string{"sync_api_key", "sync_wavespeed_api_key"} {
		raw, ok := values[name].(string)
		if !ok {
			return fmt.Errorf("访问令牌格式无效")
		}
		encrypted, sealErr := util.EncryptSecret(strings.TrimSpace(raw), s.routeCipherKey)
		if sealErr != nil {
			return fmt.Errorf("访问令牌加密失败")
		}
		values[name] = encrypted
	}
	secret := values[prefix+"api_key"].(string)
	address := strings.TrimRight(strings.TrimSpace(values[prefix+"base_url"].(string)), "/")
	values[prefix+"base_url"] = address
	model = strings.TrimSpace(model)
	marshal := func(value interface{}) []byte { data, _ := json.Marshal(value); return data }
	runtime := map[string]interface{}{"lip_sync": map[string]interface{}{"provider": provider, "protocol": "video_audio"}, "video": map[string]interface{}{"upload_profile": "none", "prompt_required": false, "count_options": []int{1}, "count_max": 1}, "upstream": map[string]interface{}{"adapter": "sync_lipsync", "include": []string{"input", "options"}, "async": true, "poll_path": "/v2/generate/{id}", "poll_interval_sec": 5, "poll_timeout_sec": values["sync_timeout_sec"]}}
	endpoint, authType, header := "/v2/generate", "api_key_header", "x-api-key"
	if provider == "wavespeed" {
		endpoint, authType, header = "/api/v3/wavespeed-ai/latentsync", "bearer", ""
		up := runtime["upstream"].(map[string]interface{})
		up["adapter"], up["poll_path"] = "wavespeed_lipsync", "/api/v3/predictions/{id}/result"
	}
	price := map[string]interface{}{"billing_type": "per_second", "unit_price": values[prefix+"unit_price"]}
	cost := map[string]interface{}{"billing_type": "per_second", "unit_cost": values[prefix+"unit_cost"]}
	var modelID int64
	err = tx.QueryRow(ctx, `INSERT INTO models(code,display_name,new_api_model,new_api_endpoint,request_mode,category,input_schema,runtime_rule,price_rule,is_enabled,sort_order)
	 VALUES($1,'人物口型同步',$2,$6,'video','video','{"type":"object","properties":{"input":{"type":"array"},"duration":{"type":"number","minimum":0.1,"maximum":600}},"required":["input","duration"]}'::jsonb,$3,$4,$5,900)
	 ON CONFLICT(code) DO UPDATE SET display_name=EXCLUDED.display_name,new_api_model=EXCLUDED.new_api_model,new_api_endpoint=EXCLUDED.new_api_endpoint,request_mode='video',category='video',input_schema=EXCLUDED.input_schema,runtime_rule=EXCLUDED.runtime_rule,price_rule=EXCLUDED.price_rule,is_enabled=EXCLUDED.is_enabled,updated_at=now() RETURNING id`, SyncModelCode, model, marshal(runtime), marshal(price), values["sync_enabled"], endpoint).Scan(&modelID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO model_routes(model_id,route_name,provider,protocol,upstream_model,endpoint,base_url,api_key,auth_type,api_key_header,runtime_rule,cost_rule,is_enabled,priority,max_retries)
	 VALUES($1,'系统配置 Sync',$8,'openai',$2,$9,$3,$4,$10,$11,$5,$6,$7,0,0)
	 ON CONFLICT(model_id,route_name) DO UPDATE SET provider=EXCLUDED.provider,upstream_model=EXCLUDED.upstream_model,endpoint=EXCLUDED.endpoint,base_url=EXCLUDED.base_url,api_key=EXCLUDED.api_key,auth_type=EXCLUDED.auth_type,api_key_header=EXCLUDED.api_key_header,runtime_rule=EXCLUDED.runtime_rule,cost_rule=EXCLUDED.cost_rule,is_enabled=EXCLUDED.is_enabled,health_status='healthy',consecutive_failures=0,cooldown_until=NULL,updated_at=now()`, modelID, model, address, secret, marshal(runtime), marshal(cost), values["sync_enabled"], provider, endpoint, authType, header)
	if err != nil {
		return err
	}
	// This dedicated model is managed by system settings, not a fallback pool.
	if _, err = tx.Exec(ctx, `UPDATE model_routes SET is_enabled=false,updated_at=now() WHERE model_id=$1 AND route_name<>'系统配置 Sync'`, modelID); err != nil {
		return err
	}
	for key, value := range values {
		if _, err = tx.Exec(ctx, `INSERT INTO system_configs(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, key, marshal(value)); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
