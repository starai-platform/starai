// The same speech contract is used by original videos and reference remakes.
export type ShotSpeech = {
  segment_index: number;
  speaker_code: string;
  speech_type: "dialogue" | "narration" | "inner_monologue";
  text: string;
  start_sec?: number;
  end_sec?: number;
  caption?: string;
  caption_secondary?: string;
};

export const STORY_SPEECH_RULES = `声音与拍摄规则：人物实际张嘴说话才是 dialogue；旁白为 narration，内心独白为 inner_monologue。旁白或内心独白期间人物不做说话口型，人物对白期间明确说话人。同一角色使用稳定编号，旁白为 NARRATOR。除非用户明确要求沉默、长停顿或纯画面，含台词镜头的总发声时长默认覆盖本镜实际保留时长的85%-95%，台词字数按正常语速匹配，只留5%-15%用于自然起势和收尾，禁止用大段空白代替应有台词。保持角色、场景、动作、视角和结尾连续。不擅自把对白改成旁白，不把参考视频的原声自动当作待朗读台词。`;

export const STORY_PLANNING_INSTRUCTION = `${STORY_SPEECH_RULES}\n逐级审校：先检查上游内容是否符合当前时长、声音方式、视频模型单段时长、镜头数量及用户约束。已合规的文案、台词、人物关系和情节直接沿用，跳过重复润色，只补当前节点需要的内容；不合规时只修正冲突部分。可在不增加事实、不改变语义、说话人和声音类型的前提下拆句、合句、精简重复表达或补充简短连接语，并按每镜实际保留时长重新分配。文案阶段明确每句的说话人及声音类型，不必输出分镜JSON；脚本阶段将其落实到当前声音生成方式允许的镜头或时间段。素材段数量固定时在既定数量内重排，不靠超出数量或时长解决，也不静默删除台词。用户明确要求原文不变时逐字保留；约束确实无法兼容时明确指出冲突，不假装合规。参考图约束身份、外观与风格，参考视频约束用户指定的动作、构图和节奏，不编造未观察到的素材内容。只返回当前节点要求的正文，不附审校报告。`;

export const SHOT_SPEECH_INSTRUCTION = `${STORY_SPEECH_RULES}\n声音协议：每镜新增 speeches 数组，无声音填 []。每项包含 text（准确台词）、speaker_code（稳定角色编号，旁白为 NARRATOR）、speech_type（dialogue/narration/inner_monologue）、start_sec 和 end_sec（相对本镜起点的发声时间，互不重叠且不得超出本镜时长）、caption（与本段发声对应的主字幕）和 caption_secondary（可选第二语言字幕，无则空字符串）。speeches 是声音正文和字幕时间的唯一依据；voiceover 仅填旁白，dialogue 仅填对白，无对应声音时留空，其他字段不得出现与 speeches 矛盾的台词或说话口型。字幕按每段 start_sec/end_sec 跟随发声切换，不把整镜全文作为一条常驻字幕；画面口型和动作也必须跟随发声区间。只有用户明确要求长停顿时，当前镜头才可设置 speech_fill_mode 为 intentional_pause 并按用户要求安排，否则不要输出该字段。配音计划必须逐项沿用分镜的台词、类型和人物编号，不改写。`;

export function storySpeechInstruction(useAudioModel: boolean, structured = false, naturalTiming = false) {
  const mode = useAudioModel
    ? "当前采用独立配音与后期口型同步：每段送入口型同步的视频只能有一个对白说话人，不能混入旁白或内心独白；不同说话人及旁白需独立素材段。此限制仅适用于后期口型同步，不是通用拍摄规范。文案与脚本阶段就按可用素材段分配声音；只有1段且用户未明确要求混合声音时，选择一种声音来源贯穿，不自行创作旁白加对白再留给下游解决。"
    : "当前采用视频模型原生音轨，不进行后期口型同步：同一素材段允许旁白、内心独白和不同角色对白按时间先后出现。严格1项表示1段生成素材，不表示只能有1种声音或1个叙事镜头。speeches 按实际发声顺序记录全部原文，在 video_prompt 中标明每段声音的起止时间与说话人，互不重叠，旁白时人物不张嘴、对白时对应人物张嘴；允许按剧情切镜，但用户明确一镜到底时维持连续镜头。此规则覆盖旧脚本或模板中的通用“单镜单说话人、旁白对白必须拆段”要求，不因顺序旁白加对白要求增加数组项、删除台词或改写声音类型。";
  const instruction = structured ? SHOT_SPEECH_INSTRUCTION : STORY_PLANNING_INSTRUCTION;
  const rules = naturalTiming
    ? instruction.replace(STORY_SPEECH_RULES, "声音与拍摄规则：人物实际张嘴说话才是 dialogue；旁白为 narration，内心独白为 inner_monologue，旁白期间人物不做说话口型。说话人使用稳定编号。优先按自然语速完整说完每句，允许呼吸、句间停顿和闭口收尾，不设置必须说满的发声比例或字数下限。先按逐镜保守预算精简未锁定台词，结尾必须完整收束；不得为凑覆盖率扩写台词、加速朗读或截断尾音。保持人物、声音、场景和动作连续。")
    : instruction;
  return rules + "\n" + mode;
}

export function videoAudioInstruction(useAudioModel: boolean) {
  return useAudioModel
    ? "声音生成方式以本条为准：仅生成画面，配音由音频模型另行生成，禁止视频生成额外对白或旁白声音。对白镜头保留清晰人物表演供后续口型同步。"
    : "声音生成方式以本条为准，覆盖上文旧的静音或后期配音要求：由视频模型同时生成画面与原声音轨，按本镜 speeches/voiceover 的准确台词生成对白或旁白，人物对白与口型同步，旁白不让人物张嘴；无台词时仅按场景要求生成环境声，不虚构台词。不会另行配音或后期口型同步。";
}

export function estimateSpeechSeconds(text: string, naturalTiming = false) {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length || 0;
  const latinWords = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ")
    .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length || 0;
  const pauses = text.match(/[，,、；;：:。.!！？?]/g)?.length || 0;
  return cjk / (naturalTiming ? 3.5 : 4) + latinWords / (naturalTiming ? 2.2 : 2.5) + pauses * 0.1;
}

export function speechContentSignature(speeches: ShotSpeech[]) {
  const groups: Array<{ speaker_code: string; speech_type: ShotSpeech["speech_type"]; text: string }> = [];
  for (const speech of speeches) {
    const text = speech.text.replace(/\s+/gu, "");
    const last = groups.at(-1);
    if (last?.speaker_code === speech.speaker_code && last.speech_type === speech.speech_type) last.text += text;
    else groups.push({ speaker_code: speech.speaker_code, speech_type: speech.speech_type, text });
  }
  return JSON.stringify(groups);
}

export function shotSpeeches(shot: Record<string, unknown>, index: number, duration = 0, naturalTiming = false): ShotSpeech[] {
  if (!Array.isArray(shot.speeches)) {
    throw new Error(`第 ${index} 镜缺少结构化声音信息，请重新生成分镜以区分人物对白与旁白。`);
  }
  const speeches = shot.speeches.map((raw: unknown) => {
    const speech = raw as Record<string, unknown> | null;
    if (!speech || typeof speech.text !== "string" || !speech.text.trim()
      || typeof speech.speaker_code !== "string" || !speech.speaker_code.trim()
      || !["dialogue", "narration", "inner_monologue"].includes(String(speech.speech_type))) {
      throw new Error(`第 ${index} 镜的台词、说话人或声音类型无效，请修正分镜。`);
    }
    const start = Number(speech.start_sec);
    const end = Number(speech.end_sec);
    if (duration > 0 && (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration)) {
      throw new Error(`第 ${index} 镜的台词缺少有效 start_sec/end_sec，或发声时间超出 ${duration} 秒镜头。`);
    }
    return {
      segment_index: index,
      text: speech.text.trim(),
      speaker_code: speech.speaker_code.trim(),
      speech_type: speech.speech_type as ShotSpeech["speech_type"],
      ...(Number.isFinite(start) && Number.isFinite(end) ? { start_sec: start, end_sec: end } : {}),
      ...(typeof speech.caption === "string" ? { caption: speech.caption.trim() } : {}),
      ...(typeof speech.caption_secondary === "string" ? { caption_secondary: speech.caption_secondary.trim() } : {}),
    };
  });
  if (duration > 0 && speeches.length) {
    const ordered = [...speeches].sort((a, b) => Number(a.start_sec) - Number(b.start_sec));
    for (let i = 1; i < ordered.length; i++) {
      if (Number(ordered[i].start_sec) < Number(ordered[i - 1].end_sec)) throw new Error(`第 ${index} 镜的多段台词时间重叠，请顺序安排发声。`);
    }
    if (naturalTiming) {
      // Check the actual speaking window, not the full clip. Short sentences
      // and a natural ending do not need padding to pass a coverage threshold.
      if (speeches.some(item => estimateSpeechSeconds(item.text, true) > Number(item.end_sec) - Number(item.start_sec) + 0.1)) {
        throw new Error(`第 ${index} 镜台词超出实际发声时间，请精简未锁定台词并留出自然收尾，不得加速或裁断句尾。`);
      }
      return speeches;
    }
    if (shot.speech_fill_mode === "intentional_pause" && speeches.some(item => estimateSpeechSeconds(item.text) > (Number(item.end_sec) - Number(item.start_sec)) * 1.35 + 0.3)) {
      throw new Error(`第 ${index} 镜台词超出发声时间预算，不能以 intentional_pause 绕过正常语速限制。`);
    }
    if (shot.speech_fill_mode !== "intentional_pause") {
      const spoken = speeches.reduce((total, item) => total + Number(item.end_sec! - item.start_sec!), 0);
      const coverage = spoken / duration;
      if (coverage < 0.85 || coverage > 0.95) {
        throw new Error(`第 ${index} 镜台词发声时长应覆盖镜头的85%-95%，当前约 ${Math.round(coverage * 100)}%。`);
      }
      const estimated = speeches.reduce((total, item) => total + estimateSpeechSeconds(item.text), 0);
      if (estimated < duration * 0.8 || estimated > duration * 1.05) {
        throw new Error(`第 ${index} 镜台词按正常语速预计约 ${estimated.toFixed(1)} 秒，与 ${duration} 秒镜头不匹配，请调整台词字数。`);
      }
    }
  }
  return speeches;
}

export function needsLipSync(speeches: ShotSpeech[]): boolean {
  const dialogue = speeches.filter(item => item.speech_type === "dialogue");
  if (dialogue.length && (dialogue.length !== speeches.length || new Set(dialogue.map(item => item.speaker_code)).size !== 1)) {
    throw new Error("同一对白镜头只能有一个说话人，且不能混入旁白；请将不同说话人和旁白拆成独立镜头。");
  }
  return dialogue.length > 0;
}

export function verifyShotSpeechPlan(shots: Record<string, unknown>[], plan: ShotSpeech[]) {
  const expected = shots.flatMap((shot, index) => shotSpeeches(shot, index + 1));
  const key = (item: ShotSpeech) => JSON.stringify([item.segment_index, item.speech_type, item.speaker_code, item.text.trim()]);
  if (expected.length !== plan.length || expected.some((item, index) => key(item) !== key(plan[index]))) {
    throw new Error("配音计划与分镜台词不一致，请重新生成配音计划和配音后合成。");
  }
  return shots.map((_, index) => needsLipSync(plan.filter(item => item.segment_index === index + 1)));
}

export function syncTaskParams(videoURL: string, audioURL: string, duration: number, defaults: Record<string, unknown> = {}) {
  return { ...defaults, duration, input: [{ type: "video", url: videoURL }, { type: "audio", url: audioURL }] };
}
