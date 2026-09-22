package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

func TestComicVideoSamples(t *testing.T) {
	if _, err := ffmpegBinaryPath(); err != nil {
		t.Skip(err)
	}
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "sample.mp4")
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "color=c=red:s=160x90:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", path); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write(data)
	}))
	defer server.Close()
	samples, err := comicVideoSamples(ctx, server.URL+"/sample.mp4")
	if err != nil || len(samples) != 3 {
		t.Fatal(len(samples), err)
	}
	for _, sample := range samples {
		if !strings.HasPrefix(sample, "data:image/jpeg;base64,") {
			t.Fatal("invalid extracted frame")
		}
	}
}

// Explicit opt-in: checks the configured upstream using synthetic test images.
func TestComicLiveVisualReview(t *testing.T) {
	code := os.Getenv("COMIC_LIVE_REVIEW_MODEL")
	if code == "" {
		t.Skip("set COMIC_LIVE_REVIEW_MODEL to opt into a billable upstream check")
	}
	_ = godotenv.Load("../../../../.env.local", "../../../../.env")
	modelRouteCipherKey = getenv("MODEL_ROUTE_CIPHER_KEY", getenv("ADMIN_JWT_SECRET", "dev-admin-jwt-secret"))
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	fixture := func(fill color.RGBA) string {
		canvas := image.NewRGBA(image.Rect(0, 0, 96, 96))
		for y := 0; y < 96; y++ {
			for x := 0; x < 96; x++ {
				canvas.SetRGBA(x, y, fill)
			}
		}
		var data bytes.Buffer
		if err := png.Encode(&data, canvas); err != nil {
			t.Fatal(err)
		}
		return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data.Bytes())
	}
	red, blue := fixture(color.RGBA{R: 255, A: 255}), fixture(color.RGBA{B: 255, A: 255})
	config := map[string]interface{}{"quality_model_code": code, "asset_consistency_score": 80}
	inputs := map[string]interface{}{"reference_images": []string{red}, "_reference_bindings": "参考图1是唯一主体的颜色基准"}
	for _, tc := range []struct {
		name, image string
		pass        bool
	}{{"same", red, true}, {"changed", blue, false}} {
		scores, cost, message := reviewComicImage(ctx, pool, getenv("NEW_API_BASE_URL", "http://localhost:3002"), getenv("NEW_API_TOKEN", ""), config, inputs, tc.image, "唯一主体是填满画面的纯色方块。颜色是身份的关键属性，不允许更换；比较两张图片颜色是否一致。")
		passed := stringAny(scores["status"]) == "passed"
		if !boolAny(scores["checked"]) || passed != tc.pass {
			t.Fatalf("%s: scores=%v error=%s", tc.name, scores, message)
		}
		t.Logf("%s model=%s passed=%v cost=%.6f", tc.name, code, passed, cost)
	}
}
