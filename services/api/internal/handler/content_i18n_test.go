package handler

import "testing"

func TestTranslationPlaceholders(t *testing.T) {
	for _, tc := range []struct {
		source, value string
		want          bool
	}{
		{"你好 {name}，共 {count} 项", "{count} items for {name}", true},
		{"你好 {name}", "Hello", false},
		{"你好 {name}", "Hello {nombre}", false},
		{"{name} 和 {name}", "{name}", true},
		{"你好", "Hello {extra}", false},
		{"你好", "  ", false},
		{"使用 JSON {\"a\":1}", "Use JSON {\"a\":1}", true},
	} {
		if got := validTranslationPlaceholders(tc.source, tc.value); got != tc.want {
			t.Errorf("validTranslationPlaceholders(%q, %q)=%v", tc.source, tc.value, got)
		}
	}
}
