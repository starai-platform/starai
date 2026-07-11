"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, Boxes, Check, Clock3, Code2, Compass, Copy, Download, Headphones, ImageIcon, KeyRound, MessageCircle, Phone, Play, Sparkles, UserRound, Wand2, X } from "lucide-react";
import { siAlibabacloud, siAnthropic, siDeepseek, siFlux, siGooglegemini, siHuggingface, siKuaishou, type SimpleIcon } from "simple-icons";
import { LoginModal } from "@/components/LoginModal";
import { SiteBrand, useSiteBranding } from "@/components/SiteBrand";
import { UILanguageSelector } from "@/components/UILanguageSelector";
import { useI18n } from "@/i18n/I18nProvider";
import { api, hasUserSession } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

interface GalleryItem {
  public_id: string;
  title?: string;
  prompt?: string;
  cover_url?: string;
  media_url?: string;
  thumbnail_url?: string;
  type?: string;
  tags?: string[];
  is_featured?: boolean;
  like_count?: number;
}

const MODEL_LOGOS = ["GPT", "Claude", "Gemini", "Sora", "Flux", "Kling", "MJ", "Qwen", "DeepSeek", "Runway"];
type TickerLogo = { name: string; color: string; icon?: SimpleIcon; mark?: string; variant?: "ring" | "spark" | "rune" | "waves" };
const MODEL_TICKER: TickerLogo[] = [
  { name: "OpenAI", mark: "∞", color: "#10A37F", variant: "ring" },
  { name: "Claude", icon: siAnthropic, color: `#${siAnthropic.hex}` },
  { name: "Gemini", icon: siGooglegemini, color: `#${siGooglegemini.hex}` },
  { name: "DeepSeek", icon: siDeepseek, color: `#${siDeepseek.hex}` },
  { name: "Qwen", icon: siAlibabacloud, color: `#${siAlibabacloud.hex}` },
  { name: "Flux", icon: siFlux, color: `#${siFlux.hex}` },
  { name: "Kling", icon: siKuaishou, color: `#${siKuaishou.hex}` },
  { name: "Hugging Face", icon: siHuggingface, color: `#${siHuggingface.hex}` },
  { name: "Runway", mark: "R", color: "#00D8FF", variant: "waves" },
  { name: "Midjourney", mark: "M", color: "#F5F7FB", variant: "rune" },
  { name: "Stable Diffusion", mark: "S", color: "#2563EB", variant: "spark" },
  { name: "Pika", mark: "P", color: "#FF4FD8", variant: "spark" },
  { name: "Sora", mark: "S", color: "#F8FAFC", variant: "waves" },
  { name: "Luma", mark: "L", color: "#7DD3FC", variant: "spark" },
  { name: "Veo", mark: "V", color: "#34D399", variant: "ring" },
  { name: "MiniMax", mark: "M", color: "#A78BFA", variant: "rune" },
  { name: "Doubao", mark: "D", color: "#FB7185", variant: "spark" },
  { name: "GLM", mark: "G", color: "#60A5FA", variant: "ring" },
  { name: "PixVerse", mark: "P", color: "#F97316", variant: "waves" },
  { name: "Hailuo", mark: "H", color: "#FACC15", variant: "spark" },
  { name: "Grok", mark: "G", color: "#CBD5E1", variant: "rune" },
  { name: "Hunyuan", mark: "H", color: "#38BDF8", variant: "ring" },
  { name: "Ideogram", mark: "I", color: "#F472B6", variant: "spark" },
  { name: "Recraft", mark: "R", color: "#A3E635", variant: "waves" },
  { name: "Wanxiang", mark: "W", color: "#818CF8", variant: "spark" },
  { name: "Kimi", mark: "K", color: "#22D3EE", variant: "ring" },
  { name: "Mistral", mark: "M", color: "#F59E0B", variant: "rune" },
  { name: "Perplexity", mark: "P", color: "#14B8A6", variant: "waves" },
];

const FALLBACK_GALLERY: GalleryItem[] = [
  {
    public_id: "landing-1",
    title: "未来城市视觉提案",
    prompt: "霓虹高楼、雨夜街道、电影感构图、超清细节",
    tags: ["视觉设计", "建筑"],
    is_featured: true,
    like_count: 128,
  },
  {
    public_id: "landing-2",
    title: "产品海报自动生成",
    prompt: "高端科技产品、玻璃材质、商业广告光效",
    tags: ["电商", "海报"],
    like_count: 96,
  },
  {
    public_id: "landing-3",
    title: "短视频脚本分镜",
    prompt: "30 秒品牌短片，分镜、旁白、镜头运动完整输出",
    tags: ["视频", "脚本"],
    like_count: 74,
  },
  {
    public_id: "landing-4",
    title: "角色设定草案",
    prompt: "东方幻想角色，服饰设定，三视图参考，情绪板",
    tags: ["角色", "插画"],
    is_featured: true,
    like_count: 151,
  },
  {
    public_id: "landing-5",
    title: "API 文档示例生成",
    prompt: "把模型能力、参数、错误码整理成可复制文档",
    tags: ["开发者", "API"],
    like_count: 63,
  },
  {
    public_id: "landing-6",
    title: "音乐封面概念",
    prompt: "电子音乐封面，强节奏，抽象几何，暗色商业风",
    tags: ["音乐", "封面"],
    like_count: 88,
  },
];

function InteractiveHeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let idleFrames = 0;
    let animation = 0;
    let paused = false;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const isCompact = window.matchMedia?.("(max-width: 768px)")?.matches;
    const pointer = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.46, px: 0, py: 0, active: false };
    const waves: Array<{ x: number; y: number; r: number; life: number; hue: number }> = [];
    const meteors: Array<{ x: number; y: number; vx: number; vy: number; life: number; hue: number }> = [];
    const logos: Array<{ x: number; y: number; text: string; life: number; drift: number }> = [];
    const nodes = Array.from({ length: reduceMotion ? 18 : isCompact ? 34 : 76 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      r: Math.random() * 1.8 + 0.6,
    }));

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = Math.max(window.innerHeight, 720);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const addWave = (x: number, y: number) => {
      waves.push({ x, y, r: 5, life: 1, hue: Math.random() > 0.5 ? 164 : 218 });
      if (waves.length > 24) waves.shift();
    };

    const addMeteor = (x: number, y: number, dx: number, dy: number) => {
      const speed = Math.max(3, Math.min(16, Math.hypot(dx, dy) * 0.28));
      const len = Math.max(1, Math.hypot(dx, dy));
      meteors.push({ x, y, vx: (dx / len) * speed, vy: (dy / len) * speed, life: 1, hue: Math.random() > 0.5 ? 164 : 220 });
      if (meteors.length > 36) meteors.shift();
    };

    const addLogo = () => {
      logos.push({
        x: pointer.x + (Math.random() - 0.5) * 110,
        y: pointer.y + (Math.random() - 0.5) * 90,
        text: MODEL_LOGOS[Math.floor(Math.random() * MODEL_LOGOS.length)],
        life: 1,
        drift: Math.random() * 0.8 + 0.25,
      });
      if (logos.length > 8) logos.shift();
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.active = true;
      pointer.px = pointer.x;
      pointer.py = pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      idleFrames = 0;
      if (frame % 2 === 0) addWave(pointer.x, pointer.y);
      addMeteor(pointer.x, pointer.y, pointer.x - pointer.px, pointer.y - pointer.py);
    };

    const onPointerDown = (event: PointerEvent) => {
      for (let i = 0; i < 5; i++) {
        waves.push({ x: event.clientX, y: event.clientY, r: 12 + i * 15, life: 1, hue: i % 2 ? 164 : 218 });
      }
    };

    const drawGrid = () => {
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      const gap = 58;
      for (let x = (frame * 0.2) % gap; x < width; x += gap) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x - width * 0.22, height);
        ctx.stroke();
      }
      for (let y = (frame * 0.16) % gap; y < height; y += gap) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y - height * 0.14);
        ctx.stroke();
      }
      ctx.restore();
    };

    const draw = () => {
      if (paused) {
        animation = requestAnimationFrame(draw);
        return;
      }
      frame += 1;
      idleFrames += 1;
      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, "#071316");
      bg.addColorStop(0.34, "#120d22");
      bg.addColorStop(0.68, "#10111c");
      bg.addColorStop(1, "#152011");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      drawGrid();

      nodes.forEach((p, i) => {
        p.x += p.vx / width;
        p.y += p.vy / height;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
        const x = p.x * width;
        const y = p.y * height;
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const pull = Math.max(0, 1 - Math.hypot(dx, dy) / 260);
        ctx.beginPath();
        ctx.arc(x + dx * pull * 0.018, y + dy * pull * 0.018, p.r + pull * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${pull > 0 ? "18,214,163" : "115,138,255"},${0.28 + pull * 0.38})`;
        ctx.fill();
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const bx = b.x * width;
          const by = b.y * height;
          const dist = Math.hypot(x - bx, y - by);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(bx, by);
            ctx.strokeStyle = `rgba(90,125,255,${0.12 * (1 - dist / 120)})`;
            ctx.stroke();
          }
        }
      });

      waves.forEach((w, idx) => {
        w.r += 4.6;
        w.life -= 0.025;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${w.hue}, 92%, 62%, ${Math.max(0, w.life) * 0.38})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        if (w.life <= 0) waves.splice(idx, 1);
      });

      meteors.forEach((m, idx) => {
        m.x += m.vx;
        m.y += m.vy;
        m.life -= 0.035;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - m.vx * 4.5, m.y - m.vy * 4.5);
        ctx.strokeStyle = `hsla(${m.hue}, 94%, 66%, ${Math.max(0, m.life) * 0.7})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        if (m.life <= 0) meteors.splice(idx, 1);
      });

      if (pointer.active && idleFrames > 72 && frame % 52 === 0) addLogo();
      logos.forEach((logo, idx) => {
        logo.life -= 0.012;
        logo.y -= logo.drift;
        const alpha = Math.max(0, Math.min(1, logo.life));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = "600 13px Inter, ui-sans-serif, system-ui";
        const tw = ctx.measureText(logo.text).width + 24;
        ctx.fillStyle = "rgba(7, 12, 25, 0.74)";
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(logo.x - tw / 2, logo.y - 16, tw, 30, 15);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillText(logo.text, logo.x - tw / 2 + 12, logo.y + 4);
        ctx.restore();
        if (logo.life <= 0) logos.splice(idx, 1);
      });

      if (!reduceMotion) {
        animation = requestAnimationFrame(draw);
      }
    };

    const onVisibilityChange = () => {
      paused = document.hidden;
      if (!paused && !reduceMotion) {
        cancelAnimationFrame(animation);
        animation = requestAnimationFrame(draw);
      }
    };

    resize();
    paused = document.hidden;
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("visibilitychange", onVisibilityChange);
    draw();

    return () => {
      cancelAnimationFrame(animation);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-[max(100vh,720px)] w-full" />;
}

function AnimatedHeadline() {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const phrases = useMemo(
    () => [
      t("landing.hero.phrase1"),
      t("landing.hero.phrase2"),
      t("landing.hero.phrase3"),
      t("landing.hero.phrase4"),
    ],
    [t]
  );

  useEffect(() => {
    const phrase = phrases[index % phrases.length];
    const doneTyping = !deleting && text === phrase;
    const doneDeleting = deleting && text === "";
    const delay = doneTyping ? 1300 : deleting ? 34 : 72;
    const timer = window.setTimeout(() => {
      if (doneTyping) {
        setDeleting(true);
        return;
      }
      if (doneDeleting) {
        setDeleting(false);
        setIndex((v) => v + 1);
        return;
      }
      setText((current) => (deleting ? phrase.slice(0, Math.max(0, current.length - 1)) : phrase.slice(0, current.length + 1)));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [deleting, index, phrases, text]);

  return (
    <h1 className="max-w-5xl text-5xl font-black leading-[0.96] tracking-normal sm:text-7xl lg:text-8xl">
      {t("landing.titlePrefix")}
      <span className="mt-2 block min-h-[1.05em] text-primary">
        {t("landing.titleSuffix", { value: text })}
        <span className="ml-1 inline-block h-[0.78em] w-[0.08em] translate-y-[0.08em] animate-[landingBlink_1s_steps(2,end)_infinite] bg-primary" />
      </span>
    </h1>
  );
}

function ModelTickerLogo({ item }: { item: TickerLogo }) {
  if (item.icon) {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" role="img" aria-label={item.name}>
        <path d={item.icon.path} fill={item.color} />
      </svg>
    );
  }
  const glow = `0 0 18px ${item.color}66`;
  if (item.variant === "ring") {
    return (
      <span className="relative flex h-7 w-7 items-center justify-center" aria-label={item.name} role="img">
        <span className="absolute inset-0 rounded-full border-2 opacity-80" style={{ borderColor: item.color, boxShadow: glow }} />
        <span className="absolute h-3.5 w-3.5 rounded-full border-2 opacity-70" style={{ borderColor: item.color }} />
      </span>
    );
  }
  if (item.variant === "waves") {
    return (
      <span className="flex h-7 w-7 items-center justify-center gap-0.5" aria-label={item.name} role="img">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-5 w-1 rounded-full" style={{ background: item.color, opacity: 0.55 + i * 0.18, boxShadow: glow }} />
        ))}
      </span>
    );
  }
  return (
    <span
      className="flex h-7 min-w-7 items-center justify-center text-sm font-black tracking-normal"
      style={{ color: item.color, textShadow: glow }}
      aria-label={item.name}
      role="img"
    >
      {item.mark}
    </span>
  );
}

function ModelTicker() {
  const items = [...MODEL_TICKER, ...MODEL_TICKER];
  return (
    <div className="mt-9 w-full max-w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] py-3 backdrop-blur lg:hidden">
      <div className="flex w-max animate-[landingMarquee_26s_linear_infinite] items-center gap-3 px-3">
        {items.map((item, index) => (
          <span
            key={`${item.name}-${index}`}
            title={item.name}
            className="group flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:-translate-y-0.5 hover:border-primary/45 hover:bg-white/[0.14]"
          >
            <ModelTickerLogo item={item} />
          </span>
        ))}
      </div>
    </div>
  );
}

function OrbitTypewriter({ items, activeIndex, setActiveIndex }: { items: TickerLogo[]; activeIndex: number; setActiveIndex: Dispatch<SetStateAction<number>> }) {
  const [text, setText] = useState(items[0]?.name || "");
  const [deleting, setDeleting] = useState(false);
  const [visibleTick, setVisibleTick] = useState(0);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) setVisibleTick((value) => value + 1);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!items.length) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduceMotion) {
      setText(items[activeIndex]?.name || "");
      return;
    }
    if (document.hidden) return;
    const active = items[activeIndex % items.length];
    const name = active.name;
    const doneTyping = !deleting && text === name;
    const doneDeleting = deleting && text === "";
    const delay = doneTyping ? 2100 : deleting ? 58 : 118;
    const timer = window.setTimeout(() => {
      if (doneTyping) {
        setDeleting(true);
        return;
      }
      if (doneDeleting) {
        setDeleting(false);
        setActiveIndex((current) => {
          if (items.length <= 1) return current;
          let next = Math.floor(Math.random() * items.length);
          if (next === current) next = (next + 1) % items.length;
          return next;
        });
        return;
      }
      setText((current) => (deleting ? name.slice(0, Math.max(0, current.length - 1)) : name.slice(0, current.length + 1)));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeIndex, deleting, items, setActiveIndex, text, visibleTick]);

  const active = items[activeIndex % items.length] || items[0];
  if (!active) return null;

  return (
    <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center opacity-55 transition duration-500 group-hover/orbit:opacity-90">
      <div key={active.name} className="relative flex h-14 w-14 animate-[landingOrbitFocusIn_.65s_ease-out] items-center justify-center rounded-2xl bg-white/[0.025] text-white/70 shadow-[0_0_36px_rgba(18,214,163,.08)]">
        <span className="absolute inset-0 rounded-2xl bg-primary/5 blur-xl" />
        <span className="relative opacity-70 transition group-hover/orbit:opacity-100">
          <ModelTickerLogo item={active} />
        </span>
      </div>
      <div className="mt-3 min-h-[22px] max-w-[170px] truncate text-sm font-semibold tracking-normal text-white/58 transition group-hover/orbit:text-white">
        {text}
        <span className="ml-0.5 inline-block h-[1em] w-px translate-y-0.5 animate-[landingBlink_1s_steps(2,end)_infinite] bg-primary/70" />
      </div>
    </div>
  );
}

function ModelOrbit() {
  const items = MODEL_TICKER.slice(0, 24);
  const [activeIndex, setActiveIndex] = useState(0);
  return (
    <div className="group/orbit relative z-30 isolate hidden h-[620px] w-[620px] shrink-0 items-center justify-center overflow-visible transition duration-500 hover:scale-[1.025] lg:flex">
      <div className="absolute inset-28 rounded-full bg-primary/[0.025] blur-2xl" />
      <OrbitTypewriter items={items} activeIndex={activeIndex} setActiveIndex={setActiveIndex} />
      <div className="absolute left-1/2 top-1/2 z-20 h-0 w-0 animate-[landingOrbitSpin_46s_linear_infinite] overflow-visible motion-reduce:animate-none group-hover/orbit:[animation-play-state:paused]">
        {items.map((item, index) => {
          const angle = (360 / items.length) * index;
          const active = items[activeIndex % items.length];
          const isActive = item.name === active?.name;
          return (
            <div
              key={item.name}
              className="absolute left-0 top-0 hover:z-50"
              style={{ transform: `rotate(${angle}deg) translate(260px)`, transformOrigin: "0 0" }}
            >
              <div
                className="animate-[landingOrbitNodeSpin_46s_linear_infinite] motion-reduce:animate-none group-hover/orbit:[animation-play-state:paused]"
                style={{ "--start-angle": `-${angle}deg` } as CSSProperties}
              >
                {isActive ? (
                  <div className="invisible h-[64px] w-[68px]" aria-hidden="true" />
                ) : (
                  <div
                    className="group/node flex w-[68px] flex-col items-center gap-1.5 rounded-2xl border border-transparent bg-black/[0.06] px-1.5 py-2 opacity-30 backdrop-blur-sm transition duration-500 hover:scale-115 hover:border-primary/55 hover:bg-white/[0.105] hover:opacity-100 hover:shadow-[0_0_28px_rgba(18,214,163,.18)]"
                    title={item.name}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.015] opacity-42 transition group-hover/node:bg-black/25 group-hover/node:opacity-100">
                      <ModelTickerLogo item={item} />
                    </span>
                    <span className="w-full truncate text-center text-[10px] font-semibold text-white/12 transition group-hover/node:text-white">
                      {item.name}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type CustomerServiceConfig = ReturnType<typeof useSiteBranding>;

function CustomerService({ config }: { config: CustomerServiceConfig }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const enabledValue: unknown = config.customer_service_enabled;
  const enabled =
    enabledValue === undefined ||
    !(
      enabledValue === false ||
      enabledValue === 0 ||
      String(enabledValue).toLowerCase() === "false"
    );
  if (!enabled) return null;

  const title = config.customer_service_title || t("customerService.title");
  const name = config.customer_service_name || t("customerService.name");
  const subtitle = config.customer_service_subtitle || t("customerService.subtitle");
  const qrTip = config.customer_service_qr_tip || t("customerService.qrTip");
  const copyValue = async (label: string, value?: string) => {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  };
  const downloadQR = () => {
    if (!config.customer_service_qr_url) return;
    const link = document.createElement("a");
    link.href = config.customer_service_qr_url;
    link.download = "customer-service-qr";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.click();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("customerService.open")}
        className="group fixed bottom-5 right-4 z-[80] flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-[#071316]/95 p-1.5 text-primary shadow-[0_12px_36px_rgba(0,0,0,.42),0_0_24px_rgba(18,214,163,.16)] backdrop-blur-xl transition hover:-translate-y-1 hover:border-primary/55 sm:bottom-7 sm:right-7 sm:h-[72px] sm:w-[72px]"
      >
        {config.customer_service_floating_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.customer_service_floating_image} alt={name} className="h-full w-full rounded-xl object-contain" />
        ) : (
          <Headphones size={30} className="transition group-hover:scale-110" />
        )}
        <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#071316] bg-emerald-400" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("customerService.dialog")}
            className="max-h-[92vh] w-full overflow-y-auto rounded-t-[26px] border border-white/12 bg-[#15191f] text-white shadow-2xl sm:max-w-[390px] sm:rounded-[26px]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300"><Headphones size={21} /></div>
                <div>
                  <div className="text-lg font-bold">{title}</div>
                  <div className="text-xs text-white/45">{subtitle}</div>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-white/65 transition hover:bg-white/10 hover:text-white" aria-label={t("common.close")}>
                <X size={19} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.04] text-white/45">
                  {config.customer_service_avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={config.customer_service_avatar} alt={name} className="h-full w-full object-cover" />
                  ) : (
                    <UserRound size={25} />
                  )}
                </div>
                <div>
                  <div className="font-semibold">{name}</div>
                  <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-1 text-[11px] font-medium text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{t("customerService.online")}
                  </div>
                </div>
              </div>

              {config.customer_service_qr_url && (
                <div className="text-center">
                  <div className="mx-auto w-fit rounded-2xl bg-white p-2.5 shadow-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={config.customer_service_qr_url} alt="客服微信二维码" className="h-44 w-44 object-contain sm:h-48 sm:w-48" />
                  </div>
                  <div className="mt-2 text-xs text-white/35">{qrTip}</div>
                </div>
              )}

              <div className="space-y-2">
                {config.customer_service_phone && (
                  <button type="button" onClick={() => copyValue("phone", config.customer_service_phone)} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-left transition hover:bg-white/[0.07]">
                    <span className="flex items-center gap-3"><Phone size={18} className="text-sky-400" /><span><span className="block text-[11px] text-white/35">{t("customerService.phone")}</span><span className="text-sm font-semibold">{config.customer_service_phone}</span></span></span>
                    {copied === "phone" ? <Check size={17} className="text-emerald-400" /> : <Copy size={17} className="text-white/40" />}
                  </button>
                )}
                {config.customer_service_wechat && (
                  <button type="button" onClick={() => copyValue("wechat", config.customer_service_wechat)} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-left transition hover:bg-white/[0.07]">
                    <span className="flex items-center gap-3"><MessageCircle size={18} className="text-emerald-400" /><span><span className="block text-[11px] text-white/35">{t("customerService.wechat")}</span><span className="text-sm font-semibold">{config.customer_service_wechat}</span></span></span>
                    {copied === "wechat" ? <Check size={17} className="text-emerald-400" /> : <Copy size={17} className="text-white/40" />}
                  </button>
                )}
                {config.customer_service_hours && (
                  <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                    <Clock3 size={18} className="text-violet-400" />
                    <span><span className="block text-[11px] text-white/35">{t("customerService.hours")}</span><span className="text-sm font-semibold">{config.customer_service_hours}</span></span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-white/10 p-5 pt-3">
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-white/12 py-3 text-sm font-semibold transition hover:bg-white/5">{t("common.gotIt")}</button>
              <button type="button" onClick={downloadQR} disabled={!config.customer_service_qr_url} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#12d6a3] py-3 text-sm font-semibold text-[#071316] transition hover:bg-[#2be0b1] disabled:cursor-not-allowed disabled:opacity-40">
                <Download size={17} />{t("customerService.downloadQR")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function GalleryPreview({ item, index }: { item: GalleryItem; index: number }) {
  const heightClass = ["h-64", "h-80", "h-56", "h-72", "h-96", "h-60"][index % 6];
  const mediaURL = item.media_url || item.cover_url || "";
  const poster = item.thumbnail_url || (item.cover_url && item.cover_url !== mediaURL ? item.cover_url : "");
  const isVideo = item.type === "video" || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(mediaURL);
  const previewURL = isVideo ? withVideoPreviewTime(mediaURL) : mediaURL;
  return (
    <Link
      href={item.public_id.startsWith("landing-") ? "/app/gallery" : `/app/gallery/${item.public_id}`}
      className="tech-card group mb-4 block break-inside-avoid overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.06] text-left shadow-2xl shadow-black/20 transition hover:-translate-y-1 hover:border-primary/50"
    >
      {isVideo && mediaURL ? (
        <div className={`${heightClass} relative overflow-hidden bg-black`}>
          <video src={previewURL} poster={poster || undefined} muted playsInline preload="metadata" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(18,214,163,.22),transparent_34%),linear-gradient(180deg,rgba(0,0,0,.08),rgba(0,0,0,.34))]" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white shadow-2xl backdrop-blur">
              <span className="ml-1 text-2xl">▶</span>
            </div>
          </div>
          <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-1 text-[11px] font-semibold text-white">VIDEO</span>
        </div>
      ) : mediaURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaURL} alt={item.title || ""} className="w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
      ) : (
        <div className={`${heightClass} relative overflow-hidden bg-[#0b1221]`}>
          <div className="absolute inset-0 opacity-70 [background:linear-gradient(135deg,rgba(18,214,163,.18),transparent_34%),linear-gradient(315deg,rgba(79,124,255,.2),transparent_42%)]" />
          <div className="absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:28px_28px]" />
          <div className="absolute bottom-5 left-5 right-5 rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur">
            <div className="text-xs text-primary">AI GENERATED CONCEPT</div>
            <div className="mt-2 text-lg font-semibold text-white">{item.title}</div>
          </div>
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center gap-2">
          {item.is_featured && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">精选</span>}
          <h3 className="truncate text-sm font-semibold text-white">{item.title || "未命名作品"}</h3>
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/52">{item.prompt || "从社区作品中提取提示词和模型配置，一键生成同款。"}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(item.tags || []).slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/45">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

function withVideoPreviewTime(url: string) {
  if (!url || url.includes("#t=")) return url;
  return `${url.split("#")[0]}#t=0.1`;
}

export default function LandingPageClient() {
  const { t } = useI18n();
  const router = useRouter();
  const { token, hydrate } = useAuthStore();
  const [showLogin, setShowLogin] = useState(false);
  const [gallery, setGallery] = useState<GalleryItem[]>(FALLBACK_GALLERY);
  const branding = useSiteBranding();
  const { site_name, site_copyright } = branding;
  const copyrightText = site_copyright || `© ${new Date().getFullYear()} ${site_name || "StarAI"}. All rights reserved.`;

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const enterAppOrLogin = () => {
    const hasToken = token || hasUserSession();
    if (hasToken) {
      router.push("/app");
      return;
    }
    setShowLogin(true);
  };

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("referral_code");
    if (code) setShowLogin(true);
  }, []);

  useEffect(() => {
    api<{ items: GalleryItem[] }>("/api/gallery?page_size=10")
      .then((r) => {
        if (r.items?.length) setGallery(r.items.slice(0, 10));
      })
      .catch(() => setGallery(FALLBACK_GALLERY));
  }, []);

  const capabilityCards = useMemo(
    () => [
      { title: t("landing.capability.chat.title"), desc: t("landing.capability.chat.desc"), icon: Bot, accent: "text-primary" },
      { title: t("landing.capability.media.title"), desc: t("landing.capability.media.desc"), icon: ImageIcon, accent: "text-sky-300" },
      { title: t("landing.capability.api.title"), desc: t("landing.capability.api.desc"), icon: Code2, accent: "text-indigo-300" },
      { title: t("landing.capability.agent.title"), desc: t("landing.capability.agent.desc"), icon: Boxes, accent: "text-amber-200" },
    ],
    [t],
  );

  return (
    <div className="min-h-screen overflow-hidden bg-[#0f1210] text-white">
      <style jsx global>{`
        @keyframes landingBlink {
          0%,
          45% {
            opacity: 1;
          }
          46%,
          100% {
            opacity: 0;
          }
        }
        @keyframes landingMarquee {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
        @keyframes landingFloat {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(0, -10px, 0);
          }
        }
        @keyframes landingScan {
          from {
            transform: translateX(-110%);
          }
          to {
            transform: translateX(110%);
          }
        }
        @keyframes landingOrbitSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes landingOrbitNodeSpin {
          from {
            transform: translate(-50%, -50%) rotate(var(--start-angle));
          }
          to {
            transform: translate(-50%, -50%) rotate(calc(var(--start-angle) - 360deg));
          }
        }
        @keyframes landingOrbitFocusIn {
          from {
            opacity: 0;
            transform: translate3d(0, 18px, 0) scale(0.82);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
        }
      `}</style>
      <section className="relative min-h-screen overflow-hidden bg-[#071316]">
        <InteractiveHeroCanvas />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_15%,rgba(18,214,163,.16),transparent_34%),radial-gradient(ellipse_at_82%_28%,rgba(146,107,255,.15),transparent_32%),linear-gradient(180deg,rgba(7,19,22,.05),rgba(15,18,16,.94)_88%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-[linear-gradient(180deg,transparent,rgba(15,18,16,.96))]" />
        <nav className="relative z-[70] mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-4 sm:px-8 sm:py-6">
          <SiteBrand
            href="/"
            className="min-w-0 flex-1 gap-2 pr-1"
            nameClassName="text-lg font-bold text-white sm:text-xl"
            subtitleClassName="max-w-[92px] text-xs text-white/78 min-[390px]:max-w-[130px] sm:max-w-none sm:text-sm"
            badgeClassName="h-8 w-8 rounded-lg text-sm"
          />
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-4">
            <Link href="/app/api-docs" className="hidden rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 transition hover:border-primary/60 hover:text-white sm:inline-flex">
              {t("landing.apiDocs")}
            </Link>
            <button onClick={enterAppOrLogin} className="h-9 max-w-[54px] truncate whitespace-nowrap rounded-full border border-white/20 px-2.5 text-xs leading-none text-white/86 transition hover:border-primary/60 sm:h-10 sm:max-w-none sm:px-5 sm:text-sm">
              {t("landing.login")}
            </button>
            <button onClick={enterAppOrLogin} className="h-9 max-w-[78px] truncate whitespace-nowrap rounded-full bg-primary px-3 text-xs font-semibold leading-none text-dark transition hover:bg-primary/90 min-[390px]:max-w-[92px] sm:h-10 sm:max-w-none sm:px-5 sm:text-sm">
              <span className="block truncate">{t("landing.start")}</span>
            </button>
            <UILanguageSelector compact tone="dark" />
          </div>
        </nav>

        <main className="relative z-10 mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-7xl min-w-0 flex-col justify-center overflow-hidden px-4 pb-16 pt-6 sm:px-8">
          <div className="grid w-full min-w-0 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_620px] xl:gap-16">
            <div className="w-full max-w-4xl min-w-0">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm text-primary backdrop-blur">
                <Sparkles size={15} />
                {t("landing.badge")}
              </div>
              <AnimatedHeadline />
              <p className="mt-7 max-w-full break-words text-base leading-8 text-white/62 sm:max-w-2xl sm:text-lg">
                {t("landing.desc", { site: site_name || "StarAI" })}
              </p>
              <div className="mt-10 flex min-w-0 flex-col gap-3 sm:flex-row">
                <button onClick={enterAppOrLogin} className="group box-border inline-flex w-full min-w-0 max-w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-primary px-5 py-3.5 text-sm font-semibold text-dark transition hover:bg-primary/90 sm:w-auto sm:px-7 sm:text-base">
                  <span className="truncate">{t("landing.freeStart")}</span>
                  <ArrowRight size={18} className="transition group-hover:translate-x-0.5" />
                </button>
                <Link href="/app/gallery" className="box-border inline-flex w-full min-w-0 max-w-full items-center justify-center gap-2 overflow-hidden rounded-full border border-white/18 px-5 py-3.5 text-sm font-semibold text-white/88 transition hover:border-primary/55 hover:text-white sm:w-auto sm:px-7 sm:text-base">
                  <Compass size={18} className="shrink-0" />
                  <span className="truncate">{t("landing.gallery")}</span>
                </Link>
              </div>
              <ModelTicker />
            </div>

            <div className="relative z-30 justify-self-end overflow-visible">
              <ModelOrbit />
            </div>
          </div>

          <div className="mt-10 grid w-full max-w-4xl min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 lg:mt-6 lg:max-w-[calc(100%-660px)]">
            {[
              ["20+", t("landing.stat.models")],
              ["1", t("landing.stat.wallet")],
              ["24h", t("landing.stat.api")],
              ["4", t("landing.stat.workflow")],
            ].map(([value, label]) => (
              <div key={label} className="tech-card rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-4 backdrop-blur transition hover:-translate-y-0.5 hover:border-primary/35">
                <div className="text-2xl font-bold text-white">{value}</div>
                <div className="mt-1 text-xs text-white/45">{label}</div>
              </div>
            ))}
          </div>
        </main>
      </section>

      <section className="relative overflow-hidden border-t border-white/10 bg-[#101713] px-4 py-20 sm:px-8">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(18,214,163,.08),transparent_36%),linear-gradient(250deg,rgba(215,188,112,.1),transparent_45%)]" />
        <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.14)_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative mx-auto max-w-7xl">
          <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="mb-3 text-sm font-semibold text-primary">MODEL ROUTER</div>
              <h2 className="text-3xl font-bold sm:text-5xl">{t("landing.section.capability")}</h2>
            </div>
            <p className="max-w-xl text-sm leading-7 text-white/50">{t("landing.section.capabilityDesc")}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            {capabilityCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.title} className="tech-card relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.055] p-6 transition hover:-translate-y-1 hover:border-primary/45">
                  <div className="absolute inset-x-0 top-0 h-px animate-[landingScan_4.6s_linear_infinite] bg-[linear-gradient(90deg,transparent,rgba(18,214,163,.78),transparent)]" />
                  <Icon className={card.accent} size={28} />
                  <h3 className="mt-6 text-lg font-semibold">{card.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-white/48">{card.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#171321] px-4 py-20 sm:px-8">
        <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(146,107,255,.13),transparent_38%),linear-gradient(315deg,rgba(18,214,163,.08),transparent_48%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <div className="mb-3 text-sm font-semibold text-primary">WORKFLOW</div>
            <h2 className="text-3xl font-bold leading-tight sm:text-5xl">{t("landing.section.flow")}</h2>
            <p className="mt-5 text-sm leading-7 text-white/52">
              {t("landing.section.flowDesc")}
            </p>
            <div className="mt-8 grid gap-3">
              {[
                ["01", t("landing.flow.step1.title"), t("landing.flow.step1.desc")],
                ["02", t("landing.flow.step2.title"), t("landing.flow.step2.desc")],
                ["03", t("landing.flow.step3.title"), t("landing.flow.step3.desc")],
              ].map(([no, title, desc]) => (
                  <div key={no} className="tech-card flex gap-4 rounded-2xl border border-white/10 bg-white/[0.055] p-4 transition hover:-translate-y-0.5 hover:border-primary/35">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-sm font-bold text-dark">{no}</div>
                  <div>
                    <div className="font-semibold text-white">{title}</div>
                    <div className="mt-1 text-sm text-white/45">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="tech-card rounded-[32px] border border-white/10 bg-white/[0.055] p-4 shadow-2xl shadow-black/30 [animation:landingFloat_7s_ease-in-out_infinite]">
            <div className="rounded-[24px] border border-white/10 bg-[#0a101e] p-4">
              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-red-400" />
                  <span className="h-3 w-3 rounded-full bg-amber-300" />
                  <span className="h-3 w-3 rounded-full bg-primary" />
                </div>
                <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/45">{t("landing.liveWorkspace")}</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {[t("landing.workspace.card1"), t("landing.workspace.card2"), t("landing.workspace.card3"), t("landing.workspace.card4")].map((item, idx) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-sm font-semibold">{item}</span>
                      <Wand2 size={16} className={idx % 2 ? "text-sky-300" : "text-primary"} />
                    </div>
                    <div className="space-y-2">
                      <div className="h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full w-2/3 animate-[landingScan_2.8s_ease-in-out_infinite] bg-primary/70" /></div>
                      <div className="h-2 w-5/6 overflow-hidden rounded-full bg-white/10"><span className="block h-full w-1/2 animate-[landingScan_3.2s_ease-in-out_infinite] bg-sky-300/60" /></div>
                      <div className="h-2 w-2/3 overflow-hidden rounded-full bg-white/10"><span className="block h-full w-3/5 animate-[landingScan_3.6s_ease-in-out_infinite] bg-amber-200/60" /></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/10 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Play size={16} />
                  {t("landing.workspace.done")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-y border-white/10 bg-[#12170f] px-4 py-20 sm:px-8">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(215,188,112,.1),transparent_34%),linear-gradient(180deg,rgba(18,214,163,.07),transparent_50%)]" />
        <div className="relative mx-auto max-w-7xl">
          <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="mb-3 text-sm font-semibold text-primary">INSPIRATION GALLERY</div>
              <h2 className="text-3xl font-bold sm:text-5xl">{t("landing.section.gallery")}</h2>
            </div>
            <Link href="/app/gallery" className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/80 transition hover:border-primary/55 hover:text-white">
              {t("landing.viewAll")}
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
            {gallery.map((item, index) => (
              <GalleryPreview key={item.public_id} item={item} index={index} />
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#11161d] px-4 py-20 sm:px-8">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(79,124,255,.1),transparent_38%),linear-gradient(315deg,rgba(215,188,112,.09),transparent_46%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-6 md:grid-cols-3">
          <div className="tech-card rounded-[28px] border border-white/10 bg-white/[0.045] p-6 transition hover:-translate-y-1 hover:border-primary/35">
            <KeyRound className="text-primary" size={28} />
            <h3 className="mt-6 text-xl font-semibold">{t("landing.feature.apiKey.title")}</h3>
            <p className="mt-3 text-sm leading-6 text-white/48">{t("landing.feature.apiKey.desc")}</p>
          </div>
          <div className="tech-card rounded-[28px] border border-white/10 bg-white/[0.045] p-6 transition hover:-translate-y-1 hover:border-primary/35">
            <Copy className="text-sky-300" size={28} />
            <h3 className="mt-6 text-xl font-semibold">{t("landing.feature.referral.title")}</h3>
            <p className="mt-3 text-sm leading-6 text-white/48">{t("landing.feature.referral.desc")}</p>
          </div>
          <div className="tech-card rounded-[28px] border border-white/10 bg-white/[0.045] p-6 transition hover:-translate-y-1 hover:border-primary/35">
            <Compass className="text-amber-200" size={28} />
            <h3 className="mt-6 text-xl font-semibold">{t("landing.feature.gallery.title")}</h3>
            <p className="mt-3 text-sm leading-6 text-white/48">{t("landing.feature.gallery.desc")}</p>
          </div>
        </div>

        <div className="relative mx-auto mt-16 max-w-4xl overflow-hidden rounded-[32px] border border-primary/30 bg-primary/10 px-6 py-10 text-center">
          <div className="absolute inset-x-0 top-0 h-px animate-[landingScan_5s_linear_infinite] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.8),transparent)]" />
          <h2 className="text-3xl font-bold sm:text-5xl">{t("landing.cta")}</h2>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-white/58">{t("landing.ctaDesc")}</p>
          <button onClick={enterAppOrLogin} className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 font-semibold text-dark transition hover:bg-primary/90">
            {t("landing.tryNow")}
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      <footer className="relative overflow-hidden border-t border-white/10 bg-[#071316] px-4 py-6 text-center text-xs text-white/45 sm:px-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(18,214,163,.1),transparent_38%),radial-gradient(ellipse_at_82%_100%,rgba(146,107,255,.08),transparent_40%)]" />
        <div className="relative mx-auto flex max-w-7xl flex-col items-center justify-center gap-2 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
            <span>{site_name || "StarAI"}</span>
          </div>
          <div className="max-w-full break-words">{copyrightText}</div>
        </div>
      </footer>

      <CustomerService config={branding} />
      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  );
}
