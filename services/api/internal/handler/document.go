package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const documentTextLimit = 60000

// Never silently turn a partial extraction into the source of a revised contract.
type documentText struct {
	Text  string
	Issue string
	Note  string
}

// Bounded, process-local extraction reuse. Original bytes are still read after
// asset authorization, so replaced/deleted files cannot return stale text.
type documentTextCache struct {
	sync.Mutex
	entries map[[32]byte]documentTextCacheEntry
}

type documentTextCacheEntry struct {
	result  documentText
	expires time.Time
}

func (cache *documentTextCache) get(key [32]byte) (documentText, bool) {
	cache.Lock()
	defer cache.Unlock()
	entry, ok := cache.entries[key]
	if ok && time.Now().Before(entry.expires) {
		return entry.result, true
	}
	delete(cache.entries, key)
	return documentText{}, false
}

func (cache *documentTextCache) put(key [32]byte, result documentText) {
	if result.Issue != "" || result.Text == "" {
		return // A fixed converter/OCR configuration must be retried immediately.
	}
	cache.Lock()
	defer cache.Unlock()
	if cache.entries == nil {
		cache.entries = make(map[[32]byte]documentTextCacheEntry)
	}
	now := time.Now()
	var oldest [32]byte
	var oldestTime time.Time
	for id, entry := range cache.entries {
		if !now.Before(entry.expires) {
			delete(cache.entries, id)
		} else if oldestTime.IsZero() || entry.expires.Before(oldestTime) {
			oldest, oldestTime = id, entry.expires
		}
	}
	if len(cache.entries) >= 32 {
		delete(cache.entries, oldest)
	}
	cache.entries[key] = documentTextCacheEntry{result: result, expires: now.Add(5 * time.Minute)}
}

func (h *Handler) readAssetDocument(ctx context.Context, key, mime string) documentText {
	if h.storage == nil {
		return documentText{Issue: "文档存储不可用"}
	}
	data, err := h.storage.ReadAll(ctx, key, 20<<20)
	if err != nil || len(data) == 0 || len(data) > 20<<20 {
		return documentText{Issue: "文档读取失败或超过20MB"}
	}
	hash := sha256.New()
	hash.Write(data)
	_, _ = fmt.Fprintf(hash, "\x00%s\x00%s\x00%s\x00%s", key, mime, os.Getenv("DOCUMENT_OCR_LANG"), os.Getenv("DOCUMENT_TESSDATA_DIR"))
	var cacheKey [32]byte
	copy(cacheKey[:], hash.Sum(nil))
	if result, ok := h.documentCache.get(cacheKey); ok {
		return result
	}
	var result documentText
	switch lower := strings.ToLower(key); {
	case strings.HasSuffix(lower, ".docx") || mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		result = readDocxText(data)
	case strings.HasSuffix(lower, ".pdf") || mime == "application/pdf":
		result = readPDFText(ctx, data)
	case strings.HasSuffix(lower, ".txt") || strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".csv") || strings.HasPrefix(mime, "text/"):
		if !utf8.Valid(data) {
			return documentText{Issue: "文本不是有效UTF-8，请另存为UTF-8后重新上传"}
		}
		result.Text = strings.TrimPrefix(string(data), "\ufeff")
	default:
		return documentText{Issue: "暂不支持可靠读取此格式，请将旧版DOC另存为DOCX，或上传UTF-8文本"}
	}
	result.Text = cleanExtractedText(result.Text)
	if result.Text == "" && result.Issue == "" {
		result.Issue = "未读取到正文；扫描件或图片文档需先OCR识别，或提供可复制的完整原文"
	}
	if utf8.RuneCountInString(result.Text) > documentTextLimit {
		result.Text = ""
		result.Issue = "正文超过60000字，请按章节拆分后上传；本次未提供截断正文"
	}
	h.documentCache.put(cacheKey, result)
	return result
}

func readDocxText(data []byte) documentText {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return documentText{Issue: "DOCX文件损坏，无法读取完整正文"}
	}
	var parts []string
	var bodyFound, unsupported bool
	total := 0
	for _, f := range zr.File {
		if f.Name != "word/document.xml" && f.Name != "word/footnotes.xml" && f.Name != "word/endnotes.xml" && !strings.HasPrefix(f.Name, "word/header") && !strings.HasPrefix(f.Name, "word/footer") {
			continue
		}
		if f.Name == "word/document.xml" {
			bodyFound = true
		}
		rc, err := f.Open()
		if err != nil {
			return documentText{Issue: "DOCX内容读取失败"}
		}
		raw, readErr := io.ReadAll(io.LimitReader(rc, int64((5<<20)-total+1)))
		rc.Close()
		total += len(raw)
		if readErr != nil || total > 5<<20 {
			return documentText{Issue: "DOCX解压后内容过大或不完整，请拆分文档"}
		}
		decoder := xml.NewDecoder(bytes.NewReader(raw))
		var out strings.Builder
		inText, deleted := false, 0
		for {
			token, err := decoder.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				return documentText{Issue: "DOCX正文XML损坏，无法完整解析"}
			}
			switch t := token.(type) {
			case xml.StartElement:
				switch t.Name.Local {
				case "del":
					deleted++
				case "t":
					inText = true
				case "tab":
					if deleted == 0 {
						out.WriteString("\t")
					}
				case "br", "cr":
					if deleted == 0 {
						out.WriteString("\n")
					}
				case "drawing", "pict", "object", "altChunk", "numPr":
					unsupported = true
				}
			case xml.EndElement:
				switch t.Name.Local {
				case "del":
					deleted--
				case "t":
					inText = false
				case "p", "tr":
					if deleted == 0 {
						out.WriteString("\n")
					}
				case "tc":
					if deleted == 0 {
						out.WriteString("\t")
					}
				}
			case xml.CharData:
				if inText && deleted == 0 {
					out.Write(t)
				}
			}
		}
		parts = append(parts, out.String())
	}
	if !bodyFound {
		return documentText{Issue: "DOCX缺少正文"}
	}
	result := documentText{Text: strings.Join(parts, "\n")}
	if unsupported {
		result.Issue = "已读取文字，但图片、嵌入对象或自动编号未完整解析；需确认相关内容或补充其文字后才能交付完整修订版"
	}
	return result
}

// A shared process limit bounds CPU/memory for native document tools.
var documentProcesses = make(chan struct{}, 2)

func documentProcess(ctx context.Context, name string, args []string, stdin []byte, limit int) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	select {
	case documentProcesses <- struct{}{}:
		defer func() { <-documentProcesses }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	toolPath := strings.TrimSpace(os.Getenv("DOCUMENT_" + strings.ToUpper(name) + "_PATH"))
	if toolPath == "" {
		toolPath = name
	}
	cmd := exec.CommandContext(ctx, toolPath, args...)
	cmd.WaitDelay = 2 * time.Second
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	out := &limitedDocumentOutput{limit: limit}
	cmd.Stdout = out
	if err := cmd.Run(); err != nil {
		log.Printf("document tool failed: tool=%s error=%v", name, err)
		return nil, err
	}
	return out.Bytes(), nil
}

type limitedDocumentOutput struct {
	bytes.Buffer
	limit int
}

func (b *limitedDocumentOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.limit {
		return 0, errors.New("document output too large")
	}
	return b.Buffer.Write(p)
}

func readPDFText(ctx context.Context, data []byte) documentText {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	out, err := documentProcess(ctx, "pdftotext", []string{"-layout", "-enc", "UTF-8", "-", "-"}, data, 2<<20)
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) {
			return documentText{Issue: "已收到PDF附件，但服务器PDF识别工具未配置，需管理员修复识别服务；不是用户未上传原文"}
		}
		return documentText{Issue: "已收到PDF，但解析失败（可能加密、损坏或读取超时），请检查文件或提供可读取原文"}
	}
	pages := strings.Split(strings.TrimSuffix(string(out), "\f"), "\f")
	needsOCR := false
	for _, page := range pages {
		if pdfPageNeedsOCR(page) {
			needsOCR = true
			break
		}
	}
	if !needsOCR {
		return documentText{Text: strings.Join(pages, "\n")}
	}
	return readPDFScanPages(ctx, data, pages)
}

func pdfPageNeedsOCR(page string) bool {
	// Page numbers and running headers do not make a scanned page readable.
	return utf8.RuneCountInString(strings.Join(strings.Fields(page), "")) < 40
}

func readPDFScanPages(ctx context.Context, data []byte, pages []string) documentText {
	dir, err := os.MkdirTemp("", "starai-pdf-ocr-")
	if err != nil {
		return documentText{Issue: "PDF识别临时存储不可用"}
	}
	defer os.RemoveAll(dir)
	input := filepath.Join(dir, "source.pdf")
	if err := os.WriteFile(input, data, 0600); err != nil {
		return documentText{Issue: "PDF识别临时存储写入失败"}
	}
	info, err := documentProcess(ctx, "pdfinfo", []string{input}, nil, 64<<10)
	match := regexp.MustCompile(`(?m)^Pages:\s+(\d+)`).FindStringSubmatch(string(info))
	if err != nil || len(match) != 2 {
		return documentText{Issue: "已收到扫描PDF，但无法确认页数，暂不能交付完整修订版"}
	}
	count, _ := strconv.Atoi(match[1])
	if count != len(pages) || count < 1 {
		return documentText{Issue: "PDF页数与读取结果不一致，无法确认正文完整性"}
	}
	if count > 20 {
		return documentText{Issue: "扫描PDF超过20页，请拆分后识别；本次未提供截断正文"}
	}
	language := strings.TrimSpace(os.Getenv("DOCUMENT_OCR_LANG"))
	if language == "" {
		language = "chi_sim"
	}
	ocrArgs := []string{}
	if dir := strings.TrimSpace(os.Getenv("DOCUMENT_TESSDATA_DIR")); dir != "" {
		ocrArgs = append(ocrArgs, "--tessdata-dir", dir)
	}
	langs, err := documentProcess(ctx, "tesseract", append(append([]string{}, ocrArgs...), "--list-langs"), nil, 64<<10)
	available := "\n" + strings.ReplaceAll(string(langs), "\r", "") + "\n"
	for _, lang := range strings.Split(language, "+") {
		if err != nil || !strings.Contains(available, "\n"+lang+"\n") {
			return documentText{Issue: "已收到扫描PDF，但OCR引擎或所需语言包未安装，需管理员修复识别服务；不是用户未上传原文"}
		}
	}
	ocrPages := 0
	for i, page := range pages {
		if !pdfPageNeedsOCR(page) {
			continue
		}
		pageNo := strconv.Itoa(i + 1)
		prefix := filepath.Join(dir, "page")
		_, err := documentProcess(ctx, "pdftoppm", []string{"-f", pageNo, "-l", pageNo, "-scale-to", "2500", "-gray", "-png", "-singlefile", input, prefix}, nil, 64<<10)
		if err != nil {
			return documentText{Issue: fmt.Sprintf("已收到扫描PDF，但第%d页转图失败，未完成全文识别", i+1)}
		}
		args := append([]string{prefix + ".png", "stdout", "-l", language, "--psm", "3"}, ocrArgs...)
		text, err := documentProcess(ctx, "tesseract", args, nil, 1<<20)
		if err != nil {
			return documentText{Issue: fmt.Sprintf("已收到扫描PDF，但第%d页OCR失败，请管理员检查中文OCR识别服务；不是缺少附件", i+1)}
		}
		if pdfPageNeedsOCR(string(text)) {
			return documentText{Issue: fmt.Sprintf("PDF第%d页识别文字过少，可能是空白页、签章页或模糊扫描，请核对该页；不据此冒充完整原文", i+1)}
		}
		pages[i] = string(text)
		ocrPages++
	}
	return documentText{Text: strings.Join(pages, "\n\n"), Note: fmt.Sprintf("共%d页，已对其中%d页扫描内容完成OCR。识别文字需对照原件核对，尤其姓名、金额、日期及手写内容；不识别或复制签名、印章。模糊文字不得猜补。", count, ocrPages)}
}
