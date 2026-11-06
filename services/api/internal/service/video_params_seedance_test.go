package service

import (
	"strings"
	"testing"
)

func TestValidateSeedance2InputCombinations(t *testing.T) {
	cfg := videoRuntimeConfig{
		UploadProfile:      "seedance_2",
		MaxReferenceImages: 9,
		FirstFrameKey:      "first_frame",
		LastFrameKey:       "last_frame",
		ReferenceImagesKey: "reference_images",
		ReferenceVideosKey: "reference_videos",
		MaxReferenceVideos: 3,
		ReferenceAudiosKey: "reference_audios",
		MaxReferenceAudios: 3,
		ModeParam:          "generation_mode",
	}
	tests := []struct {
		name    string
		params  map[string]interface{}
		wantErr string
	}{
		{
			name:   "text",
			params: map[string]interface{}{"generation_mode": "text", "prompt": "一只猫跑过街道"},
		},
		{
			name: "all multimodal",
			params: map[string]interface{}{
				"generation_mode":  "image_video_audio",
				"reference_images": []interface{}{"https://example.com/a.jpg"},
				"reference_videos": []interface{}{"https://example.com/a.mp4"},
				"reference_audios": []interface{}{"https://example.com/a.mp3"},
			},
		},
		{
			name: "authorized portrait can satisfy image input",
			params: map[string]interface{}{
				"generation_mode":     "image",
				"portrait_asset_id":   "asset://authorized-person",
				"portrait_asset_type": "image",
			},
		},
		{
			name: "portrait must use asset ID",
			params: map[string]interface{}{
				"generation_mode":     "image",
				"portrait_asset_id":   "https://example.com/person.jpg",
				"portrait_asset_type": "image",
			},
			wantErr: "asset://",
		},
		{
			name: "audio cannot stand alone",
			params: map[string]interface{}{
				"generation_mode":  "video_audio",
				"reference_audios": []interface{}{"https://example.com/a.mp3"},
			},
			wantErr: "同时上传视频和音频",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateVideoUpload(cfg, tt.params)
			if tt.wantErr == "" && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)) {
				t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestValidateMiniMaxH3InputCombinations(t *testing.T) {
	standard := videoRuntimeConfig{
		UploadProfile:      "minimax_h3",
		MaxReferenceImages: 9,
		MaxTotalImages:     9,
		FirstFrameKey:      "first_frame",
		LastFrameKey:       "last_frame",
		ReferenceImagesKey: "reference_images",
		ReferenceVideosKey: "reference_videos",
		MaxReferenceVideos: 3,
		ReferenceAudiosKey: "reference_audios",
		MaxReferenceAudios: 3,
		ModeParam:          "generation_mode",
	}
	tests := []struct {
		name    string
		params  map[string]interface{}
		wantErr string
	}{
		{name: "text", params: map[string]interface{}{"generation_mode": "text", "prompt": "海边日落"}},
		{name: "last frame", params: map[string]interface{}{"generation_mode": "last_frame", "prompt": "镜头靠近", "last_frame": "https://example.com/last.jpg"}},
		{name: "multimodal", params: map[string]interface{}{
			"generation_mode":                  "reference",
			"prompt":                           "保持主体并跟随音乐运动",
			"reference_images":                 []interface{}{"https://example.com/ref.jpg"},
			"reference_videos":                 []interface{}{"https://example.com/ref.mp4"},
			"reference_audios":                 []interface{}{"https://example.com/ref.mp3"},
			"reference_video_duration_seconds": float64(12),
		}},
		{name: "prompt required", params: map[string]interface{}{"generation_mode": "text"}, wantErr: "提示词"},
		{name: "first frame required", params: map[string]interface{}{"generation_mode": "first_frame", "prompt": "运动"}, wantErr: "1 张首帧"},
		{name: "cannot mix frames", params: map[string]interface{}{
			"generation_mode": "reference", "prompt": "运动",
			"first_frame":      "https://example.com/first.jpg",
			"reference_images": []interface{}{"https://example.com/ref.jpg"},
		}, wantErr: "不能与首尾帧混用"},
		{name: "input video duration limit", params: map[string]interface{}{
			"generation_mode": "reference", "prompt": "运动",
			"reference_videos":                 []interface{}{"https://example.com/ref.mp4"},
			"reference_video_duration_seconds": float64(16),
		}, wantErr: "0～15 秒"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateVideoUpload(standard, tt.params)
			if tt.wantErr == "" && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)) {
				t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}

	maxModel := standard
	maxModel.MaxReferenceImages = 0
	maxModel.MaxReferenceVideos = 0
	maxModel.MaxReferenceAudios = 0
	err := validateVideoUpload(maxModel, map[string]interface{}{
		"generation_mode": "reference", "prompt": "运动",
	})
	if err == nil || !strings.Contains(err.Error(), "不支持多模态参考") {
		t.Fatalf("H3-Max reference mode error = %v", err)
	}
}

func TestValidateVideoParamsPreservesProviderDurationEnumType(t *testing.T) {
	veo := &ModelFull{ModelDTO: ModelDTO{
		InputSchema: map[string]interface{}{
			"properties": map[string]interface{}{
				"duration": map[string]interface{}{"enum": []interface{}{"4s", "8s", "12s"}},
			},
		},
	}}
	veoParams := map[string]interface{}{"duration": float64(4)}
	if err := ValidateVideoParams(veo, veoParams); err != nil {
		t.Fatalf("Veo equivalent duration should be normalized: %v", err)
	}
	if got := veoParams["duration"]; got != "4s" {
		t.Fatalf("Veo duration=%#v, want string 4s", got)
	}

	seedance := &ModelFull{ModelDTO: ModelDTO{
		InputSchema: map[string]interface{}{
			"properties": map[string]interface{}{
				"duration": map[string]interface{}{"enum": []interface{}{float64(5), float64(8), float64(10)}},
			},
		},
	}}
	seedanceParams := map[string]interface{}{"duration": "8s"}
	if err := ValidateVideoParams(seedance, seedanceParams); err != nil {
		t.Fatalf("Seedance equivalent duration should be normalized: %v", err)
	}
	if got := seedanceParams["duration"]; got != float64(8) {
		t.Fatalf("Seedance duration=%#v, want numeric 8", got)
	}
}

func TestValidateAliyunMultimodalRejectsMixedFrameAndReferenceModes(t *testing.T) {
	model := &ModelFull{ModelDTO: ModelDTO{
		InputSchema: map[string]interface{}{"properties": map[string]interface{}{
			"generation_mode": map[string]interface{}{"enum": []interface{}{"text", "first_frame", "first_last", "reference"}},
		}},
	}, RuntimeRule: map[string]interface{}{"video": map[string]interface{}{
		"upload_profile": "aliyun_multimodal", "mode_param": "generation_mode",
		"max_reference_images": float64(10), "max_total_images": float64(20),
		"reference_images": map[string]interface{}{"key": "reference_images", "max": float64(10)},
		"reference_videos": map[string]interface{}{"key": "reference_videos", "max": float64(5)},
		"reference_audios": map[string]interface{}{"key": "reference_audios", "max": float64(5)},
	}}}
	params := map[string]interface{}{
		"generation_mode": "reference", "prompt": "参考素材",
		"first_frame":      "https://example.com/first.png",
		"reference_images": []interface{}{"https://example.com/ref.png"},
	}
	if err := ValidateVideoParams(model, params); err == nil {
		t.Fatal("expected mixed first-frame and reference media to be rejected")
	}
}

func TestValidateHappyHorseProfiles(t *testing.T) {
	baseVideo := map[string]interface{}{
		"reference_images": map[string]interface{}{"key": "reference_images", "max": float64(9)},
		"reference_videos": map[string]interface{}{"key": "reference_videos", "max": float64(1)},
	}
	modelFor := func(profile string) *ModelFull {
		video := map[string]interface{}{}
		for key, value := range baseVideo {
			video[key] = value
		}
		video["upload_profile"] = profile
		return &ModelFull{RuntimeRule: map[string]interface{}{"video": video}}
	}
	if err := ValidateVideoParams(modelFor("aliyun_happyhorse_first_frame"), map[string]interface{}{"first_frame": "https://example.com/first.png"}); err != nil {
		t.Fatalf("valid first-frame request rejected: %v", err)
	}
	if err := ValidateVideoParams(modelFor("aliyun_happyhorse_reference"), map[string]interface{}{"prompt": "[Image 1] starts walking", "reference_images": []interface{}{"https://example.com/ref.png"}}); err != nil {
		t.Fatalf("valid reference request rejected: %v", err)
	}
	if err := ValidateVideoParams(modelFor("aliyun_happyhorse_edit"), map[string]interface{}{"prompt": "change the coat", "reference_videos": []interface{}{"https://example.com/input.mp4"}}); err != nil {
		t.Fatalf("valid edit request rejected: %v", err)
	}
	if err := ValidateVideoParams(modelFor("aliyun_happyhorse_edit"), map[string]interface{}{"prompt": "change the coat"}); err == nil {
		t.Fatal("video edit without an input video must be rejected")
	}
}

func TestValidateAliyunQwenImageOfficialLimits(t *testing.T) {
	model := &ModelFull{RuntimeRule: map[string]interface{}{"upstream": map[string]interface{}{"adapter": "aliyun_qwen_image_v3"}}}
	valid := map[string]interface{}{"prompt": "生成海报", "count": float64(6), "size": "1024*2048"}
	if err := validateImageTaskParams(model, valid); err != nil {
		t.Fatalf("valid Qwen Image request rejected: %v", err)
	}
	for name, params := range map[string]map[string]interface{}{
		"count": {"prompt": "生成海报", "count": float64(7)},
		"size":  {"prompt": "生成海报", "size": "4096*4096"},
		"ratio": {"prompt": "生成海报", "size": "4096*256"},
		"seed":  {"prompt": "生成海报", "seed": float64(2147483648)},
	} {
		if err := validateImageTaskParams(model, params); err == nil {
			t.Fatalf("%s outside official limits must be rejected", name)
		}
	}
}

func TestValidateVeoReferenceModes(t *testing.T) {
	cfg := videoRuntimeConfig{
		UploadProfile:      "veo_reference",
		MaxReferenceImages: 3,
		ReferenceImagesKey: "reference_images",
		ModeParam:          "generation_mode",
	}
	tests := []struct {
		name    string
		params  map[string]interface{}
		wantErr string
	}{
		{
			name:   "text",
			params: map[string]interface{}{"generation_mode": "text", "prompt": "海边日落"},
		},
		{
			name: "reference",
			params: map[string]interface{}{
				"generation_mode":  "reference",
				"prompt":           "让画面产生自然运动",
				"reference_images": []interface{}{"https://example.com/a.jpg"},
			},
		},
		{
			name:    "reference requires image",
			params:  map[string]interface{}{"generation_mode": "reference", "prompt": "animate"},
			wantErr: "至少需要 1 张",
		},
		{
			name: "reference max three",
			params: map[string]interface{}{
				"generation_mode": "reference",
				"reference_images": []interface{}{
					"https://example.com/1.jpg",
					"https://example.com/2.jpg",
					"https://example.com/3.jpg",
					"https://example.com/4.jpg",
				},
			},
			wantErr: "最多支持 3 张",
		},
		{
			name:    "unsupported mode",
			params:  map[string]interface{}{"generation_mode": "first_last", "prompt": "animate"},
			wantErr: "仅支持文生或参考图",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateVideoUpload(cfg, tt.params)
			if tt.wantErr == "" && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)) {
				t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestValidateOmniReferenceModes(t *testing.T) {
	cfg := videoRuntimeConfig{
		UploadProfile:      "omni_reference",
		MaxReferenceImages: 7,
		ReferenceImagesKey: "reference_images",
		ModeParam:          "generation_mode",
	}
	seven := []interface{}{
		"https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg",
		"https://example.com/4.jpg", "https://example.com/5.jpg", "https://example.com/6.jpg",
		"https://example.com/7.jpg",
	}
	if err := validateVideoUpload(cfg, map[string]interface{}{
		"generation_mode": "reference", "reference_images": seven,
	}); err != nil {
		t.Fatalf("seven Omni references should be valid: %v", err)
	}
	tooMany := append(append([]interface{}{}, seven...), "https://example.com/8.jpg")
	err := validateVideoUpload(cfg, map[string]interface{}{
		"generation_mode": "reference", "reference_images": tooMany,
	})
	if err == nil || !strings.Contains(err.Error(), "最多支持 7 张") {
		t.Fatalf("error = %v, want Omni seven-image limit", err)
	}
	err = validateVideoUpload(cfg, map[string]interface{}{"generation_mode": "first_last"})
	if err == nil || !strings.Contains(err.Error(), "暂不支持首尾帧") {
		t.Fatalf("error = %v, want first/last rejection", err)
	}
}

func TestValidateOmniFrameTemplateContract(t *testing.T) {
	model := &ModelFull{NewAPIModel: "omni_flash-10s-fl", RuntimeRule: map[string]interface{}{
		"video":    map[string]interface{}{"upload_profile": "veo_frame_pair", "max_reference_images": 0},
		"upstream": map[string]interface{}{"adapter": "omni_frame_pair_v1"},
	}}
	for _, test := range []struct {
		name    string
		extra   map[string]interface{}
		invalid bool
	}{
		{"first only", nil, false},
		{"ordered pair", map[string]interface{}{"last_frame": "https://e.test/last.png"}, false},
		{"missing first", map[string]interface{}{"first_frame": ""}, true},
		{"multiple first images", map[string]interface{}{"first_frame": []string{"one", "two"}}, true},
		{"blank prompt", map[string]interface{}{"prompt": " "}, true},
		{"mixed references", map[string]interface{}{"reference_images": []string{"https://e.test/ref.png"}}, true},
		{"video unsupported", map[string]interface{}{"reference_videos": []string{"https://e.test/ref.mp4"}}, true},
		{"gateway alias", map[string]interface{}{"first_last_frame": true}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			params := map[string]interface{}{"prompt": "test", "first_frame": "https://e.test/first.png"}
			for key, value := range test.extra {
				params[key] = value
			}
			if err := ValidateVideoParams(model, params); (err != nil) != test.invalid {
				t.Fatalf("invalid=%v, error=%v", test.invalid, err)
			}
		})
	}
	model.NewAPIModel = "omni_flash-10s"
	if err := ValidateVideoParams(model, map[string]interface{}{"prompt": "test", "first_frame": "https://e.test/first.png"}); err == nil {
		t.Fatal("frame adapter must not silently use the reference model")
	}
}

func TestValidateVeoFramePairRejectsReferenceImages(t *testing.T) {
	cfg := videoRuntimeConfig{
		UploadProfile:      "veo_frame_pair",
		FirstFrameKey:      "first_frame",
		LastFrameKey:       "last_frame",
		ReferenceImagesKey: "reference_images",
	}
	if err := validateVideoUpload(cfg, map[string]interface{}{
		"first_frame": "https://example.com/first.jpg",
	}); err != nil {
		t.Fatalf("first-frame-only request should be valid: %v", err)
	}
	if err := validateVideoUpload(cfg, map[string]interface{}{
		"first_frame": "https://example.com/first.jpg",
		"last_frame":  "https://example.com/last.jpg",
	}); err != nil {
		t.Fatalf("first/last-frame request should be valid: %v", err)
	}
	err := validateVideoUpload(cfg, map[string]interface{}{
		"first_frame":      "https://example.com/first.jpg",
		"reference_images": []interface{}{"https://example.com/reference.jpg"},
	})
	if err == nil || !strings.Contains(err.Error(), "不支持参考图") {
		t.Fatalf("error = %v, want reference-image rejection", err)
	}
	err = validateVideoUpload(cfg, map[string]interface{}{})
	if err == nil || !strings.Contains(err.Error(), "首帧") {
		t.Fatalf("error = %v, want required first frame", err)
	}
}

func TestValidateSingleReferenceRequiresConfiguredImage(t *testing.T) {
	cfg := videoRuntimeConfig{
		UploadProfile:      "single_ref",
		MinReferenceImages: 1,
		MaxReferenceImages: 1,
		ReferenceImagesKey: "reference_images",
	}
	err := validateVideoUpload(cfg, map[string]interface{}{"prompt": "让画面动起来"})
	if err == nil || !strings.Contains(err.Error(), "至少需要 1 张") {
		t.Fatalf("error = %v, want required reference image", err)
	}
}
