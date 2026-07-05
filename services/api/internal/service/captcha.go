package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/starai/api/internal/cache"
)

type CaptchaService struct {
	cache *cache.Client
}

func NewCaptchaService(cacheClient *cache.Client) *CaptchaService {
	return &CaptchaService{cache: cacheClient}
}

type CaptchaResult struct {
	ID       string `json:"id"`
	ImageSVG string `json:"image_svg"`
}

const captchaChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func (s *CaptchaService) Generate(ctx context.Context) (*CaptchaResult, error) {
	code := randomCaptchaCode(4)
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	id := hex.EncodeToString(buf)
	if err := s.cache.SetTemp(ctx, "captcha:"+id, strings.ToLower(code), 5*time.Minute); err != nil {
		return nil, err
	}
	return &CaptchaResult{ID: id, ImageSVG: captchaSVG(code)}, nil
}

func (s *CaptchaService) Verify(ctx context.Context, id, answer string) bool {
	if id == "" || answer == "" {
		return false
	}
	stored, ok := s.cache.GetDelTemp(ctx, "captcha:"+id)
	if !ok {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(stored), strings.TrimSpace(answer))
}

func randomCaptchaCode(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		idx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(captchaChars))))
		b.WriteByte(captchaChars[idx.Int64()])
	}
	return b.String()
}

func captchaSVG(code string) string {
	// Simple inline SVG with noise lines — no external image dependency.
	lines := ""
	for i := 0; i < 6; i++ {
		x1, _ := rand.Int(rand.Reader, big.NewInt(120))
		y1, _ := rand.Int(rand.Reader, big.NewInt(40))
		x2, _ := rand.Int(rand.Reader, big.NewInt(120))
		y2, _ := rand.Int(rand.Reader, big.NewInt(40))
		lines += fmt.Sprintf(`<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#cbd5e1" stroke-width="1"/>`, x1.Int64(), y1.Int64(), x2.Int64(), y2.Int64())
	}
	chars := ""
	for i, ch := range code {
		x := 18 + i*24
		rot, _ := rand.Int(rand.Reader, big.NewInt(30))
		rot = rot.Sub(rot, big.NewInt(15))
		chars += fmt.Sprintf(`<text x="%d" y="28" font-size="22" font-family="monospace" font-weight="700" fill="#1f2937" transform="rotate(%d %d 28)">%c</text>`, x, rot.Int64(), x, ch)
	}
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#f8fafc" rx="6"/>%s%s</svg>`, lines, chars)
}
