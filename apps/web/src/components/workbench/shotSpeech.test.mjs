import assert from "node:assert/strict";
import test from "node:test";
import { shotSpeeches, speechContentSignature, needsLipSync, verifyShotSpeechPlan, syncTaskParams } from "./shotSpeech.ts";

const speech = (type = "dialogue", speaker = "A", text = "你好") => ({ speech_type: type, speaker_code: speaker, text });
test("narration and silent shots skip lip sync; dialogue targets its own shot", () => {
  const shots = [{ speeches: [speech("narration")] }, { speeches: [] }, { speeches: [speech()] }];
  const plan = shots.flatMap((shot, i) => shotSpeeches(shot, i + 1));
  assert.deepEqual(verifyShotSpeechPlan(shots, plan), [false, false, true]);
  assert.deepEqual(plan.map(item => item.segment_index), [1, 3]);
});
test("refuse legacy ambiguous speech, mixed speakers and changed text", () => {
  assert.throws(() => shotSpeeches({ voiceover: "你好" }, 1), /重新生成分镜/);
  assert.throws(() => needsLipSync([speech(), speech("dialogue", "B")]), /一个说话人/);
  assert.throws(() => needsLipSync([speech(), speech("narration")]), /旁白/);
  assert.throws(() => verifyShotSpeechPlan([{ speeches: [speech()] }], [{ ...speech("dialogue", "A", "改写"), segment_index: 1 }]), /不一致/);
  assert.throws(() => shotSpeeches({ speeches: [speech("unknown")] }, 1), /无效/);
});
test("speech timing fills the shot at a natural pace", () => {
  const text = "Today I am breaking down why Nvidia remains central to AI growth, what investors should watch next, and where the biggest risks may appear.";
  assert.equal(shotSpeeches({ speeches: [{ ...speech("dialogue", "HOST", text), start_sec: 0.3, end_sec: 9.2 }] }, 1, 10).length, 1);
  assert.throws(() => shotSpeeches({ speeches: [{ ...speech("dialogue", "HOST", "This is too short."), start_sec: 0, end_sec: 4.5 }] }, 1, 10), /85%-95%/);
  assert.throws(() => shotSpeeches({ speeches: [{ ...speech("dialogue", "HOST", "This line has no timing.") }] }, 1, 10), /start_sec\/end_sec/);
  assert.equal(shotSpeeches({ speech_fill_mode: "intentional_pause", speeches: [{ ...speech("dialogue", "HOST", "Short pause."), start_sec: 0, end_sec: 2 }] }, 1, 10).length, 1);
  assert.throws(() => shotSpeeches({ speech_fill_mode: "intentional_pause", speeches: [{ ...speech("dialogue", "HOST", "这是一段明显无法在一秒内以正常语速完成的台词，不能靠停顿标记跳过校验。"), start_sec: 0, end_sec: 1 }] }, 1, 8), /不能以 intentional_pause 绕过/);
});
test("speech signatures allow timing splits without allowing rewrites", () => {
  const original = [{ ...speech("dialogue", "HOST", "今天聊英伟达股票。后面继续看走势。"), segment_index: 1 }];
  const split = [
    { ...speech("dialogue", "HOST", "今天聊英伟达股票。"), segment_index: 1 },
    { ...speech("dialogue", "HOST", "后面继续看走势。"), segment_index: 2 },
  ];
  assert.equal(speechContentSignature(original), speechContentSignature(split));
  assert.notEqual(speechContentSignature(original), speechContentSignature([{ ...split[0], text: "今天聊别的股票。" }, split[1]]));
});

test("V2 speech checks the real speaking window and permits a complete shorter ending", () => {
  const original = "Review its filings, competitive position, valuation, and portfolio fit, then decide without chasing hype or short-term moves.";
  const shot = { speeches: [{ ...speech("dialogue", "HOST", original), start_sec: 0.4, end_sec: 7.6 }] };
  assert.equal(shotSpeeches(shot, 2, 8).length, 1); // This used to pass despite exceeding its speaking window.
  assert.throws(() => shotSpeeches(shot, 2, 8, true), /超出实际发声时间/);
  const shorter = { speeches: [{ ...speech("dialogue", "HOST", "Review Nvidia’s filings, valuation, and risks. Decide carefully, and avoid chasing short-term hype."), start_sec: 0.2, end_sec: 7 }] };
  assert.equal(shotSpeeches(shorter, 2, 8, true).length, 1);
  assert.equal(shotSpeeches({ speeches: [{ ...speech(), start_sec: 0.2, end_sec: 1.2 }] }, 1, 8, true).length, 1);
});
test("Sync gets the finalized audio and video, overriding stale defaults", () => {
  assert.deepEqual(syncTaskParams("video-final", "audio-final", 8, { input: [], duration: 1 }), {
    duration: 8, input: [{ type: "video", url: "video-final" }, { type: "audio", url: "audio-final" }],
  });
});
