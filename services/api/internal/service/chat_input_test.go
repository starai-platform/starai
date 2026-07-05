package service

import "testing"

func TestCompletionInputModelIdentifier(t *testing.T) {
	tests := []struct {
		name string
		in   CompletionInput
		want string
	}{
		{
			name: "model code has priority",
			in:   CompletionInput{Model: "upstream-model", ModelCode: "platform-code"},
			want: "platform-code",
		},
		{
			name: "openai compatible model fallback",
			in:   CompletionInput{Model: "deepseek-v4-flash"},
			want: "deepseek-v4-flash",
		},
		{
			name: "trim spaces",
			in:   CompletionInput{Model: "  deepseek-v4-flash  "},
			want: "deepseek-v4-flash",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.in.modelIdentifier(); got != tt.want {
				t.Fatalf("modelIdentifier()=%q, want %q", got, tt.want)
			}
		})
	}
}
