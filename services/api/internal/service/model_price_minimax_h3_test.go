package service

import (
	"math"
	"testing"
)

func TestEstimateMiniMaxH3Cost(t *testing.T) {
	rule := map[string]interface{}{
		"billing_type":                "dynamic",
		"strategy":                    "minimax_h3_seconds",
		"default_resolution":          "2K",
		"default_input_video_seconds": float64(4),
		"free_reference_images":       float64(5),
		"excess_image_price":          float64(0.2),
		"points_per_cny":              float64(1),
		"platform_multiplier":         float64(1),
		"rates_per_second": map[string]interface{}{
			"2k":   float64(0.8),
			"768p": float64(0.5),
		},
	}

	tests := []struct {
		name   string
		params map[string]interface{}
		want   float64
	}{
		{
			name:   "2k output only",
			params: map[string]interface{}{"resolution": "2K", "duration": float64(5)},
			want:   4,
		},
		{
			name: "input video uses measured seconds",
			params: map[string]interface{}{
				"resolution": "2K", "duration": float64(5),
				"reference_videos":                 []interface{}{"https://example.com/ref.mp4"},
				"reference_video_duration_seconds": float64(8),
			},
			want: 10.4,
		},
		{
			name: "images over free allowance",
			params: map[string]interface{}{
				"resolution": "2K", "duration": float64(4),
				"reference_images": []interface{}{"1", "2", "3", "4", "5", "6", "7"},
			},
			want: 3.6,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := estimateDynamicCost(rule, tt.params)
			if math.Abs(got-tt.want) > 0.000001 {
				t.Fatalf("estimateDynamicCost() = %.6f, want %.6f", got, tt.want)
			}
		})
	}
}

func TestEstimateMiniMaxH3CostUsesActualUpstreamUsage(t *testing.T) {
	rule := map[string]interface{}{
		"billing_type":          "dynamic",
		"strategy":              "minimax_h3_seconds",
		"default_resolution":    "2K",
		"free_reference_images": float64(5),
		"excess_image_price":    float64(0.2),
		"rates_per_second":      map[string]interface{}{"2k": float64(0.8)},
	}
	params := map[string]interface{}{
		"resolution":                "2K",
		"duration":                  float64(5),
		"reference_videos":          []interface{}{"https://example.com/ref.mp4"},
		"reference_images":          []interface{}{"1"},
		"_actual_output_seconds":    float64(6),
		"_actual_input_seconds":     float64(9),
		"_actual_input_image_count": float64(8),
	}
	want := float64(15)*0.8 + float64(3)*0.2
	if got := estimateDynamicCost(rule, params); math.Abs(got-want) > 0.000001 {
		t.Fatalf("actual usage cost = %.6f, want %.6f", got, want)
	}
}

func TestEstimateMiniMaxH3MaxBillsInputsAtSeparateRates(t *testing.T) {
	rule := map[string]interface{}{
		"billing_type":          "dynamic",
		"strategy":              "minimax_h3_seconds",
		"default_resolution":    "480P",
		"free_reference_images": float64(0),
		"excess_image_price":    float64(0.5),
		"rates_per_second":      map[string]interface{}{"480p": float64(0.33)},
		"input_video_rates_per_second": map[string]interface{}{
			"480p": float64(0.37),
		},
	}
	params := map[string]interface{}{
		"resolution":                "480P",
		"duration":                  float64(5),
		"reference_videos":          []interface{}{"https://example.com/ref.mp4"},
		"_actual_input_seconds":     float64(12),
		"_actual_input_image_count": float64(9),
	}
	if got, want := estimateDynamicCost(rule, params), float64(5)*0.33+float64(12)*0.37+float64(9)*0.5; math.Abs(got-want) > 0.000001 {
		t.Fatalf("H3-Max cost = %.6f, want %.6f", got, want)
	}
}
