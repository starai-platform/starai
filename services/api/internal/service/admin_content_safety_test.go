package service

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"
)

func TestParseBlockedTermsSupportsArrayAndEncodedJSON(t *testing.T) {
	want := []string{"alpha", "测试"}
	plain, _ := json.Marshal(want)
	if got := parseBlockedTerms(plain); !reflect.DeepEqual(got, want) {
		t.Fatalf("plain terms = %#v", got)
	}
	encoded, _ := json.Marshal(string(plain))
	if got := parseBlockedTerms(encoded); !reflect.DeepEqual(got, want) {
		t.Fatalf("encoded terms = %#v", got)
	}
}

func TestCollectStringValuesIgnoresObjectKeys(t *testing.T) {
	got := collectStringValues(map[string]interface{}{
		"forbidden-key": "safe value",
		"nested":        []interface{}{"first", map[string]interface{}{"x": "second"}},
	}, nil)
	want := []string{"safe value", "first", "second"}
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("values = %#v, want %#v", got, want)
	}
}
