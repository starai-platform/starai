package main

import (
	"context"
	"fmt"
	"math"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
	"unicode"
)

func composeSubtitleASS(cues []composeSubtitleCue, width, height int, style string) string {
	fontSize := math.Min(64, math.Max(10, float64(min(width, height))*0.047))
	marginH, marginV := width*8/100, height*8/100
	if height > width {
		marginV = height * 16 / 100
	}
	font := "Noto Sans CJK SC"
	if runtime.GOOS == "windows" {
		font = "Microsoft YaHei"
	}
	color, bold, border, outline, shadow := "&H00FFFFFF", 0, 1, fontSize*0.045, fontSize*0.025
	outlineColor := "&H40000000"
	switch style {
	case "soft_box":
		border, outline, shadow, outlineColor = 3, fontSize*0.20, 0, "&H850E1118"
	case "bold":
		color, bold, fontSize = "&H008AE8FF", -1, fontSize*1.12
		outline, shadow = fontSize*0.06, fontSize*0.04
	}
	var content strings.Builder
	fmt.Fprintf(&content, "[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n", width, height)
	content.WriteString("[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
	fmt.Fprintf(&content, "Style: Default,%s,%.1f,%s,&H00FFFFFF,%s,&H90000000,%d,0,0,0,100,100,0,0,%d,%.1f,%.1f,2,%d,%d,%d,1\n\n", font, fontSize, color, outlineColor, bold, border, outline, shadow, marginH, marginH, marginV)
	content.WriteString("[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
	for _, cue := range cues {
		// Fit legacy sentence pairs to at most roughly two lines per language.
		// ponytail: width estimate, not font shaping; libass performs final wrapping.
		size := subtitleFitSize(cue.Text, fontSize, float64(width-2*marginH))
		fade := min(80, int((cue.EndSec-cue.StartSec)*100))
		text := fmt.Sprintf("{\\fad(%d,%d)\\fs%.1f}%s", fade, fade, size, assText(cue.Text))
		if cue.SecondaryText != "" {
			secondarySize := subtitleFitSize(cue.SecondaryText, fontSize*0.72, float64(width-2*marginH))
			text += fmt.Sprintf("\\N{\\fs%.1f\\c&HDDDDDD&\\b0}%s", secondarySize, assText(cue.SecondaryText))
		}
		fmt.Fprintf(&content, "Dialogue: 0,%s,%s,Default,,0,0,0,,%s\n", assTime(cue.StartSec), assTime(cue.EndSec), text)
	}
	return content.String()
}

func subtitleFitSize(text string, size, width float64) float64 {
	units := 0.0
	for _, r := range text {
		if unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r) {
			units++
		} else {
			units += 0.55
		}
	}
	if units*size > width*1.8 {
		return math.Max(size*0.70, width*1.8/units)
	}
	return size
}

var subtitleSilencePattern = regexp.MustCompile(`silence_(start|end):\s*([0-9]+(?:\.[0-9]+)?)`)

func alignComposeSubtitleTiming(ctx context.Context, path string, cues []composeSubtitleCue) ([]composeSubtitleCue, bool) {
	if len(cues) == 0 {
		return cues, false
	}
	bin, err := ffmpegBinaryPath()
	if err != nil {
		return cues, false
	}
	child, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	output, err := exec.CommandContext(child, bin, "-hide_banner", "-nostats", "-i", path, "-vn", "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-").CombinedOutput()
	if err != nil {
		return cues, false
	}
	return subtitleBoundaryCues(cues, string(output))
}

func subtitleBoundaryCues(cues []composeSubtitleCue, silenceLog string) ([]composeSubtitleCue, bool) {
	var starts, ends []float64
	for _, match := range subtitleSilencePattern.FindAllStringSubmatch(silenceLog, -1) {
		value, err := strconv.ParseFloat(match[2], 64)
		if err != nil {
			continue
		}
		if match[1] == "start" {
			starts = append(starts, value)
		} else {
			ends = append(ends, value)
		}
	}
	nearest := func(value float64, candidates []float64) float64 {
		result, distance := value, 0.45
		for _, candidate := range candidates {
			if d := math.Abs(candidate - value); d < distance {
				result, distance = candidate, d
			}
		}
		return result
	}
	result := append([]composeSubtitleCue(nil), cues...)
	changed := false
	for i := 0; i < len(cues); {
		first := cues[i]
		j := i + 1
		for j < len(cues) && cues[j].SpeechStartSec == first.SpeechStartSec && cues[j].SpeechEndSec == first.SpeechEndSec {
			j++
		}
		start, end := first.SpeechStartSec, first.SpeechEndSec
		// Only tighten utterance boundaries. Never stretch subtitles into another
		// shot, and never treat silence detection as word-level transcription.
		if end > start && start <= first.StartSec && end >= cues[j-1].EndSec {
			newStart, newEnd := math.Max(start, nearest(start, ends)), math.Min(end, nearest(end, starts))
			if newEnd-newStart >= 0.6 && (newStart != start || newEnd != end) {
				for k := i; k < j; k++ {
					result[k].StartSec = newStart + (cues[k].StartSec-start)/(end-start)*(newEnd-newStart)
					result[k].EndSec = newStart + (cues[k].EndSec-start)/(end-start)*(newEnd-newStart)
				}
				changed = true
			}
		}
		i = j
	}
	return result, changed
}
