package handler

import (
	"context"
	"reflect"
	"testing"
)

func TestUniqueModelCodesTrimsAndDeduplicates(t *testing.T) {
	got := uniqueModelCodes([]string{" model-a ", "", "model-b", "model-a", " model-b "})
	want := []string{"model-a", "model-b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("uniqueModelCodes() = %#v, want %#v", got, want)
	}
}

func TestValidateCustomCollabModelsRejectsInvalidCountsBeforeLookup(t *testing.T) {
	h := &Handler{}
	if _, _, err := h.validateCustomCollabModels(context.Background(), []string{"model-a"}, []string{"summary"}); err == nil {
		t.Fatal("expected too few answer models to be rejected")
	}
	if _, _, err := h.validateCustomCollabModels(context.Background(), []string{"model-a", "model-b"}, nil); err == nil {
		t.Fatal("expected missing summary model to be rejected")
	}
}
