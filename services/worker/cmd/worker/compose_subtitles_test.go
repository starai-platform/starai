package main

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSubtitleBoundariesAndStyles(t *testing.T) {
	cues := []composeSubtitleCue{
		{StartSec: 0, EndSec: 2, Text: "人工智能正在改变市场", SecondaryText: "AI is reshaping the market.", SpeechEndSec: 4},
		{StartSec: 2, EndSec: 4, Text: "也在创造新的机会", SpeechEndSec: 4},
	}
	got, changed := subtitleBoundaryCues(cues, "silence_start: 0\nsilence_end: 0.3\nsilence_start: 3.7\nsilence_end: 4")
	if !changed || got[0].StartSec != 0.3 || got[1].EndSec != 3.7 || got[0].EndSec != got[1].StartSec {
		t.Fatalf("boundaries = %#v", got)
	}
	if cues[0].StartSec != 0 {
		t.Fatal("input mutated")
	}
	for _, log := range []string{"", "silence_end: 1.5\nsilence_start: 2.5"} {
		if _, changed := subtitleBoundaryCues(cues, log); changed {
			t.Fatal("unreliable silence changed timing")
		}
	}
	for _, style := range []string{"clean", "soft_box", "bold"} {
		ass := composeSubtitleASS(cues, 1080, 1920, style)
		if !strings.Contains(ass, `\N{\fs36.5\c&HDDDDDD&\b0}`) && style != "bold" {
			t.Fatalf("missing translation hierarchy: %s", ass)
		}
		if strings.Contains(ass, "%!") || !strings.Contains(ass, "WrapStyle: 0") {
			t.Fatalf("invalid ASS: %s", ass)
		}
	}
}

func TestSubtitleStyleBurnIn(t *testing.T) {
	if _, err := ffmpegBinaryPath(); err != nil {
		t.Skip(err)
	}
	ctx, dir := context.Background(), t.TempDir()
	source := filepath.Join(dir, "source.mp4")
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "color=c=0x344456:s=720x1280:d=2:r=12", "-c:v", "libx264", "-pix_fmt", "yuv420p", source); err != nil {
		t.Fatal(err)
	}
	cues := []composeSubtitleCue{{StartSec: 0, EndSec: 2, Text: "人工智能正在改变市场", SecondaryText: "AI is reshaping the market."}}
	for _, style := range []string{"clean", "soft_box", "bold"} {
		t.Run(style, func(t *testing.T) {
			dest := filepath.Join(dir, style)
			if err := os.MkdirAll(dest, 0700); err != nil {
				t.Fatal(err)
			}
			output, count, err := burnComposeSubtitles(ctx, dest, source, cues, style)
			if err != nil || count != 1 {
				t.Fatalf("burn: %v count %d", err, count)
			}
			// Optional local visual QA artifacts; normal test runs leave nothing behind.
			if preview := os.Getenv("SUBTITLE_PREVIEW_DIR"); preview != "" {
				if err := os.MkdirAll(preview, 0700); err != nil {
					t.Fatal(err)
				}
				if err := runFFmpeg(ctx, "-y", "-ss", "1", "-i", output, "-frames:v", "1", filepath.Join(preview, style+".png")); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
	if _, changed := alignComposeSubtitleTiming(ctx, source, cues); changed {
		t.Fatal("silent video without audio must fall back")
	}
	tone := filepath.Join(dir, "tone.wav")
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.4", "-af", "adelay=300:all=1,apad=pad_dur=0.3", tone); err != nil {
		t.Fatal(err)
	}
	adjusted, changed := alignComposeSubtitleTiming(ctx, tone, []composeSubtitleCue{{StartSec: 0, EndSec: 4, Text: "test", SpeechEndSec: 4}})
	if !changed || math.Abs(adjusted[0].StartSec-0.3) > 0.02 || math.Abs(adjusted[0].EndSec-3.7) > 0.02 {
		t.Fatalf("actual audio boundaries = %#v", adjusted)
	}
}
