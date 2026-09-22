package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/util"
)

func TestSyncConfigValidation(t *testing.T) {
	values := syncConfigDefaults()
	if err := validateSyncConfig(values); err != nil {
		t.Fatal(err)
	}
	for _, patch := range []map[string]interface{}{
		{"sync_enabled": true}, {"sync_base_url": "http://example.com"}, {"sync_base_url": "https://user:pass@example.com"},
		{"sync_model": ""}, {"sync_unit_price": float64(-1)}, {"sync_timeout_sec": float64(12)}, {"sync_timeout_sec": float64(60.5)},
	} {
		candidate := syncConfigDefaults()
		for key, value := range patch {
			candidate[key] = value
		}
		if err := validateSyncConfig(candidate); err == nil {
			t.Fatalf("invalid patch accepted: %v", patch)
		}
	}
	values["sync_enabled"], values["sync_api_key"] = true, "test-key"
	if err := validateSyncConfig(values); err != nil {
		t.Fatal(err)
	}
	if !isSensitiveConfigKey("sync_api_key") {
		t.Fatal("Sync key must be masked and redacted")
	}
}

func TestCommercialLipSyncConfig(t *testing.T) {
	for _, provider := range []string{"wavespeed"} {
		values := syncConfigDefaults()
		values["sync_provider"] = provider
		values["sync_enabled"] = true
		values["sync_"+provider+"_base_url"] = "https://api.wavespeed.ai"
		values["sync_"+provider+"_api_key"] = "private-module-token"
		if err := validateSyncConfig(values); err != nil {
			t.Fatal(err)
		}
		values["sync_"+provider+"_api_key"] = ""
		if err := validateSyncConfig(values); err == nil {
			t.Fatal("missing active token accepted")
		}
	}
}

func TestSyncConfigDatabase(t *testing.T) {
	dsn := os.Getenv("SYNC_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set SYNC_TEST_DATABASE_URL for isolated schema regression")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("sync_config_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `CREATE TABLE system_configs(key text PRIMARY KEY,value jsonb,updated_at timestamptz);
	CREATE TABLE models(id bigserial PRIMARY KEY,code text UNIQUE,display_name text,new_api_model text,new_api_endpoint text,request_mode text,category text,input_schema jsonb,runtime_rule jsonb,price_rule jsonb,is_enabled boolean,sort_order int,updated_at timestamptz);
	CREATE TABLE model_routes(id bigserial PRIMARY KEY,model_id bigint,route_name text,provider text,protocol text,upstream_model text,endpoint text,base_url text,api_key text,auth_type text,api_key_header text,runtime_rule jsonb,cost_rule jsonb,is_enabled boolean,priority int,max_retries int,health_status text,consecutive_failures int,cooldown_until timestamptz,updated_at timestamptz,UNIQUE(model_id,route_name));`)
	if err != nil {
		t.Fatal(err)
	}
	s := NewModelService(pool, "isolated-test-cipher")
	if err = s.SaveSyncConfig(ctx, map[string]interface{}{"sync_enabled": true, "sync_api_key": "test-secret", "sync_unit_price": float64(0.2)}); err != nil {
		t.Fatal(err)
	}
	var stored string
	if err = pool.QueryRow(ctx, `SELECT value #>> '{}' FROM system_configs WHERE key='sync_api_key'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stored, "enc:v1:") {
		t.Fatal("secret not encrypted")
	}
	adminService := &AdminService{db: pool}
	masked, err := adminService.GetSystemConfigs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if masked["sync_api_key"] == "test-secret" || !isMaskedAdminSecret(masked["sync_api_key"].(string)) {
		t.Fatal("secret leaked")
	}
	if err = s.SaveSyncConfig(ctx, map[string]interface{}{"sync_api_key": masked["sync_api_key"], "sync_unit_price": float64(0.3)}); err != nil {
		t.Fatal(err)
	}
	var routeSecret string
	var price []byte
	if err = pool.QueryRow(ctx, `SELECT api_key FROM model_routes`).Scan(&routeSecret); err != nil {
		t.Fatal(err)
	}
	plain, err := util.DecryptSecret(routeSecret, "isolated-test-cipher")
	if err != nil || plain != "test-secret" {
		t.Fatal("masked save changed key")
	}
	if err = pool.QueryRow(ctx, `SELECT price_rule FROM models`).Scan(&price); err != nil {
		t.Fatal(err)
	}
	var rule map[string]interface{}
	json.Unmarshal(price, &rule)
	if rule["unit_price"] != 0.3 {
		t.Fatal("price not synchronized")
	}
	if err = s.SaveSyncConfig(ctx, map[string]interface{}{"sync_api_key": ""}); err == nil {
		t.Fatal("enabled config accepted missing key")
	}
	if err = s.SaveSyncConfig(ctx, map[string]interface{}{"sync_enabled": false, "sync_api_key": ""}); err != nil {
		t.Fatal(err)
	}
	var enabled bool
	if err = pool.QueryRow(ctx, `SELECT is_enabled FROM models`).Scan(&enabled); err != nil || enabled {
		t.Fatal("model not disabled")
	}
	if err = pool.QueryRow(ctx, `SELECT is_enabled FROM model_routes`).Scan(&enabled); err != nil || enabled {
		t.Fatal("route not disabled")
	}
	for _, provider := range []string{"wavespeed"} {
		prefix := "sync_" + provider + "_"
		if err = s.SaveSyncConfig(ctx, map[string]interface{}{"sync_provider": provider, "sync_enabled": true, prefix + "base_url": "https://api.wavespeed.ai", prefix + "api_key": provider + "-secret"}); err != nil {
			t.Fatal(err)
		}
		var actualProvider, actualModel string
		if err = pool.QueryRow(ctx, `SELECT provider,upstream_model,api_key FROM model_routes`).Scan(&actualProvider, &actualModel, &routeSecret); err != nil {
			t.Fatal(err)
		}
		plain, err = util.DecryptSecret(routeSecret, "isolated-test-cipher")
		if err != nil || plain != provider+"-secret" || actualProvider != provider || actualModel != "wavespeed-ai/latentsync" {
			t.Fatal("provider route not synchronized")
		}
	}
	if err = s.SaveSyncConfig(ctx, map[string]interface{}{"sync_provider": "wavespeed"}); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT api_key FROM model_routes`).Scan(&routeSecret); err != nil {
		t.Fatal(err)
	}
	plain, err = util.DecryptSecret(routeSecret, "isolated-test-cipher")
	if err != nil || plain != "wavespeed-secret" {
		t.Fatal("switch lost provider secret")
	}
	var endpoint, authType, header string
	if err = pool.QueryRow(ctx, `SELECT endpoint,auth_type,api_key_header FROM model_routes`).Scan(&endpoint, &authType, &header); err != nil || endpoint != "/api/v3/wavespeed-ai/latentsync" || authType != "bearer" || header != "" {
		t.Fatal("WaveSpeed connection settings incorrect", err)
	}
	if err = s.SaveSyncConfig(ctx, map[string]interface{}{"sync_provider": "sync", "sync_api_key": "restored-sync-key"}); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT endpoint,auth_type,api_key_header FROM model_routes`).Scan(&endpoint, &authType, &header); err != nil || endpoint != "/v2/generate" || authType != "api_key_header" || header != "x-api-key" {
		t.Fatal("switch to Sync retained WaveSpeed connection", err)
	}
}
