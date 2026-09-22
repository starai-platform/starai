package service

import (
	"strings"
	"testing"
)

func TestNormalizeReferralNote(t *testing.T) {
	note, err := normalizeReferralNote("  重点客户  ")
	if err != nil || note != "重点客户" {
		t.Fatalf("unexpected normalized note %q, err=%v", note, err)
	}
	if _, err = normalizeReferralNote(strings.Repeat("备", 201)); err == nil {
		t.Fatal("expected notes longer than 200 characters to be rejected")
	}
}
