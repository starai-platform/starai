package util

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

func NewPublicID(prefix string) string {
	return fmt.Sprintf("%s_%s", prefix, uuid.New().String()[:12])
}

func NewTaskNo() string {
	return fmt.Sprintf("task_%d_%s", time.Now().UnixMilli(), randomHex(4))
}

func NewRequestID() string {
	return fmt.Sprintf("req_%s", uuid.New().String())
}

func HashCardCode(code string) string {
	normalized := strings.TrimSpace(strings.ToUpper(code))
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
