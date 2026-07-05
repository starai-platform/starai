package mailer

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Config holds email settings from system_configs (admin-maintained).
type Config struct {
	Enabled      bool
	Provider     string
	Host         string
	Port         int
	User         string
	Pass         string
	From         string
	UseSSL       bool
	ResendAPIKey string
	ResendFrom   string
}

type Service struct {
	db *pgxpool.Pool
}

func New(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (s *Service) LoadConfig(ctx context.Context) Config {
	cfg := Config{Provider: "smtp", Port: 465, UseSSL: true}
	read := func(key string, dest interface{}) {
		var raw []byte
		if err := s.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key=$1`, key).Scan(&raw); err != nil {
			return
		}
		_ = json.Unmarshal(raw, dest)
	}
	read("smtp_enabled", &cfg.Enabled)
	var provider, host, user, pass, from, resendAPIKey, resendFrom string
	read("email_provider", &provider)
	read("smtp_host", &host)
	read("smtp_user", &user)
	read("smtp_pass", &pass)
	read("smtp_from", &from)
	read("smtp_port", &cfg.Port)
	read("smtp_ssl", &cfg.UseSSL)
	read("resend_api_key", &resendAPIKey)
	read("resend_from", &resendFrom)
	cfg.Provider = strings.TrimSpace(strings.ToLower(provider))
	if cfg.Provider == "" {
		cfg.Provider = "smtp"
	}
	cfg.Host = strings.TrimSpace(host)
	cfg.User = strings.TrimSpace(user)
	cfg.Pass = strings.TrimSpace(pass)
	cfg.From = strings.TrimSpace(from)
	cfg.ResendAPIKey = strings.TrimSpace(resendAPIKey)
	cfg.ResendFrom = strings.TrimSpace(resendFrom)
	if cfg.Port <= 0 {
		cfg.Port = 465
	}
	if cfg.From == "" && cfg.User != "" {
		cfg.From = cfg.User
	}
	return cfg
}

func (s *Service) IsDebugOTP(ctx context.Context) bool {
	var v bool
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key='email_otp_debug'`).Scan(&raw); err != nil {
		return false
	}
	json.Unmarshal(raw, &v)
	return v
}

// Send delivers a plain-text email via the configured provider.
func (s *Service) Send(ctx context.Context, cfg Config, to, subject, body string) error {
	if cfg.Provider == "resend" {
		return s.sendResend(ctx, cfg, to, subject, body)
	}
	return s.sendSMTP(cfg, to, subject, body)
}

// sendSMTP delivers a plain-text email via SMTP (supports SSL:465 and STARTTLS:587).
func (s *Service) sendSMTP(cfg Config, to, subject, body string) error {
	if !cfg.Enabled || cfg.Host == "" || cfg.User == "" || cfg.Pass == "" {
		return fmt.Errorf("SMTP 未启用或配置不完整")
	}
	to = strings.TrimSpace(to)
	if to == "" {
		return fmt.Errorf("收件人为空")
	}
	from := cfg.From
	if from == "" {
		from = cfg.User
	}
	// QQ/163 等个人邮箱要求 MAIL FROM 与登录账号一致，否则会被拒（501/502）。
	if !strings.EqualFold(extractEmail(from), strings.TrimSpace(cfg.User)) {
		from = cfg.User
	}
	msg := buildMessage(from, to, subject, body)
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	auth := smtp.PlainAuth("", cfg.User, cfg.Pass, cfg.Host)

	if cfg.UseSSL || cfg.Port == 465 {
		return sendTLS(addr, cfg.Host, auth, from, []string{to}, msg)
	}
	return smtp.SendMail(addr, auth, extractEmail(from), []string{to}, msg)
}

func (s *Service) sendResend(ctx context.Context, cfg Config, to, subject, body string) error {
	if !cfg.Enabled || cfg.ResendAPIKey == "" || cfg.ResendFrom == "" {
		return fmt.Errorf("Resend 未启用或配置不完整")
	}
	to = strings.TrimSpace(to)
	if to == "" {
		return fmt.Errorf("收件人为空")
	}
	payload := map[string]interface{}{
		"from":    cfg.ResendFrom,
		"to":      []string{to},
		"subject": subject,
		"text":    body,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.ResendAPIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "StarAI/1.0")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return fmt.Errorf("Resend 发送失败：HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
}

func sendTLS(addr, host string, auth smtp.Auth, from string, to []string, msg []byte) error {
	tlsCfg := &tls.Config{ServerName: host}
	conn, err := tls.Dial("tcp", addr, tlsCfg)
	if err != nil {
		return err
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()
	if auth != nil {
		if err = client.Auth(auth); err != nil {
			return err
		}
	}
	fromAddr := extractEmail(from)
	if err = client.Mail(fromAddr); err != nil {
		return err
	}
	for _, rcpt := range to {
		if err = client.Rcpt(rcpt); err != nil {
			return err
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err = w.Write(msg); err != nil {
		return err
	}
	if err = w.Close(); err != nil {
		return err
	}
	return client.Quit()
}

// buildMessage assembles an RFC-compliant message: non-ASCII headers are
// RFC 2047 encoded and the body is base64 — QQ/163 reject raw UTF-8 headers
// with "502 Invalid input".
func buildMessage(from, to, subject, body string) []byte {
	fromName, fromAddr := splitAddress(from)
	fromHeader := fmt.Sprintf("<%s>", fromAddr)
	if fromName != "" {
		fromHeader = fmt.Sprintf("%s <%s>", mime.BEncoding.Encode("UTF-8", fromName), fromAddr)
	}
	headers := []string{
		fmt.Sprintf("From: %s", fromHeader),
		fmt.Sprintf("To: <%s>", extractEmail(to)),
		fmt.Sprintf("Subject: %s", mime.BEncoding.Encode("UTF-8", subject)),
		fmt.Sprintf("Date: %s", time.Now().Format(time.RFC1123Z)),
		fmt.Sprintf("Message-ID: <%s@%s>", randomID(), domainOf(fromAddr)),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
	}
	return []byte(strings.Join(headers, "\r\n") + "\r\n\r\n" + wrapBase64(body) + "\r\n")
}

// splitAddress parses `Name <addr>` or a bare address.
func splitAddress(s string) (name, addr string) {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "<"); i >= 0 {
		if j := strings.Index(s, ">"); j > i {
			return strings.TrimSpace(s[:i]), strings.TrimSpace(s[i+1 : j])
		}
	}
	return "", s
}

func wrapBase64(body string) string {
	enc := base64.StdEncoding.EncodeToString([]byte(body))
	var b strings.Builder
	for len(enc) > 76 {
		b.WriteString(enc[:76] + "\r\n")
		enc = enc[76:]
	}
	b.WriteString(enc)
	return b.String()
}

func randomID() string {
	buf := make([]byte, 12)
	rand.Read(buf)
	return hex.EncodeToString(buf)
}

func domainOf(addr string) string {
	if i := strings.LastIndex(addr, "@"); i >= 0 && i+1 < len(addr) {
		return addr[i+1:]
	}
	return "localhost"
}

func extractEmail(s string) string {
	if i := strings.Index(s, "<"); i >= 0 {
		if j := strings.Index(s, ">"); j > i {
			return s[i+1 : j]
		}
	}
	return strings.TrimSpace(s)
}
