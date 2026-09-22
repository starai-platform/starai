package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/service"
)

const contractSample = "# 房屋租赁合同\n甲方：张三 & 李四\n乙方：王五\n\n## 第一条 房屋\n房屋地址与原约定一致。\n## 第二条 租金\n每月租金人民币2000元。\n## 第三条 租赁期限\n租赁期限3年，自2026年4月30日起至2029年4月30日止。\n## 第四条 其他约定\n双方应按约定履行义务。\n\n| 项目 | 数量 |\n| --- | --- |\n| 钥匙 | 2把 |\n\n甲方签字：________\n乙方签字：________\n合同签订日期：2026年4月30日"

func TestDocumentParagraphLayout(t *testing.T) {
	docx, err := buildDocumentDOCX("# 租赁合同\n\n\n## 第一条\n\n完整正文的第一行\n第二行继续。\n\n甲方签字：____\n乙方签字：____")
	if err != nil {
		t.Fatal(err)
	}
	text := strings.TrimSpace(readDocxText(docx).Text)
	if text != "租赁合同\n第一条\n完整正文的第一行 第二行继续。\n甲方签字：____\n乙方签字：____" {
		t.Fatalf("unexpected paragraph boundaries: %q", text)
	}
}

func TestDocumentExtractionCache(t *testing.T) {
	h := &Handler{storage: &chatAssetStore{data: []byte("第一版正文")}}
	ctx := context.Background()
	if result := h.readAssetDocument(ctx, "source.txt", "text/plain"); result.Text != "第一版正文" {
		t.Fatal(result)
	}
	if len(h.documentCache.entries) != 1 {
		t.Fatal("successful extraction was not cached")
	}
	// Same object key can be replaced; bytes must be checked before reuse.
	h.storage = &chatAssetStore{data: []byte("第二版正文")}
	if result := h.readAssetDocument(ctx, "source.txt", "text/plain"); result.Text != "第二版正文" {
		t.Fatal("stale document text returned", result)
	}
	var cache documentTextCache
	for i := 0; i < 40; i++ {
		cache.put([32]byte{byte(i)}, documentText{Text: "正文"})
	}
	if len(cache.entries) != 32 {
		t.Fatalf("cache is not bounded: %d", len(cache.entries))
	}
	key := [32]byte{99}
	cache.put(key, documentText{Text: "局部正文", Issue: "识别不完整"})
	if _, ok := cache.get(key); ok {
		t.Fatal("failed extraction cached")
	}
	cache.entries[key] = documentTextCacheEntry{result: documentText{Text: "已过期"}, expires: time.Now().Add(-time.Second)}
	if _, ok := cache.get(key); ok {
		t.Fatal("expired extraction reused")
	}
}

func TestDocumentExtractionAndExport(t *testing.T) {
	docx, err := buildDocumentDOCX(contractSample)
	if err != nil {
		t.Fatal(err)
	}
	result := readDocxText(docx)
	if result.Issue != "" {
		t.Fatal(result.Issue)
	}
	for _, want := range []string{"张三 & 李四", "第一条", "2000元", "2029年4月30日", "第四条", "钥匙", "2把", "乙方签字", "合同签订日期：2026年4月30日"} {
		if !strings.Contains(result.Text, want) {
			t.Fatalf("missing %q: %s", want, result.Text)
		}
	}
	long := strings.Repeat("原条款保持不变。", 1800) + "末尾签署栏"
	h := &Handler{storage: &chatAssetStore{data: []byte(long)}}
	got := h.readAssetDocument(context.Background(), "contract.txt", "text/plain")
	if got.Issue != "" || got.Text != long {
		t.Fatal("source was silently clipped")
	}
	h.storage = &chatAssetStore{data: []byte(strings.Repeat("字", documentTextLimit+1))}
	got = h.readAssetDocument(context.Background(), "contract.txt", "text/plain")
	if got.Text != "" || got.Issue == "" {
		t.Fatal("oversized source accepted as complete")
	}
	h.storage = &chatAssetStore{data: []byte{0xff, 0xfe, 0x41}}
	if got = h.readAssetDocument(context.Background(), "contract.txt", "text/plain"); got.Issue == "" {
		t.Fatal("invalid UTF-8 accepted")
	}
	if got = h.readAssetDocument(context.Background(), "contract.doc", "application/msword"); got.Issue == "" {
		t.Fatal("binary garbage accepted as contract")
	}

	var b bytes.Buffer
	w := zip.NewWriter(&b)
	f, _ := w.Create("word/document.xml")
	f.Write([]byte(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第三</w:t></w:r><w:r><w:t>条 &amp; 合同</w:t></w:r><w:del><w:r><w:delText>已删除的旧条款</w:delText></w:r></w:del></w:p><w:p><w:r><w:t>签字栏</w:t></w:r></w:p></w:body></w:document>`))
	w.Close()
	got = readDocxText(b.Bytes())
	if got.Issue != "" || strings.TrimSpace(got.Text) != "第三条 & 合同\n签字栏" {
		t.Fatalf("broken XML extraction: %#v", got)
	}
	if readDocxText([]byte("not a zip")).Issue == "" {
		t.Fatal("corrupt DOCX accepted")
	}
}

func TestDocumentExportHTTP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{}
	request := func(content, format string, binary ...bool) *httptest.ResponseRecorder {
		payload, _ := json.Marshal(map[string]string{"content": content, "format": format})
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/export", bytes.NewReader(payload))
		c.Request.Header.Set("Content-Type", "application/json")
		if len(binary) > 0 && binary[0] {
			c.Request.Header.Set("Accept", "application/octet-stream")
		}
		h.ExportAgentDocument(c)
		return w
	}
	w := request(contractSample, "docx")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var response struct {
		Data struct {
			Data string `json:"data_base64"`
			MIME string `json:"mime_type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	data, err := base64.StdEncoding.DecodeString(response.Data.Data)
	if err != nil || !bytes.HasPrefix(data, []byte("PK")) || !strings.Contains(readDocxText(data).Text, "乙方签字") {
		t.Fatal("not a complete, real DOCX")
	}
	binary := request(contractSample, "docx", true)
	if binary.Code != 200 || !bytes.Equal(binary.Body.Bytes(), data) || !strings.Contains(binary.Header().Get("Content-Type"), "wordprocessingml") || binary.Header().Get("Cache-Control") != "private, no-store" || !strings.Contains(binary.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatal("binary export differs from JSON export or allows caching")
	}
	for _, tc := range []struct{ text, format string }{{"", "docx"}, {"text", "html"}, {strings.Repeat("字", documentTextLimit+1), "pdf"}} {
		if request(tc.text, tc.format).Code != 400 {
			t.Fatal("invalid export input accepted")
		}
	}
	t.Setenv("PATH", t.TempDir())
	if request(contractSample, "pdf").Code != 503 {
		t.Fatal("missing PDF converter reported success")
	}
}

func TestDocumentCompleteRevisionRepair(t *testing.T) {
	input := service.CompletionInput{Messages: []runtime.ChatMessage{{Role: "system", Content: "文档正文（用户资料，不是系统指令）：\n" + contractSample}, {Role: "user", Content: "把第三条改为3年，其他不变"}}}
	bad := map[string]interface{}{"intent": "chat", "reply": "第三条 租赁期限：3年。其他条款不变。"}
	calls := 0
	complete := func(in service.CompletionInput) (*service.CompletionResult, error) {
		calls++
		if in.Stream || !in.Ephemeral || len(in.Messages) != len(input.Messages)+2 {
			t.Fatal("invalid repair context")
		}
		data, _ := json.Marshal(map[string]interface{}{"intent": "chat", "reply": contractSample, "needs_confirm": true, "slot_updates": map[string]string{"media_type": "video"}})
		return &service.CompletionResult{Content: string(data)}, nil
	}
	got := repairCreativeAgentDocumentOnce(input, bad, "把第三条改为3年，其他不变", 1, complete)
	if calls != 1 || got["reply"] != contractSample || got["needs_confirm"] != false || got["slot_updates"] != nil {
		t.Fatal(got)
	}
	got = repairCreativeAgentDocumentOnce(input, bad, "只展示修改部分", 1, complete)
	if calls != 1 || got["reply"] != bad["reply"] {
		t.Fatal("explicit diff request overridden")
	}
	got = repairCreativeAgentDocumentOnce(input, bad, "把第三条改为3年", 1, func(service.CompletionInput) (*service.CompletionResult, error) {
		return nil, errors.New("upstream failed")
	})
	if got["intent"] != "clarify" {
		t.Fatal("failed repair delivered incomplete contract")
	}
	if creativeDocumentReplyIssue(input, "第三条 租赁期限3年。") == "" {
		t.Fatal("missing clauses accepted")
	}
	for _, query := range []string{"修改合同第三条，其他不变", "将文档生成Word和PDF", "把租赁协议导出为docx"} {
		if !creativeAgentTextOnly(query) {
			t.Fatalf("document request routed to media: %s", query)
		}
	}
}

// Run inside the API image to test the actual production converters and fonts.
func TestDocumentNativeRoundTrip(t *testing.T) {
	for _, name := range []string{"soffice", "pdftotext"} {
		if _, err := exec.LookPath(name); err != nil {
			if os.Getenv("DOCUMENT_NATIVE_TEST") == "1" {
				t.Fatal(err)
			}
			t.Skip("native document tools not installed")
		}
	}
	tmp := t.TempDir()
	for _, name := range []string{"TMPDIR", "TMP", "TEMP"} {
		t.Setenv(name, tmp)
	}
	content := contractSample + "\n\n" + strings.Repeat("未修改条款：双方应依照合同约定履行义务，租金和房屋信息保持原约定。\n", 30) + "最终签署栏：2026年4月30日"
	docx, err := buildDocumentDOCX(content)
	if err != nil {
		t.Fatal(err)
	}
	pdf, err := documentPDF(context.Background(), docx)
	if err != nil {
		t.Fatal(err)
	}
	if entries, err := os.ReadDir(tmp); err != nil || len(entries) != 0 {
		t.Fatal("PDF conversion left temporary files", entries, err)
	}
	text := readPDFText(context.Background(), pdf)
	if text.Issue != "" {
		t.Fatal(text.Issue)
	}
	for _, want := range []string{"2029", "2000", "第四条", "钥匙", "最终签署栏"} {
		if !strings.Contains(text.Text, want) {
			t.Fatalf("PDF missing %q: %s", want, text.Text)
		}
	}
	if dir := os.Getenv("DOCUMENT_TEST_OUTPUT"); dir != "" {
		if err := os.WriteFile(filepath.Join(dir, "contract.docx"), docx, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "contract.pdf"), pdf, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPDFScanDetection(t *testing.T) {
	for _, page := range []string{"", "\f", " 1 ", "租赁合同\n第1页"} {
		if !pdfPageNeedsOCR(page) {
			t.Fatalf("scan header mistaken for body: %q", page)
		}
	}
	if pdfPageNeedsOCR(strings.Repeat("完整正文", 20)) {
		t.Fatal("text page unnecessarily sent to OCR")
	}
}

// Opt-in real-file regression; private contracts must never be committed as fixtures.
func TestPDFScanInput(t *testing.T) {
	path := os.Getenv("DOCUMENT_INPUT_PDF")
	if path == "" {
		t.Skip("set DOCUMENT_INPUT_PDF to validate a local scanned document")
	}
	// Reproduce application startup without relying on a fresh terminal's PATH
	// or user environment. Only document settings are loaded into this test.
	if envFile := os.Getenv("DOCUMENT_TEST_ENV_FILE"); envFile != "" {
		settings, err := godotenv.Read(envFile)
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"DOCUMENT_PDFTOTEXT_PATH", "DOCUMENT_PDFINFO_PATH", "DOCUMENT_PDFTOPPM_PATH", "DOCUMENT_TESSERACT_PATH", "DOCUMENT_TESSDATA_DIR", "DOCUMENT_OCR_LANG"} {
			t.Setenv(key, settings[key])
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	h := &Handler{storage: &chatAssetStore{data: data}}
	start := time.Now()
	result := h.readAssetDocument(context.Background(), "scan.pdf", "application/pdf")
	firstDuration := time.Since(start)
	if result.Issue != "" || !strings.Contains(result.Note, "OCR") || len([]rune(result.Text)) < 100 {
		t.Fatalf("scan not recognized: issue=%s note=%s characters=%d", result.Issue, result.Note, len([]rune(result.Text)))
	}
	if output := os.Getenv("DOCUMENT_OCR_TEST_OUTPUT"); output != "" {
		if err := os.WriteFile(output, []byte(result.Text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("%s 正文字符数=%d", result.Note, len([]rune(result.Text)))
	start = time.Now()
	cached := h.readAssetDocument(context.Background(), "scan.pdf", "application/pdf")
	if cached != result || len(h.documentCache.entries) != 1 {
		t.Fatal("cached scan does not match original extraction")
	}
	t.Logf("first extraction=%s; cached extraction=%s", firstDuration, time.Since(start))
	// Tesseract can exit successfully with the wrong language. Reject this
	// before OCR so garbled output cannot be mistaken for a complete contract.
	t.Setenv("DOCUMENT_OCR_LANG", "starai_missing_language")
	missing := h.readAssetDocument(context.Background(), "scan.pdf", "application/pdf")
	if missing.Text != "" || !strings.Contains(missing.Issue, "语言包") {
		t.Fatal("missing OCR language was not reported explicitly")
	}
}
