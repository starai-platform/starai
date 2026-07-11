package handler

import "testing"

func TestMockPaymentAllowed(t *testing.T) {
	tests := []struct {
		env  string
		want bool
	}{
		{"development", true},
		{" DEVELOPMENT ", true},
		{"local", true},
		{"test", true},
		{"production", false},
		{"staging", false},
		{"prodution", false},
		{"", false},
	}
	for _, tt := range tests {
		if got := mockPaymentAllowed(tt.env); got != tt.want {
			t.Errorf("mockPaymentAllowed(%q) = %v, want %v", tt.env, got, tt.want)
		}
	}
}
