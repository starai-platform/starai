package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/config"
	"github.com/starai/api/internal/service"
)

type chatAssetStore struct {
	openAPIImageEditStore
	data []byte
}

func (s *chatAssetStore) ReadAll(context.Context, string, int64) ([]byte, error) { return s.data, nil }
func (s *chatAssetStore) ObjectKeyFromURL(ref string) string {
	if strings.HasPrefix(ref, "https://assets.example/") {
		return strings.TrimPrefix(ref, "https://assets.example/")
	}
	return ""
}
func (s *chatAssetStore) Upload(_ context.Context, name, _ string, r io.Reader, _ int64) (string, error) {
	s.data, _ = io.ReadAll(r)
	return "https://assets.example/" + name, nil
}

func TestChatAssetsAndAudioUpload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dsn := os.Getenv("AGENT_DRAFT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set AGENT_DRAFT_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("chat_asset_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") }()
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
	_, err = pool.Exec(ctx, `CREATE TABLE assets(public_id text,user_id bigint,bucket text,object_key text,name text,description text,kind text,asset_type text,mime_type text,size_bytes bigint,tags jsonb,created_at timestamptz DEFAULT now()); INSERT INTO assets VALUES('image1',42,'bucket','image.png','商品',NULL,'image','prop','image/png',20,'[]',now());`)
	if err != nil {
		t.Fatal(err)
	}
	pixels := []byte("\x89PNG\r\n\x1a\nimage bytes")
	store := &chatAssetStore{data: pixels}
	h := &Handler{assets: service.NewAssetService(pool), storage: store, cfg: &config.Config{}}
	input := service.CompletionInput{Params: map[string]interface{}{"asset_ids": []string{"image1"}, "file_asset_ids": []string{"image1"}}}
	if err = h.attachAssetContext(ctx, 42, &input); err != nil {
		t.Fatal(err)
	}
	images := stringListFromParam(input.Params["reference_images"])
	if len(images) != 1 || images[0] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(pixels) {
		t.Fatal("actual image pixels missing or duplicated")
	}
	if err = h.attachAssetContext(ctx, 43, &input); err == nil {
		t.Fatal("another user's attachment was accepted")
	}
	canvas := service.CompletionInput{Params: map[string]interface{}{"reference_images": []string{"https://assets.example/image.png"}}}
	if err := h.attachAssetContext(ctx, 42, &canvas); err != nil {
		t.Fatal(err)
	}
	if stringListFromParam(canvas.Params["reference_images"])[0] != images[0] {
		t.Fatal("canvas URL was not converted to pixels")
	}
	foreign := service.CompletionInput{Params: map[string]interface{}{"reference_images": []string{"https://assets.example/image.png"}}}
	if h.attachAssetContext(ctx, 43, &foreign) == nil {
		t.Fatal("foreign canvas asset accepted")
	}
	for _, name := range []string{"sound.mp3", "sound.wav", "sound.m4a", "photo.png", "clip.mp4", "notes.txt"} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		if name == "sound.wav" {
			_ = writer.WriteField("kind", "audio")
		}
		part, _ := writer.CreateFormFile("file", name)
		_, _ = part.Write([]byte("test content"))
		_ = writer.Close()
		req := httptest.NewRequest("POST", "/api/assets/upload", &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = req
		c.Set("user_id", int64(42))
		h.UploadAsset(c)
		if recorder.Code != 201 {
			t.Fatalf("%s failed: %s", name, recorder.Body.String())
		}
		if strings.HasPrefix(name, "sound") && !strings.Contains(recorder.Body.String(), `"kind":"audio"`) {
			t.Fatal("audio misclassified")
		}
	}
}
