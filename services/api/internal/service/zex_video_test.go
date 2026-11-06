package service

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestZexNativeNamedSlotsDoNotConflictWithThemselves(t *testing.T) {
	model := &ModelFull{RuntimeRule: map[string]interface{}{
		"upstream": map[string]interface{}{"adapter": "zex_video"},
		"video": map[string]interface{}{"upload_profile": "aliyun_multimodal", "max_reference_images": 9,
			"reference_images": map[string]interface{}{"key": "images", "max": 9},
			"reference_videos": map[string]interface{}{"key": "videos", "max": 9},
			"reference_audios": map[string]interface{}{"key": "audios", "max": 9}},
	}}
	params := map[string]interface{}{"prompt": "test", "generation_mode": "reference", "images": []string{"https://e.test/image.png"}, "videos": []string{"https://e.test/video.mp4"}, "audios": []string{"https://e.test/audio.mp3"}}
	if err := ValidateVideoParams(model, params); err != nil {
		t.Fatalf("configured native field names should not conflict: %v", err)
	}
}

func TestZexSeedanceReferenceLimitMigrationDatabase(t *testing.T) {
	dsn := os.Getenv("MEDIA_BILLING_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set MEDIA_BILLING_TEST_DATABASE_URL for local migration regression")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid test database configuration")
	}
	if cfg.ConnConfig.Host != "localhost" && cfg.ConnConfig.Host != "127.0.0.1" && cfg.ConnConfig.Host != "::1" {
		t.Fatal("test database must be local")
	}
	cfg.MaxConns = 1
	ctx := context.Background()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err = pool.Exec(ctx, `CREATE TEMP TABLE models(id bigserial PRIMARY KEY,new_api_model text,runtime_rule jsonb,price_rule jsonb,updated_at timestamptz)`); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range []struct {
		model, adapter, profile string
		maximum, slot           int
	}{
		{"seedance-2.0", "zex_video", "seedance_2", 9, 1},
		{"seedance-2.0-mini", "zex_video", "aliyun_multimodal", 9, 1},
		{"seedance-2.0", "zex_video", "single_ref", 9, 1},
		{"seedance-2.0", "zex_video", "seedance_2", 4, 1},
		{"seedance-2.0", "zex_video", "seedance_2", 9, 3},
		{"seedance-2.0", "native_media", "seedance_2", 9, 1},
		{"seedance-2.5-10s", "zex_video", "multi_ref", 9, 1},
	} {
		_, err = pool.Exec(ctx, `INSERT INTO models(new_api_model,runtime_rule,price_rule) VALUES($1,jsonb_build_object('upstream',jsonb_build_object('adapter',$2::text),'video',jsonb_build_object('upload_profile',$3::text,'max_reference_images',$4::int,'reference_images',jsonb_build_object('key','images','max',$5::int),'max_reference_total',9,'reference_videos',jsonb_build_object('max',9),'reference_audios',jsonb_build_object('max',9),'frames',jsonb_build_object('first',jsonb_build_object('max',1),'last',jsonb_build_object('max',1)))),'{"billing_type":"per_request","unit_price_by_resolution":{"480p":6,"720p":9}}')`, fixture.model, fixture.adapter, fixture.profile, fixture.maximum, fixture.slot)
		if err != nil {
			t.Fatal(err)
		}
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "infra", "migrations", "142_zex_seedance2_reference_image_limit.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for iteration := 0; iteration < 2; iteration++ {
		tag, err := pool.Exec(ctx, string(migration))
		if err != nil {
			t.Fatal(err)
		}
		want := int64(2)
		if iteration == 1 {
			want = 0
		}
		if tag.RowsAffected() != want {
			t.Fatalf("iteration %d changed %d models, want %d", iteration, tag.RowsAffected(), want)
		}
	}
	rows, err := pool.Query(ctx, `SELECT id,(runtime_rule#>>'{video,reference_images,max}')::int,runtime_rule#>>'{video,reference_images,key}',(runtime_rule#>>'{video,max_reference_total}')::int,(runtime_rule#>>'{video,frames,first,max}')::int,(price_rule#>>'{unit_price_by_resolution,480p}')::int FROM models ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, slot, total, frame, price int
		var key string
		if err := rows.Scan(&id, &slot, &key, &total, &frame, &price); err != nil {
			t.Fatal(err)
		}
		want := []int{9, 9, 1, 1, 3, 1, 1}[id-1]
		if slot != want || key != "images" || total != 9 || frame != 1 || price != 6 {
			t.Fatalf("unexpected settings for fixture %d", id)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
}

func TestZexResolutionMigrationDatabase(t *testing.T) {
	dsn := os.Getenv("MEDIA_BILLING_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set MEDIA_BILLING_TEST_DATABASE_URL for isolated resolution regression")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid test database configuration")
	}
	if cfg.ConnConfig.Host != "localhost" && cfg.ConnConfig.Host != "127.0.0.1" && cfg.ConnConfig.Host != "::1" {
		t.Fatal("test database must be local")
	}
	cfg.MaxConns = 1
	ctx := context.Background()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	_, err = pool.Exec(ctx, `CREATE TEMP TABLE models(id bigserial PRIMARY KEY,new_api_model text,runtime_rule jsonb,input_schema jsonb,default_params jsonb,price_rule jsonb,updated_at timestamptz)`)
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range []struct{ name, adapter, resolution, defaultResolution string }{
		{"grok-imagine-video-1.5", "zex_video", `{"type":"string","title":"分辨率（可选）","default":""}`, ""},
		{"seedance-2.5-10s", "zex_video", `{"type":"string","title":"分辨率（可选）","default":""}`, "720p"},
		{"minimax-h3", "zex_video", `{"type":"string","title":"分辨率（可选）","default":""}`, ""},
		{"minimax-h3-max", "zex_video", `{"type":"string","title":"分辨率（可选）","default":""}`, "768p"},
		{"custom", "zex_video", `{"type":"string","title":"分辨率","enum":["480p","1080p"],"default":"1080p"}`, "1080p"},
		{"native", "native_media", `{"type":"string","title":"分辨率（可选）","default":""}`, ""},
	} {
		_, err = pool.Exec(ctx, `INSERT INTO models(new_api_model,runtime_rule,input_schema,default_params,price_rule) VALUES($1,jsonb_build_object('upstream',jsonb_build_object('adapter',$2::text)),jsonb_build_object('properties',jsonb_build_object('resolution',$3::jsonb)),jsonb_build_object('duration',15,'resolution',$4::text),'{"billing_type":"per_request","unit_price":0,"unit_price_by_duration":{"10":2,"15":3.5,"30":8}}')`, fixture.name, fixture.adapter, fixture.resolution, fixture.defaultResolution)
		if err != nil {
			t.Fatal(err)
		}
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "infra", "migrations", "138_zex_video_resolution_options.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for iteration := 0; iteration < 2; iteration++ {
		if _, err = pool.Exec(ctx, string(migration)); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := pool.Query(ctx, `SELECT new_api_model,runtime_rule,input_schema,default_params,price_rule FROM models ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var runtimeRaw, schemaRaw, defaultRaw, priceRaw []byte
		if err = rows.Scan(&name, &runtimeRaw, &schemaRaw, &defaultRaw, &priceRaw); err != nil {
			t.Fatal(err)
		}
		model := &ModelFull{RequestMode: "video"}
		for _, dest := range []struct {
			raw    []byte
			target *map[string]interface{}
		}{{runtimeRaw, &model.RuntimeRule}, {schemaRaw, &model.InputSchema}, {defaultRaw, &model.DefaultParams}, {priceRaw, &model.PriceRule}} {
			if err = json.Unmarshal(dest.raw, dest.target); err != nil {
				t.Fatal(err)
			}
		}
		if (&ModelService{}).EstimateCost(model, map[string]interface{}{"duration": 15}, 0, 0) != 3.5 || model.DefaultParams["duration"] != float64(15) {
			t.Fatalf("migration changed price/duration: %s", name)
		}
		props := model.InputSchema["properties"].(map[string]interface{})
		resolution := props["resolution"].(map[string]interface{})
		if name == "native" {
			if resolution["enum"] != nil {
				t.Fatal("native model modified")
			}
			continue
		}
		if name == "custom" {
			if model.DefaultParams["resolution"] != "1080p" || len(resolution["enum"].([]interface{})) != 2 {
				t.Fatal("custom resolution configuration modified")
			}
			continue
		}
		wantHigh := "720p"
		if strings.HasPrefix(name, "minimax-") {
			wantHigh = "768p"
		}
		values := resolution["enum"].([]interface{})
		if len(values) != 2 || values[0] != "480p" || values[1] != wantHigh || resolution["x-widget"] != "option_menu" || resolution["default"] != model.DefaultParams["resolution"] {
			t.Fatalf("wrong resolution options/default: %s %#v", name, resolution)
		}
		for _, value := range []string{"480p", wantHigh, "1080p"} {
			for _, normalize := range []func(*ModelFull, map[string]interface{}) error{NormalizeMediaTaskParams, NormalizeMediaEstimateParams} {
				params := map[string]interface{}{"duration": 15, "prompt": "audit", "resolution": value}
				err = normalize(model, params)
				if (err != nil) != (value == "1080p") {
					t.Fatalf("%s resolution %s: %v", name, value, err)
				}
			}
		}
		// Future upstream capabilities are administered through the enum, not code.
		resolution["enum"] = append(values, "1080p")
		if err = NormalizeMediaTaskParams(model, map[string]interface{}{"prompt": "audit", "duration": 15, "resolution": "1080p"}); err != nil {
			t.Fatal(err)
		}
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	_, err = pool.Exec(ctx, `UPDATE models SET
	 runtime_rule=jsonb_set(runtime_rule,'{video}',jsonb_build_object('upload_profile',CASE new_api_model WHEN 'grok-imagine-video-1.5' THEN 'seedance_2' WHEN 'seedance-2.5-10s' THEN 'multi_ref' WHEN 'minimax-h3' THEN 'gateway_reference' ELSE 'seedance_2' END,'max_reference_images',9,'reference_images',jsonb_build_object('max',9),'reference_videos',jsonb_build_object('max',CASE WHEN new_api_model LIKE 'minimax%' THEN 9 ELSE 0 END),'reference_audios',jsonb_build_object('max',CASE WHEN new_api_model LIKE 'minimax%' THEN 9 ELSE 0 END))),
	 input_schema=jsonb_set(input_schema,'{properties,generation_mode}',jsonb_build_object('title','生成模式','type','string','enum',CASE WHEN new_api_model LIKE 'minimax%' THEN '["text","reference"]'::jsonb ELSE '["text","first_frame","first_last","reference"]'::jsonb END)),
	 default_params=default_params || '{"generation_mode":"first_last"}'::jsonb WHERE new_api_model NOT IN ('custom','native')`)
	if err != nil {
		t.Fatal(err)
	}
	uploadMigration, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "infra", "migrations", "139_zex_video_upload_modes.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for iteration := 0; iteration < 2; iteration++ {
		if _, err = pool.Exec(ctx, string(uploadMigration)); err != nil {
			t.Fatal(err)
		}
	}
	for _, tt := range []struct {
		name, profile string
		modes         []string
	}{
		{"grok-imagine-video-1.5", "seedance_2", []string{"text", "first_frame", "first_last", "image"}},
		{"seedance-2.5-10s", "multi_ref", []string{"text", "reference"}},
		{"minimax-h3", "aliyun_multimodal", []string{"text", "reference"}},
		{"minimax-h3-max", "seedance_2", []string{"text", "image", "video", "image_audio", "image_video", "video_audio", "image_video_audio"}},
	} {
		var schemaRaw, runtimeRaw, defaultsRaw, priceRaw []byte
		if err = pool.QueryRow(ctx, `SELECT input_schema,runtime_rule,default_params,price_rule FROM models WHERE new_api_model=$1`, tt.name).Scan(&schemaRaw, &runtimeRaw, &defaultsRaw, &priceRaw); err != nil {
			t.Fatal(err)
		}
		model := &ModelFull{RequestMode: "video"}
		_ = json.Unmarshal(schemaRaw, &model.InputSchema)
		_ = json.Unmarshal(runtimeRaw, &model.RuntimeRule)
		_ = json.Unmarshal(defaultsRaw, &model.DefaultParams)
		_ = json.Unmarshal(priceRaw, &model.PriceRule)
		modeSchema := model.InputSchema["properties"].(map[string]interface{})["generation_mode"].(map[string]interface{})
		got, _ := json.Marshal(modeSchema["enum"])
		want, _ := json.Marshal(tt.modes)
		if string(got) != string(want) || model.RuntimeRule["video"].(map[string]interface{})["upload_profile"] != tt.profile {
			t.Fatalf("%s profile/menu: %s %#v", tt.name, got, model.RuntimeRule)
		}
		if !enumContains(modeSchema["enum"].([]interface{}), model.DefaultParams["generation_mode"]) || (&ModelService{}).EstimateCost(model, map[string]interface{}{"duration": 15}, 0, 0) != 3.5 {
			t.Fatalf("default mode or price changed incorrectly: %s", tt.name)
		}
	}
	// Keep an explicitly customized fixed-resolution menu while correcting the
	// shared 480p/720p preset on the fixed-duration Seedance alias.
	_, err = pool.Exec(ctx, `INSERT INTO models(new_api_model,runtime_rule,input_schema,default_params,price_rule)
	 VALUES('seedance-2.5-15s','{"upstream":{"adapter":"zex_video"}}','{"properties":{"resolution":{"enum":["720p"],"default":"720p"}}}','{"resolution":"720p"}','{}')`)
	if err != nil {
		t.Fatal(err)
	}
	fixedMigration, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "infra", "migrations", "140_zex_seedance25_default_resolution.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for iteration := 0; iteration < 2; iteration++ {
		if _, err = pool.Exec(ctx, string(fixedMigration)); err != nil {
			t.Fatal(err)
		}
	}
	var inputRaw, runtimeRaw, defaultsRaw, priceRaw []byte
	if err = pool.QueryRow(ctx, `SELECT input_schema,runtime_rule,default_params,price_rule FROM models WHERE new_api_model='seedance-2.5-10s'`).Scan(&inputRaw, &runtimeRaw, &defaultsRaw, &priceRaw); err != nil {
		t.Fatal(err)
	}
	model := &ModelFull{RequestMode: "video"}
	_ = json.Unmarshal(inputRaw, &model.InputSchema)
	_ = json.Unmarshal(runtimeRaw, &model.RuntimeRule)
	_ = json.Unmarshal(defaultsRaw, &model.DefaultParams)
	_ = json.Unmarshal(priceRaw, &model.PriceRule)
	if model.DefaultParams["resolution"] != "auto" || model.DefaultParams["generation_mode"] != "text" || model.RuntimeRule["video"].(map[string]interface{})["upload_profile"] != "multi_ref" {
		t.Fatalf("fixed preset changed unrelated settings: %#v %#v", model.DefaultParams, model.RuntimeRule)
	}
	for _, resolution := range []string{"auto", "480p"} {
		params := map[string]interface{}{"prompt": "audit", "duration": 15, "resolution": resolution}
		if err = NormalizeMediaTaskParams(model, params); (err != nil) != (resolution == "480p") {
			t.Fatalf("fixed preset resolution %s: %v", resolution, err)
		}
		if (&ModelService{}).EstimateCost(model, params, 0, 0) != 3.5 {
			t.Fatal("fixed resolution migration changed price")
		}
	}
	var preserved bool
	if err = pool.QueryRow(ctx, `SELECT input_schema#>'{properties,resolution,enum}'='["720p"]'::jsonb AND default_params->>'resolution'='720p' FROM models WHERE new_api_model='seedance-2.5-15s'`).Scan(&preserved); err != nil || !preserved {
		t.Fatalf("custom resolution menu changed: %v", err)
	}
	selectionMigration, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "infra", "migrations", "141_zex_seedance25_resolution_selection.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for iteration := 0; iteration < 2; iteration++ {
		if _, err = pool.Exec(ctx, string(selectionMigration)); err != nil {
			t.Fatal(err)
		}
	}
	var restoredRuntime, restoredPrice []byte
	if err = pool.QueryRow(ctx, `SELECT input_schema,runtime_rule,default_params,price_rule FROM models WHERE new_api_model='seedance-2.5-10s'`).Scan(&inputRaw, &restoredRuntime, &defaultsRaw, &restoredPrice); err != nil {
		t.Fatal(err)
	}
	if string(restoredRuntime) != string(runtimeRaw) || string(restoredPrice) != string(priceRaw) {
		t.Fatal("resolution selection changed routing, media settings or prices")
	}
	_ = json.Unmarshal(inputRaw, &model.InputSchema)
	_ = json.Unmarshal(defaultsRaw, &model.DefaultParams)
	resolutionSchema := model.InputSchema["properties"].(map[string]interface{})["resolution"].(map[string]interface{})
	values := resolutionSchema["enum"].([]interface{})
	if len(values) != 2 || values[0] != "480p" || values[1] != "720p" || resolutionSchema["default"] != "480p" || model.DefaultParams["resolution"] != "480p" || resolutionSchema["enumLabels"] != nil || resolutionSchema["x-omit-auto"] != nil || model.DefaultParams["generation_mode"] != "text" {
		t.Fatalf("wrong restored resolution preset: %#v %#v", resolutionSchema, model.DefaultParams)
	}
	for _, value := range []string{"", "480p", "720p", "auto", "1080p"} {
		for _, normalize := range []func(*ModelFull, map[string]interface{}) error{NormalizeMediaTaskParams, NormalizeMediaEstimateParams} {
			params := map[string]interface{}{"prompt": "audit", "duration": 15}
			if value != "" {
				params["resolution"] = value
			}
			params = MergeMediaTaskParams(model.DefaultParams, params)
			err = normalize(model, params)
			if (err != nil) != (value == "auto" || value == "1080p") {
				t.Fatalf("restored resolution %q: %v", value, err)
			}
			if value == "" && params["resolution"] != "480p" {
				t.Fatal("missing resolution did not default to 480p")
			}
			if err == nil && (&ModelService{}).EstimateCost(model, params, 0, 0) != 3.5 {
				t.Fatal("resolution selection changed the duration price")
			}
		}
	}
	if err = pool.QueryRow(ctx, `SELECT input_schema#>'{properties,resolution,enum}'='["720p"]'::jsonb AND default_params->>'resolution'='720p' FROM models WHERE new_api_model='seedance-2.5-15s'`).Scan(&preserved); err != nil || !preserved {
		t.Fatalf("selection migration changed custom resolution menu: %v", err)
	}
}

func TestSeedance25DurationTierPrices(t *testing.T) {
	prices := map[string]interface{}{"10": 2.0, "15": 3.5, "30": 8.0}
	rule := map[string]interface{}{"billing_type": "per_request", "unit_price": 1.0, "unit_price_by_duration": prices}
	if err := validateModelPriceRule(rule); err != nil {
		t.Fatal(err)
	}
	model := &ModelFull{ModelDTO: ModelDTO{PriceRule: rule, InputSchema: map[string]interface{}{"properties": map[string]interface{}{"duration": map[string]interface{}{"type": "integer", "enum": []interface{}{10, 15, 30}}}}}, RequestMode: "video"}
	costRule := map[string]interface{}{"billing_type": "per_request", "unit_cost": 0.1, "unit_cost_by_duration": map[string]interface{}{"10": 1.0, "15": 2.0, "30": 4.0}}
	if err := validateRouteCostRule(costRule); err != nil {
		t.Fatal(err)
	}
	service := &ModelService{}
	for _, tt := range []struct {
		seconds     int
		price, cost float64
	}{{10, 2, 1}, {15, 3.5, 2}, {30, 8, 4}} {
		params := map[string]interface{}{"duration": tt.seconds}
		if err := NormalizeMediaEstimateParams(model, params); err != nil {
			t.Fatal(err)
		}
		if got := service.EstimateCost(model, params, 0, 0); got != tt.price {
			t.Fatalf("%ds quote=%v want=%v", tt.seconds, got, tt.price)
		}
		// Finite output timing changes and recorded request counts do not change the sale tier.
		params["_actual_output_seconds"], params["_actual_request_count"] = 9.8, 2
		if got := service.EstimateCost(model, params, 0, 0); got != tt.price {
			t.Fatalf("%ds settled=%v want=%v", tt.seconds, got, tt.price)
		}
		if got := EstimateRouteProviderCost(&ModelRoute{CostRule: costRule}, params, 0, 0); got != 2*tt.cost {
			t.Fatalf("%ds cost=%v want=%v", tt.seconds, got, 2*tt.cost)
		}
	}
	if got := service.EstimateCost(&ModelFull{ModelDTO: ModelDTO{PriceRule: map[string]interface{}{"billing_type": "per_request", "unit_price": 0.25}}}, map[string]interface{}{"duration": 30}, 0, 0); got != 0.25 {
		t.Fatalf("legacy price changed: %v", got)
	}
	for _, value := range []interface{}{-1.0, math.NaN(), math.Inf(1), "bad", map[string]interface{}{"nested": 1}} {
		if err := validateModelPriceRule(map[string]interface{}{"billing_type": "per_request", "unit_price": 0, "unit_price_by_duration": map[string]interface{}{"10": value}}); err == nil {
			t.Fatalf("invalid price accepted: %#v", value)
		}
		if err := validateRouteCostRule(map[string]interface{}{"billing_type": "per_request", "unit_cost": 0, "unit_cost_by_duration": map[string]interface{}{"10": value}}); err == nil {
			t.Fatalf("invalid cost accepted: %#v", value)
		}
	}
}

func TestZexSeedance2ResolutionPrices(t *testing.T) {
	// Upstream per-request tiers must never be multiplied by video duration.
	fixed := map[string]interface{}{"billing_type": "per_request", "unit_price": 1.0, "unit_price_by_resolution": map[string]interface{}{"480p": 5.5, "720p": 8.75}}
	for _, seconds := range []int{5, 10, 15} {
		for resolution, price := range fixed["unit_price_by_resolution"].(map[string]interface{}) {
			params := map[string]interface{}{"duration": seconds, "resolution": resolution, "_actual_output_seconds": 9.8, "_actual_request_count": 2}
			if got := (&ModelService{}).EstimateCost(&ModelFull{ModelDTO: ModelDTO{PriceRule: fixed}}, params, 0, 0); got != price {
				t.Fatalf("%s %ds fixed quote=%v", resolution, seconds, got)
			}
			if got := estimateCostFromPriceRule(fixed, params, 0, 0); got != price {
				t.Fatalf("%s fixed agent quote=%v", resolution, got)
			}
			costRule := map[string]interface{}{"billing_type": "per_request", "unit_cost": 1.0, "unit_cost_by_resolution": fixed["unit_price_by_resolution"]}
			if got := EstimateRouteProviderCost(&ModelRoute{CostRule: costRule}, params, 0, 0); got != 2*floatValue(price) {
				t.Fatalf("%s fixed provider cost=%v", resolution, got)
			}
		}
	}
	rule := map[string]interface{}{"billing_type": "per_second", "unit_price": 0.5, "unit_price_by_resolution": map[string]interface{}{"480p": "0.2", "720p": 0.4, "768p": 0.6, "1080p": 0.0}}
	costRule := map[string]interface{}{"billing_type": "per_second", "unit_cost": 0.25, "unit_cost_by_resolution": map[string]interface{}{"480p": 0.1, "720p": "0.3", "768p": 0.35, "1080p": 0.0}}
	if err := validateModelPriceRule(rule); err != nil {
		t.Fatal(err)
	}
	if err := validateRouteCostRule(costRule); err != nil {
		t.Fatal(err)
	}
	model := &ModelFull{ModelDTO: ModelDTO{PriceRule: rule}, RequestMode: "video"}
	for _, tt := range []struct {
		resolution  string
		price, cost float64
	}{{"480p", 0.2, 0.1}, {"720p", 0.4, 0.3}, {"768P", 0.6, 0.35}, {"1080p", 0, 0}, {"4k", 0.5, 0.25}, {"", 0.5, 0.25}} {
		params := map[string]interface{}{"duration": 10, "resolution": tt.resolution, "count": 2}
		if got := (&ModelService{}).EstimateCost(model, params, 0, 0); math.Abs(got-20*tt.price) > 1e-9 {
			t.Fatalf("%s quote=%v", tt.resolution, got)
		}
		if got := estimateCostFromPriceRule(rule, params, 0, 0); math.Abs(got-20*tt.price) > 1e-9 {
			t.Fatalf("%s agent quote=%v", tt.resolution, got)
		}
		if got := EstimateRouteProviderCost(&ModelRoute{CostRule: costRule}, params, 0, 0); math.Abs(got-20*tt.cost) > 1e-9 {
			t.Fatalf("%s estimated provider cost=%v", tt.resolution, got)
		}
		params["_actual_output_seconds"] = 9.8
		if got := (&ModelService{}).EstimateCost(model, params, 0, 0); math.Abs(got-9.8*tt.price) > 1e-9 {
			t.Fatalf("%s actual price=%v", tt.resolution, got)
		}
		if got := EstimateRouteProviderCost(&ModelRoute{CostRule: costRule}, params, 0, 0); math.Abs(got-9.8*tt.cost) > 1e-9 {
			t.Fatalf("%s actual provider cost=%v", tt.resolution, got)
		}
	}
	for _, value := range []interface{}{-1.0, math.NaN(), math.Inf(1), "bad", nil, map[string]interface{}{"nested": 1}} {
		if err := validateModelPriceRule(map[string]interface{}{"billing_type": "per_second", "unit_price": 0, "unit_price_by_resolution": map[string]interface{}{"480p": value}}); err == nil {
			t.Fatalf("invalid resolution price accepted: %#v", value)
		}
		if err := validateRouteCostRule(map[string]interface{}{"billing_type": "per_second", "unit_cost": 0, "unit_cost_by_resolution": map[string]interface{}{"480p": value}}); err == nil {
			t.Fatalf("invalid resolution cost accepted: %#v", value)
		}
	}
	for _, value := range []interface{}{"bad", []interface{}{1}, map[string]interface{}{"720P": 1}, map[string]interface{}{"": 1}} {
		if err := validateModelPriceRule(map[string]interface{}{"billing_type": "per_second", "unit_price": 0, "unit_price_by_resolution": value}); err == nil {
			t.Fatalf("invalid resolution map accepted: %#v", value)
		}
	}
}

func TestZexVideoValidation(t *testing.T) {
	for _, tt := range []struct {
		name                                     string
		modes                                    []interface{}
		images, videos, audios, referenceSeconds int
		durations                                []interface{}
		params                                   map[string]interface{}
		wantMode, wantError                      string
		profile                                  string
	}{
		{name: "text", wantMode: "text"},
		{name: "MiniMax image-audio combination", profile: "aliyun_multimodal", images: 9, audios: 9, modes: []interface{}{"text", "image_audio", "reference"}, params: map[string]interface{}{"generation_mode": "image_audio", "reference_images": []string{"https://e.test/i"}, "reference_audios": []string{"https://e.test/a"}}, wantMode: "image_audio"},
		{name: "MiniMax audio combination", profile: "aliyun_multimodal", audios: 9, modes: []interface{}{"text", "audio", "reference"}, params: map[string]interface{}{"generation_mode": "audio", "reference_audios": []string{"https://e.test/a"}}, wantMode: "audio"},
		{name: "MiniMax missing combination material", profile: "aliyun_multimodal", images: 9, audios: 9, modes: []interface{}{"text", "image_audio", "reference"}, params: map[string]interface{}{"generation_mode": "image_audio", "reference_images": []string{"https://e.test/i"}}, wantError: "素材组合不匹配"},
		{name: "MiniMax unexpected video rejected", profile: "aliyun_multimodal", images: 9, videos: 9, audios: 9, modes: []interface{}{"text", "image_audio", "reference"}, params: map[string]interface{}{"generation_mode": "image_audio", "reference_images": []string{"https://e.test/i"}, "reference_audios": []string{"https://e.test/a"}, "reference_videos": []string{"https://e.test/v"}}, wantError: "素材组合不匹配"},
		{name: "Seedance shape first-last", profile: "seedance_2", images: 4, params: map[string]interface{}{"generation_mode": "first_last", "first_frame": "https://e.test/first", "last_frame": "https://e.test/last"}, wantMode: "first_last"},
		{name: "Seedance shape image-audio", profile: "seedance_2", images: 9, audios: 9, modes: []interface{}{"text", "image_audio"}, params: map[string]interface{}{"generation_mode": "image_audio", "reference_images": []string{"https://e.test/i"}, "reference_audios": []string{"https://e.test/a"}}, wantMode: "image_audio"},
		{name: "Seedance hidden video rejected", profile: "seedance_2", images: 9, videos: 9, audios: 9, modes: []interface{}{"text", "image_audio"}, params: map[string]interface{}{"generation_mode": "image_audio", "reference_images": []string{"https://e.test/i"}, "reference_audios": []string{"https://e.test/a"}, "reference_videos": []string{"https://e.test/v"}}, wantError: "素材组合不匹配"},
		{name: "Seedance infers image combination", profile: "seedance_2", images: 4, modes: []interface{}{"text", "image"}, params: map[string]interface{}{"reference_images": []string{"https://e.test/i"}}, wantMode: "image"},
		{name: "SD reference shape rejects video", profile: "multi_ref", images: 9, videos: 9, params: map[string]interface{}{"generation_mode": "reference", "reference_images": []string{"https://e.test/i"}, "reference_videos": []string{"https://e.test/v"}}, wantError: "当前上传形态"},
		{name: "SD shape accepts configured first-last", profile: "multi_ref", images: 4, params: map[string]interface{}{"generation_mode": "first_last", "first_frame": "https://e.test/f", "last_frame": "https://e.test/l"}, wantMode: "first_last"},
		{name: "custom schema can disable frames", profile: "multi_ref", images: 4, modes: []interface{}{"text", "reference"}, params: map[string]interface{}{"generation_mode": "first_last", "first_frame": "https://e.test/f", "last_frame": "https://e.test/l"}, wantError: "generation_mode"},
		{name: "unsupported native asset", profile: "seedance_2", params: map[string]interface{}{"portrait_asset_id": "asset://native-only"}, wantError: "不支持火山"},
		{name: "combined native aliases", images: 9, videos: 9, audios: 9, params: map[string]interface{}{"images": []string{"https://example.test/i.png"}, "videos": []string{"https://example.test/v.mp4"}, "audios": []string{"https://example.test/a.mp3"}}, wantMode: "reference"},
		{name: "audio reference alone", audios: 9, params: map[string]interface{}{"reference_audios": []string{"https://example.test/a.mp3"}}, wantMode: "reference"},
		{name: "first-last aliases", images: 7, params: map[string]interface{}{"images": []string{"https://example.test/f.png", "https://example.test/l.png"}, "first_last_frame": true}, wantMode: "first_last"},
		{name: "lite rejects reference", images: 1, modes: []interface{}{"text", "first_frame"}, params: map[string]interface{}{"reference_images": []string{"https://example.test/i.png"}}, wantError: "generation_mode"},
		{name: "fast rejects last frame", images: 7, modes: []interface{}{"text", "first_frame", "reference"}, params: map[string]interface{}{"first_frame": "https://example.test/f.png", "last_frame": "https://example.test/l.png"}, wantError: "generation_mode"},
		{name: "fast multi-image too long", images: 7, referenceSeconds: 10, params: map[string]interface{}{"duration": 11, "reference_images": []string{"https://example.test/1.png", "https://example.test/2.png"}}, wantError: "最长支持 10 秒"},
		{name: "fast first frame 15 seconds", images: 7, referenceSeconds: 10, params: map[string]interface{}{"duration": 15, "first_frame": "https://example.test/f.png"}, wantMode: "first_frame"},
		{name: "2.5 rejects video", images: 4, durations: []interface{}{30}, params: map[string]interface{}{"duration": 30, "reference_videos": []string{"https://example.test/v.mp4"}}, wantError: "数量"},
		{name: "2.5 fixed duration", images: 4, durations: []interface{}{30}, params: map[string]interface{}{"duration": "30"}, wantMode: "text"},
		{name: "2.5 wrong duration", images: 4, durations: []interface{}{30}, wantError: "duration"},
		{name: "minimax has no first frame mode", images: 9, modes: []interface{}{"text", "reference"}, params: map[string]interface{}{"first_frame": "https://example.test/f.png"}, wantError: "generation_mode"},
		{name: "total references", images: 9, videos: 9, params: map[string]interface{}{"reference_images": []string{"https://e.test/1", "https://e.test/2", "https://e.test/3", "https://e.test/4", "https://e.test/5"}, "reference_videos": []string{"https://e.test/1", "https://e.test/2", "https://e.test/3", "https://e.test/4", "https://e.test/5"}}, wantError: "数量"},
		{name: "nine combined references allowed", images: 9, videos: 9, audios: 9, params: map[string]interface{}{"reference_images": []string{"https://e.test/1", "https://e.test/2", "https://e.test/3", "https://e.test/4"}, "reference_videos": []string{"https://e.test/5", "https://e.test/6"}, "reference_audios": []string{"https://e.test/7", "https://e.test/8", "https://e.test/9"}}, wantMode: "reference"},
		{name: "ten image audio references rejected", images: 9, audios: 9, profile: "seedance_2", params: map[string]interface{}{"reference_images": []string{"https://e.test/1", "https://e.test/2", "https://e.test/3", "https://e.test/4", "https://e.test/5"}, "reference_audios": []string{"https://e.test/6", "https://e.test/7", "https://e.test/8", "https://e.test/9", "https://e.test/10"}}, wantError: "合计最多 9 项"},
		{name: "mixed frames and refs", images: 7, params: map[string]interface{}{"first_frame": "https://e.test/f", "reference_images": []string{"https://e.test/r"}}, wantError: "不能与参考素材混用"},
		{name: "markdown is not a URL", images: 7, params: map[string]interface{}{"reference_images": []string{"[image](https://e.test/i.png)"}}, wantError: "实际文件直链"},
		{name: "invalid media element", images: 7, params: map[string]interface{}{"reference_images": []interface{}{123}}, wantError: "URL"},
		{name: "local reference video", videos: 9, params: map[string]interface{}{"reference_videos": []string{"http://127.0.0.1:8080/ref.mp4"}}, wantError: "公网直链"},
		{name: "private reference audio", audios: 9, params: map[string]interface{}{"reference_audios": []string{"http://192.168.1.2/a.mp3"}}, wantError: "公网直链"},
		{name: "minio reference video", videos: 9, params: map[string]interface{}{"reference_videos": []string{"http://minio:9000/v.mp4"}}, wantError: "公网直链"},
		{name: "IPv6 loopback audio", audios: 9, params: map[string]interface{}{"reference_audios": []string{"http://[::1]/a.mp3"}}, wantError: "公网直链"},
		{name: "public 172 address allowed", videos: 9, params: map[string]interface{}{"reference_videos": []string{"https://172.67.1.2/v.mp4"}}, wantMode: "reference"},
		{name: "private image converted by worker", images: 9, params: map[string]interface{}{"reference_images": []string{"http://127.0.0.1:8080/i.png"}}, wantMode: "reference"},
		{name: "missing prompt", params: map[string]interface{}{"prompt": " "}, wantError: "提示词"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			modes := tt.modes
			if modes == nil {
				modes = []interface{}{"text", "first_frame", "first_last", "reference"}
			}
			durations := tt.durations
			if durations == nil {
				for i := 4; i <= 15; i++ {
					durations = append(durations, i)
				}
			}
			model := &ModelFull{RequestMode: "video", RuntimeRule: map[string]interface{}{
				"upstream": map[string]interface{}{"adapter": "zex_video"},
				"video": map[string]interface{}{"upload_profile": "gateway_reference", "max_reference_images": tt.images, "max_reference_total": 9, "reference_max_duration": tt.referenceSeconds,
					"reference_videos": map[string]interface{}{"max": tt.videos}, "reference_audios": map[string]interface{}{"max": tt.audios}},
			}, ModelDTO: ModelDTO{InputSchema: map[string]interface{}{"required": []interface{}{"duration"}, "properties": map[string]interface{}{
				"duration": map[string]interface{}{"type": "integer", "enum": durations}, "generation_mode": map[string]interface{}{"type": "string", "enum": modes},
			}}}}
			if tt.profile != "" {
				model.RuntimeRule["video"].(map[string]interface{})["upload_profile"] = tt.profile
			}
			params := map[string]interface{}{"duration": 5, "prompt": "make a video", "generation_mode": "text"}
			for key, value := range tt.params {
				params[key] = value
			}
			err := NormalizeMediaTaskParams(model, params)
			if tt.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantError) {
					t.Fatalf("error=%v, want %s", err, tt.wantError)
				}
			} else if err != nil || params["generation_mode"] != tt.wantMode {
				t.Fatalf("error=%v params=%#v", err, params)
			}
		})
	}
}
