package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/starai/api/internal/util"
)

// Authenticated, stateless conversion: no model calls, remote fetches or user
// filenames passed to an executable. Only our generated OOXML enters Writer.
func (h *Handler) ExportAgentDocument(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	var req struct {
		Content string `json:"content"`
		Format  string `json:"format"`
	}
	if c.ShouldBindJSON(&req) != nil || strings.TrimSpace(req.Content) == "" || !utf8.ValidString(req.Content) || utf8.RuneCountInString(req.Content) > documentTextLimit || (req.Format != "docx" && req.Format != "pdf") {
		util.BadRequest(c, "请提供1至60000字正文，并选择Word或PDF格式")
		return
	}
	data, err := buildDocumentDOCX(req.Content)
	mime := "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	if err == nil && req.Format == "pdf" {
		data, err = documentPDF(c.Request.Context(), data)
		mime = "application/pdf"
	}
	if err != nil {
		util.Fail(c, http.StatusServiceUnavailable, 503, "文件导出失败，请稍后重试；PDF导出需服务器安装LibreOffice及中文字体，可先下载Word")
		return
	}
	if strings.Contains(c.GetHeader("Accept"), "application/octet-stream") {
		c.Header("Content-Disposition", "attachment; filename=\"document."+req.Format+"\"; filename*=UTF-8''"+url.PathEscape("文档."+req.Format))
		c.Data(http.StatusOK, mime, data)
		return
	}
	// Keep JSON compatibility for clients deployed before binary downloads.
	util.OK(c, gin.H{"filename": "文档." + req.Format, "mime_type": mime, "data_base64": base64.StdEncoding.EncodeToString(data)})
}

func documentXMLText(text string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(text))
	return b.String()
}

func documentParagraph(line string) string {
	style := ""
	if m := regexp.MustCompile(`^(#{1,3})\s+(.+)$`).FindStringSubmatch(line); len(m) > 0 {
		style = fmt.Sprintf(`<w:pPr><w:pStyle w:val="Heading%d"/></w:pPr>`, len(m[1]))
		line = m[2]
	}
	var runs strings.Builder
	// Same basic heading/bold syntax as the Agent reply renderer. All other
	// content remains literal text, never active HTML, links or external objects.
	parts := strings.Split(line, "**")
	for i, part := range parts {
		bold := ""
		if i%2 == 1 && i < len(parts)-1 {
			bold = "<w:rPr><w:b/></w:rPr>"
		}
		if i == len(parts)-1 && i%2 == 1 {
			part = "**" + part
		}
		runs.WriteString(`<w:r>` + bold + `<w:t xml:space="preserve">` + documentXMLText(part) + `</w:t></w:r>`)
	}
	return `<w:p>` + style + runs.String() + `</w:p>`
}

func buildDocumentDOCX(content string) ([]byte, error) {
	var body strings.Builder
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	separator := regexp.MustCompile(`^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$`)
	blockStart := regexp.MustCompile(`^(?:#{1,6}\s|[-*+]\s|\d+[.)、]\s*|>|出租方|承租方|[甲乙丙丁]方(?:签字|签章|盖章|[：:])|法人代表|合同签订日期|签署日期)`)
	for i := 0; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "" {
			continue // Paragraph spacing supplies the gap; do not add empty pages or detach headings.
		}
		if i+1 < len(lines) && strings.Contains(lines[i], "|") && separator.MatchString(lines[i+1]) {
			body.WriteString(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>`)
			columns := len(strings.Split(strings.Trim(strings.TrimSpace(lines[i]), "|"), "|"))
			body.WriteString(`<w:tblGrid>`)
			for column := 0; column < columns; column++ {
				body.WriteString(fmt.Sprintf(`<w:gridCol w:w="%d"/>`, 9026/columns))
			}
			body.WriteString(`</w:tblGrid>`)
			for ; i < len(lines) && strings.Contains(lines[i], "|"); i++ {
				if separator.MatchString(lines[i]) {
					continue
				}
				body.WriteString(`<w:tr>`)
				for _, cell := range strings.Split(strings.Trim(strings.TrimSpace(lines[i]), "|"), "|") {
					body.WriteString(`<w:tc>` + documentParagraph(strings.TrimSpace(cell)) + `</w:tc>`)
				}
				body.WriteString(`</w:tr>`)
			}
			body.WriteString(`</w:tbl>`)
			i--
			continue
		}
		line := lines[i]
		if !strings.HasPrefix(strings.TrimSpace(line), "#") {
			for i+1 < len(lines) && strings.TrimSpace(lines[i+1]) != "" && !blockStart.MatchString(strings.TrimSpace(lines[i+1])) && !(i+2 < len(lines) && separator.MatchString(lines[i+2])) {
				i++
				line += " " + strings.TrimSpace(lines[i])
			}
		}
		body.WriteString(documentParagraph(line))
	}
	files := []struct{ name, data string }{
		{"[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`},
		{"_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`},
		{"word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
		{"word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Noto Serif CJK SC" w:hAnsi="Noto Serif CJK SC" w:eastAsia="Noto Serif CJK SC"/><w:sz w:val="24"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/><w:rPr><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Heading2"/><w:rPr><w:sz w:val="26"/></w:rPr></w:style></w:styles>`},
		{"word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` + body.String() + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`},
	}
	var out bytes.Buffer
	w := zip.NewWriter(&out)
	for _, file := range files {
		entry, err := w.Create(file.name)
		if err != nil {
			return nil, err
		}
		if _, err = io.WriteString(entry, file.data); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func documentPDF(ctx context.Context, docx []byte) ([]byte, error) {
	dir, err := os.MkdirTemp("", "starai-document-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	input := filepath.Join(dir, "document.docx")
	if err = os.WriteFile(input, docx, 0600); err != nil {
		return nil, err
	}
	profilePath := filepath.ToSlash(filepath.Join(dir, "profile"))
	if !strings.HasPrefix(profilePath, "/") {
		profilePath = "/" + profilePath
	}
	profile := (&url.URL{Scheme: "file", Path: profilePath}).String()
	_, err = documentProcess(ctx, "soffice", []string{"-env:UserInstallation=" + profile, "--headless", "--convert-to", "pdf:writer_pdf_Export", "--outdir", dir, input}, nil, 64<<10)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(filepath.Join(dir, "document.pdf"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, (20<<20)+1))
	if err != nil || len(data) > 20<<20 || !bytes.HasPrefix(data, []byte("%PDF-")) {
		return nil, errors.New("invalid PDF output")
	}
	return data, nil
}
