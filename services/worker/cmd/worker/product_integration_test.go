package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/worker/internal/storage"
)

// Empty tables in an isolated schema; never copy accounts, credentials or data.
func productTestDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("PRODUCT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set PRODUCT_TEST_DATABASE_URL for local isolated integration")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid test database configuration")
	}
	if cfg.ConnConfig.Host != "localhost" && cfg.ConnConfig.Host != "127.0.0.1" && cfg.ConnConfig.Host != "::1" {
		t.Fatal("integration database must be local")
	}
	ctx := context.Background()
	admin, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := fmt.Sprintf("product_test_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+quoted+" CASCADE") })
	rows, err := admin.Query(ctx, `SELECT tablename FROM pg_tables WHERE schemaname='public'`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var name string
		_ = rows.Scan(&name)
		tables = append(tables, name)
	}
	rows.Close()
	for _, name := range tables {
		target := pgx.Identifier{schema, name}.Sanitize()
		if _, err = admin.Exec(ctx, "CREATE TABLE "+target+" (LIKE "+pgx.Identifier{"public", name}.Sanitize()+" INCLUDING ALL)"); err != nil {
			t.Fatal(err)
		}
		var serial bool
		_ = admin.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='id' AND column_default LIKE 'nextval%')`, name).Scan(&serial)
		if serial {
			seq := pgx.Identifier{schema, name + "_test_seq"}.Sanitize()
			if _, err = admin.Exec(ctx, "CREATE SEQUENCE "+seq+"; ALTER TABLE "+target+" ALTER COLUMN id SET DEFAULT nextval('"+seq+"')"); err != nil {
				t.Fatal(err)
			}
		}
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestProductWorkflowEndToEnd(t *testing.T) {
	pool := productTestDatabase(t)
	ctx := context.Background()
	// Keep fixture crops above the workflow's 16px minimum after the planner's
	// normalized-coordinate correction.
	base := image.NewNRGBA(image.Rect(0, 0, 128, 128))
	draw.Draw(base, base.Bounds(), image.NewUniform(color.NRGBA{20, 180, 210, 255}), image.Point{}, draw.Src)
	generated := image.NewNRGBA(base.Bounds())
	draw.Draw(generated, generated.Bounds(), image.NewUniform(color.NRGBA{220, 140, 90, 255}), image.Point{}, draw.Src)
	g, _ := productPNG(generated)
	checks := []productCheck{{ID: "strip", Description: "保留商品区域", Reference: 1, Region: productBox{0, 0.5, 1, 0.5}}, {ID: "composition", Description: "上半部增加腿部", Reference: 1, Region: productBox{0, 0, 1, 1}}}
	plan := productPlan{ProductType: "footwear", InteractionMode: "wear", Summary: "上脚与特写", Keep: []string{"商品原始像素"}, Change: []string{"顶部"}, Shots: []productShot{
		{Title: "上脚", Method: "edit", Source: 1, Prompt: "顶部增加腿部", EditRegions: []productBox{{0, 0, 1, 0.5}}, ProtectedRegions: []productBox{{0, 0.5, 1, 0.5}}, Checks: checks},
		{Title: "特写", Method: "crop", Source: 1, Prompt: "原图特写", Crop: productBox{0, 0.5, 1, 0.5}, Checks: checks},
	}}
	imageCalls, reviewCalls, planCalls := 0, 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/media") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/images/edits" {
			imageCalls++
			if e := r.ParseMultipartForm(4 << 20); e != nil {
				t.Error(e)
				return
			}
			defer r.MultipartForm.RemoveAll()
			if len(r.MultipartForm.File["image"])+len(r.MultipartForm.File["image[]"]) == 0 {
				t.Error("reference image missing")
			}
			if r.FormValue("input_fidelity") != "" {
				t.Error("unsupported gpt-image-2 fidelity sent")
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString(g)}}})
			return
		}
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		var content interface{}
		if body["model"] == "product-plan" {
			planCalls++
			content = plan
			if planCalls == 1 {
				// Regression: real planner output used right/bottom as width/height;
				// the deterministic normalizer fixes it without a second paid call.
				var malformed productPlan
				_ = json.Unmarshal(mustJSON(plan), &malformed)
				malformed.Shots[0].ProtectedRegions = []productBox{{0.25, 0.32, 0.45, 0.8}}
				malformed.Shots[0].Checks[0].Region = productBox{0.25, 0.6, 0.7, 0.8}
				content = malformed
			}
		} else {
			reviewCalls++
			status, reason := "pass", "与原图一致"
			if reviewCalls == 1 {
				status, reason = "fail", "顶部接触需要修正"
			}
			content = map[string]interface{}{"checked": true, "checks": []map[string]interface{}{{"id": "strip", "status": "pass", "reason": "商品细节保持"}, {"id": "composition", "status": status, "reason": reason, "region": productBox{0, 0, 1, 0.25}}}}
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"choices": []map[string]interface{}{{"message": map[string]interface{}{"content": string(mustJSON(content))}}}, "usage": map[string]int{"prompt_tokens": 100, "completion_tokens": 100}})
	}))
	defer server.Close()
	store, err := storage.NewLocal(t.TempDir(), server.URL+"/media")
	if err != nil {
		t.Fatal(err)
	}
	previous := objectStore
	objectStore = store
	defer func() { objectStore = previous }()
	ref, err := saveProductImage(ctx, "product-original", base)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range []struct{ code, category, mode, endpoint string }{{"product-plan", "chat", "chat", "/v1/chat/completions"}, {"product-review", "chat", "chat", "/v1/chat/completions"}, {"gpt-image-2", "image", "images", "/v1/images/generations"}} {
		var id int64
		err = pool.QueryRow(ctx, `INSERT INTO models(code,display_name,category,request_mode,new_api_model,new_api_endpoint,price_rule,runtime_rule,is_enabled) VALUES($1,$1,$2,$3,$1,$4,'{"billing_type":"per_image","unit_price":1}','{"capabilities":{"vision":true},"upstream":{"adapter":"openai_images"}}',true) RETURNING id`, m.code, m.category, m.mode, m.endpoint).Scan(&id)
		if err != nil {
			t.Fatal(err)
		}
		_, err = pool.Exec(ctx, `INSERT INTO model_routes(model_id,route_name,upstream_model,endpoint,base_url,runtime_rule) VALUES($1,'local-test',$2,$3,$4,'{"capabilities":{"vision":true},"upstream":{"adapter":"openai_images"}}')`, id, m.code, m.endpoint, server.URL)
		if err != nil {
			t.Fatal(err)
		}
	}
	runtime := map[string]interface{}{"agent_mode": "product_refine", "analysis_model_code": "product-plan", "quality_model_code": "product-review", "generation_model_code": "gpt-image-2"}
	var wf int64
	err = pool.QueryRow(ctx, `INSERT INTO workflow_definitions(code,name,runtime_config) VALUES('product_refine','精修测试',$1) RETURNING id`, mustJSON(runtime)).Scan(&wf)
	if err != nil {
		t.Fatal(err)
	}
	inputs := map[string]interface{}{"prompt": "上脚与特写", "count": 2, "max_repairs": 1, "max_cost": 20, "product_references": []productReference{{URL: ref, Role: "product"}}}
	var id int64
	err = pool.QueryRow(ctx, `INSERT INTO workflow_projects(public_id,user_id,workflow_id,status,inputs,estimated_cost) VALUES('product-test',99,$1,'running',$2,20) RETURNING id`, wf, mustJSON(inputs)).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO wallets(user_id,compute_balance,frozen_compute) VALUES(99,100,20); INSERT INTO balance_freezes(user_id,amount,ref_type,ref_id,status) VALUES(99,20,'workflow','product-test','frozen')`)
	if err != nil {
		t.Fatal(err)
	}
	p := WorkflowTaskPayload{ProjectID: id, UserID: 99}
	if err = processProductWorkflow(ctx, pool, server.URL, "", p, "product-test", 20, inputs, runtime); err != nil {
		t.Fatal(err)
	}
	var status string
	var cost, balance, frozen float64
	var raw []byte
	_ = pool.QueryRow(ctx, `SELECT status,actual_cost,outputs FROM workflow_projects WHERE id=$1`, id).Scan(&status, &cost, &raw)
	if status != "waiting_confirm" || planCalls != 1 || imageCalls != 1 || reviewCalls != 0 {
		t.Fatalf("workflow did not pause before review: status=%s calls=%d/%d/%d outputs=%s", status, planCalls, imageCalls, reviewCalls, string(raw))
	}
	pausedOutput := map[string]interface{}{}
	_ = json.Unmarshal(raw, &pausedOutput)
	if stringAny(pausedOutput["current_step"]) != "product_review_confirm" {
		t.Fatalf("wrong pause step: %s", string(raw))
	}
	var pausedResults []productShotResult
	_ = json.Unmarshal(mustJSON(pausedOutput["product_results"]), &pausedResults)
	if len(pausedResults) != 2 || pausedResults[0].ImageURL == "" || pausedResults[1].ImageURL == "" || reviewCalls != 0 {
		t.Fatalf("first-version batch was not completed before review pause: %s", string(raw))
	}
	deadline, deadlineErr := time.Parse(time.RFC3339, stringAny(pausedOutput["review_deadline_at"]))
	if deadlineErr != nil || time.Until(deadline) < 119*time.Minute || time.Until(deadline) > 121*time.Minute {
		t.Fatalf("wrong review deadline: %v %v", deadline, deadlineErr)
	}
	pausedOutput["confirmed_step"] = "product_review"
	if _, err = pool.Exec(ctx, `UPDATE workflow_projects SET status='pending',outputs=$1 WHERE id=$2`, mustJSON(pausedOutput), id); err != nil {
		t.Fatal(err)
	}
	if err = processWorkflowTask(ctx, pool, server.URL, "", p); err != nil {
		t.Fatal(err)
	}
	_ = pool.QueryRow(ctx, `SELECT status,actual_cost,outputs FROM workflow_projects WHERE id=$1`, id).Scan(&status, &cost, &raw)
	if status != "succeeded" {
		t.Fatalf("workflow failed after manual review: %s", string(raw))
	}
	_ = pool.QueryRow(ctx, `SELECT compute_balance,frozen_compute FROM wallets WHERE user_id=99`).Scan(&balance, &frozen)
	if planCalls != 1 || imageCalls != 1 || reviewCalls != 4 || cost != 20 || balance != 80 || frozen != 0 {
		t.Fatalf("calls=%d/%d/%d cost=%v balance=%v frozen=%v", planCalls, imageCalls, reviewCalls, cost, balance, frozen)
	}
	output := map[string]interface{}{}
	_ = json.Unmarshal(raw, &output)
	var results []productShotResult
	_ = json.Unmarshal(mustJSON(output["product_results"]), &results)
	im, err := productImage(ctx, results[0].ImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if im.Bounds().Dx() != base.Bounds().Dx() || im.Bounds().Dy() != base.Bounds().Dy() {
		t.Fatal("generated result dimensions changed")
	}
	if len(results[0].Attempts) != 1 || len(results[0].Attempts[0].Review) == 0 {
		t.Fatalf("manually reviewed candidate was not preserved: %s", mustJSON(results[0]))
	}
	var workCount int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM works`).Scan(&workCount)
	if workCount != 2 {
		t.Fatalf("raw candidates leaked into works: %d", workCount)
	}
	// A duplicate queue delivery must not create any more paid calls.
	if err = processWorkflowTask(ctx, pool, server.URL, "", p); err != nil {
		t.Fatal(err)
	}
	if planCalls != 1 || imageCalls != 1 || reviewCalls != 4 {
		t.Fatal("duplicate delivery submitted upstream")
	}
	if strings.Contains(string(raw), "api_key") {
		t.Fatal("credentials in output")
	}
	// Timeout completion takes the same accept path without any review call.
	autoInputs := map[string]interface{}{}
	_ = json.Unmarshal(mustJSON(inputs), &autoInputs)
	autoInputs["count"] = 1
	var autoID int64
	if err = pool.QueryRow(ctx, `INSERT INTO workflow_projects(public_id,user_id,workflow_id,status,inputs,estimated_cost) VALUES('product-auto',100,$1,'running',$2,20) RETURNING id`, wf, mustJSON(autoInputs)).Scan(&autoID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO wallets(user_id,compute_balance,frozen_compute) VALUES(100,100,20); INSERT INTO balance_freezes(user_id,amount,ref_type,ref_id,status) VALUES(100,20,'workflow','product-auto','frozen')`); err != nil {
		t.Fatal(err)
	}
	autoPayload := WorkflowTaskPayload{ProjectID: autoID, UserID: 100}
	if err = processProductWorkflow(ctx, pool, server.URL, "", autoPayload, "product-auto", 20, autoInputs, runtime); err != nil {
		t.Fatal(err)
	}
	_ = pool.QueryRow(ctx, `SELECT status,outputs FROM workflow_projects WHERE id=$1`, autoID).Scan(&status, &raw)
	if status != "waiting_confirm" {
		t.Fatalf("auto-complete fixture did not pause: %s", string(raw))
	}
	autoOutput := map[string]interface{}{}
	_ = json.Unmarshal(raw, &autoOutput)
	autoOutput["confirmed_step"] = "product_accept"
	autoOutput["product_auto_completed"] = true
	if _, err = pool.Exec(ctx, `UPDATE workflow_projects SET status='pending',outputs=$1 WHERE id=$2`, mustJSON(autoOutput), autoID); err != nil {
		t.Fatal(err)
	}
	if err = processWorkflowTask(ctx, pool, server.URL, "", autoPayload); err != nil {
		t.Fatal(err)
	}
	_ = pool.QueryRow(ctx, `SELECT status,actual_cost,outputs FROM workflow_projects WHERE id=$1`, autoID).Scan(&status, &cost, &raw)
	_ = pool.QueryRow(ctx, `SELECT compute_balance,frozen_compute FROM wallets WHERE user_id=100`).Scan(&balance, &frozen)
	autoOutput = map[string]interface{}{}
	_ = json.Unmarshal(raw, &autoOutput)
	var autoResults []productShotResult
	_ = json.Unmarshal(mustJSON(autoOutput["product_results"]), &autoResults)
	if status != "succeeded" || cost != 20 || balance != 80 || frozen != 0 || reviewCalls != 4 || len(autoResults) != 1 || autoResults[0].Status != "accepted" || !boolAny(autoOutput["product_review_skipped"]) {
		t.Fatalf("timeout completion failed: status=%s cost=%v balance=%v frozen=%v reviews=%d outputs=%s", status, cost, balance, frozen, reviewCalls, string(raw))
	}
	// Exhaust the new run's budget before review: keep the generated image and do
	// not dispatch a later review call.
	inputs["max_cost"] = 2
	var limitedID int64
	err = pool.QueryRow(ctx, `INSERT INTO workflow_projects(public_id,user_id,workflow_id,status,inputs,outputs,estimated_cost) VALUES('product-limited',99,$1,'running',$2,'{"confirmed_step":"product_review"}',2) RETURNING id`, wf, mustJSON(inputs)).Scan(&limitedID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `UPDATE wallets SET frozen_compute=2 WHERE user_id=99; INSERT INTO balance_freezes(user_id,amount,ref_type,ref_id,status) VALUES(99,2,'workflow','product-limited','frozen')`)
	if err != nil {
		t.Fatal(err)
	}
	if err = processProductWorkflow(ctx, pool, server.URL, "", WorkflowTaskPayload{ProjectID: limitedID, UserID: 99}, "product-limited", 2, inputs, runtime); err != nil {
		t.Fatal(err)
	}
	_ = pool.QueryRow(ctx, `SELECT status,actual_cost FROM workflow_projects WHERE id=$1`, limitedID).Scan(&status, &cost)
	if status != "succeeded" || cost != 2 || planCalls != 3 || imageCalls != 3 || reviewCalls != 4 {
		t.Fatalf("budget did not stop dispatch: %s cost=%v calls=%d/%d/%d", status, cost, planCalls, imageCalls, reviewCalls)
	}
}

func TestProductMigrationKeepsExistingCommerceBinding(t *testing.T) {
	pool := productTestDatabase(t)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `INSERT INTO models(code,display_name,category,request_mode,new_api_model,runtime_rule,is_enabled) VALUES('compatible','edit','image','images','compatible','{"upstream":{"adapter":"openai_images"}}',true);
      INSERT INTO workflow_definitions(code,name,runtime_config) VALUES('ecommerce_image','commerce','{"generation_model_code":"legacy","analysis_model_code":"vision"}')`)
	if err != nil {
		t.Fatal(err)
	}
	createSQL, err := os.ReadFile("../../../../infra/migrations/114_product_refine.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	followupSQL, err := os.ReadFile("../../../../infra/migrations/115_product_refine_runtime_and_ui.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err = pool.Exec(ctx, string(createSQL)); err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(followupSQL)); err != nil {
			t.Fatal(err)
		}
	}
	var code, legacy, theme string
	var maxCostRequired bool
	_ = pool.QueryRow(ctx, `SELECT runtime_config->>'generation_model_code' FROM workflow_definitions WHERE code='product_refine'`).Scan(&code)
	_ = pool.QueryRow(ctx, `SELECT runtime_config->>'generation_model_code' FROM workflow_definitions WHERE code='ecommerce_image'`).Scan(&legacy)
	_ = pool.QueryRow(ctx, `SELECT display_config->>'theme', input_schema->'required' ? 'max_cost' FROM workflow_definitions WHERE code='product_refine'`).Scan(&theme, &maxCostRequired)
	if code != "compatible" || legacy != "legacy" || theme != "cyan" || maxCostRequired {
		t.Fatalf("wrong migration result: code=%s legacy=%s theme=%s max_cost_required=%v", code, legacy, theme, maxCostRequired)
	}
}

func TestProductActualUsageOnFailureAndCancel(t *testing.T) {
	pool := productTestDatabase(t)
	ctx := context.Background()
	for i, stage := range []string{"running", "canceling"} {
		id := int64(i + 1)
		publicID := fmt.Sprintf("budget-%d", i)
		_, err := pool.Exec(ctx, `INSERT INTO workflow_definitions(id,code,name,runtime_config) VALUES($1,$2,'budget','{"agent_mode":"product_refine"}');`, id, publicID)
		if err != nil {
			t.Fatal(err)
		}
		_, err = pool.Exec(ctx, `INSERT INTO workflow_projects(id,public_id,user_id,workflow_id,status,inputs,estimated_cost) VALUES($1,$2,$1,$1,$3,'{"max_cost":5}',5)`, id, publicID, stage)
		if err != nil {
			t.Fatal(err)
		}
		_, err = pool.Exec(ctx, `INSERT INTO wallets(user_id,compute_balance,frozen_compute) VALUES($1,100,5)`, id)
		if err != nil {
			t.Fatal(err)
		}
		_, err = pool.Exec(ctx, `INSERT INTO balance_freezes(user_id,amount,ref_type,ref_id,status) VALUES($1,5,'workflow',$2,'frozen')`, id, publicID)
		if err != nil {
			t.Fatal(err)
		}
		_, err = pool.Exec(ctx, `INSERT INTO workflow_node_runs(project_id,node_id,name,type,status,cost) VALUES($1,'review','review','llm','succeeded',8)`, id)
		if err != nil {
			t.Fatal(err)
		}
		p := WorkflowTaskPayload{ProjectID: id, UserID: id}
		if stage == "canceling" {
			err = cancelWorkflow(ctx, pool, p, publicID, 5)
		} else {
			err = finishProductWorkflow(ctx, pool, p, publicID, 5, 5, map[string]interface{}{}, "预算耗尽")
		}
		if err != nil {
			t.Fatal(err)
		}
		var balance, frozen, cost float64
		var status string
		_ = pool.QueryRow(ctx, `SELECT compute_balance,frozen_compute FROM wallets WHERE user_id=$1`, id).Scan(&balance, &frozen)
		_ = pool.QueryRow(ctx, `SELECT actual_cost,status FROM workflow_projects WHERE id=$1`, id).Scan(&cost, &status)
		if balance != 92 || frozen != 0 || cost != 8 {
			t.Fatalf("actual usage not charged: %v %v %v", balance, frozen, cost)
		}
		if stage == "canceling" && status != "canceled" || stage == "running" && status != "failed" {
			t.Fatal(status)
		}
	}
}
