package main

import (
	"math"
	"strconv"
	"strings"
)

func comicGenderFromText(values ...string) string {
	text := strings.ToLower(strings.Join(values, " "))
	for _, token := range []string{"female", "woman", "girl", "女性", "女人", "女孩", "女生", "女主", "女声"} {
		if strings.Contains(text, token) {
			return "female"
		}
	}
	for _, token := range []string{"male", "man", "boy", "男性", "男人", "男孩", "男生", "男主", "男声"} {
		if strings.Contains(text, token) {
			return "male"
		}
	}
	return "neutral"
}

func applyComicSpeakerMetadata(plan map[string]interface{}, storyboards []map[string]interface{}) {
	characters := map[string]map[string]interface{}{}
	for _, raw := range comicCollection(plan["characters"]) {
		character, _ := raw.(map[string]interface{})
		if character == nil || stringAny(character["code"]) == "" {
			continue
		}
		gender := comicGenderFromText(stringAny(character["gender"]), stringAny(character["description"]), stringAny(character["visual_prompt"]), stringAny(character["name"]))
		character["gender"] = gender
		characters[stringAny(character["code"])] = character
	}
	for _, storyboard := range storyboards {
		codes := comicCollection(storyboard["character_codes"])
		voiceCode := stringAny(storyboard["speaker_code"])
		if voiceCode == "" && len(codes) == 1 {
			voiceCode = stringAny(codes[0])
			if stringAny(storyboard["dialogue"]) != "" {
				storyboard["speaker_code"] = voiceCode
			}
		}
		if voiceCode != "" {
			storyboard["voice_character_code"] = voiceCode
			if character := characters[voiceCode]; character != nil {
				storyboard["speaker_gender"] = character["gender"]
			}
		}
	}
}

func comicStoryboardVoiceGender(storyboard map[string]interface{}) string {
	gender := comicGenderFromText(stringAny(storyboard["speaker_gender"]))
	if gender != "neutral" {
		return gender
	}
	return comicGenderFromText(stringAny(storyboard["video_prompt"]), stringAny(storyboard["keyframe_prompt"]), stringAny(storyboard["scene"]))
}

func comicVoiceRequirement(gender, speechType string) string {
	role := "旁白"
	if speechType == "dialogue" {
		role = "画面中正在说话的角色"
	}
	switch gender {
	case "male":
		return "使用与" + role + "一致的自然男性声音；禁止女声、童声和多人重叠播报。"
	case "female":
		return "使用与" + role + "一致的自然女性声音；禁止男声、童声和多人重叠播报。"
	default:
		return "使用单一、自然且与" + role + "身份一致的声音，禁止多人重叠播报。"
	}
}

func comicVoiceForGender(schema map[string]interface{}, gender string) (string, string, bool) {
	if gender != "male" && gender != "female" {
		return "", "", false
	}
	properties, _ := schema["properties"].(map[string]interface{})
	for _, key := range []string{"voice", "voice_id"} {
		property, _ := properties[key].(map[string]interface{})
		if property == nil {
			continue
		}
		labels, _ := property["enumLabels"].(map[string]interface{})
		genders, _ := property["x-option-genders"].(map[string]interface{})
		preferred, _ := property["x-agent-default-by-gender"].(map[string]interface{})
		if value := stringAny(preferred[gender]); value != "" {
			return key, value, true
		}
		for _, raw := range comicCollection(property["enum"]) {
			value := stringAny(raw)
			optionGender := strings.ToLower(stringAny(genders[value]))
			if optionGender == "" {
				optionGender = comicGenderFromText(value, stringAny(labels[value]))
			}
			if optionGender == gender {
				return key, value, true
			}
		}
	}
	return "", "", false
}

func comicVideoCheckpointCompatible(item map[string]interface{}, modelCode, aspect, referenceImageURL, prompt string) bool {
	return stringAny(item["video_url"]) != "" &&
		stringAny(item["status"]) != "failed" &&
		stringAny(item["model_code"]) == modelCode &&
		comicWorkerAspectRatio(stringAny(item["aspect_ratio"])) == aspect &&
		stringAny(item["reference_image_url"]) == referenceImageURL &&
		firstNonEmpty(stringAny(item["source_prompt"]), stringAny(item["prompt"])) == prompt
}

func comicAudioCheckpointCompatible(item map[string]interface{}, modelCode, gender, voice, speechText string) bool {
	return stringAny(item["audio_url"]) != "" &&
		stringAny(item["status"]) != "failed" &&
		stringAny(item["model_code"]) == modelCode &&
		stringAny(item["speaker_gender"]) == gender &&
		stringAny(item["voice"]) == voice &&
		stringAny(item["dialogue"]) == speechText
}

func comicTargetDimensions(sourceWidth, sourceHeight int, aspect string) (int, int) {
	parts := strings.Split(aspect, ":")
	if len(parts) != 2 {
		return evenDimension(sourceWidth), evenDimension(sourceHeight)
	}
	ratioWidth, widthErr := strconv.ParseFloat(parts[0], 64)
	ratioHeight, heightErr := strconv.ParseFloat(parts[1], 64)
	if widthErr != nil || heightErr != nil || ratioWidth <= 0 || ratioHeight <= 0 {
		return evenDimension(sourceWidth), evenDimension(sourceHeight)
	}
	longSide := math.Max(float64(sourceWidth), float64(sourceHeight))
	width, height := longSide, longSide
	if ratioWidth >= ratioHeight {
		height = longSide * ratioHeight / ratioWidth
	} else {
		width = longSide * ratioWidth / ratioHeight
	}
	return evenDimension(int(math.Round(width))), evenDimension(int(math.Round(height)))
}

func evenDimension(value int) int {
	if value < 2 {
		return 2
	}
	return value / 2 * 2
}
