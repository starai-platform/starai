"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { clsx } from "clsx";

function FlagMark({ flag, flagUrl }: { flag?: string; flagUrl?: string }) {
  if (flagUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={flagUrl} alt="" className="h-4 w-6 rounded-[3px] object-cover shadow-sm ring-1 ring-black/5" />;
  }
  return <span className="text-base leading-none">{flag || "\u{1F310}"}</span>;
}

export function UILanguageSelector({
  compact = false,
  className = "",
  tone = "default",
}: {
  compact?: boolean;
  className?: string;
  tone?: "default" | "dark";
}) {
  const { language, languages, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className={clsx("relative z-[80]", className)} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={t("common.language")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={clsx(
          "inline-flex items-center justify-center gap-1.5 rounded-full border transition",
          compact ? "h-9 px-2.5 text-xs" : "h-10 px-3 text-sm",
          tone === "dark"
            ? "border-white/15 bg-gray-950/55 text-white shadow-lg shadow-black/20 backdrop-blur hover:border-primary/60 hover:bg-gray-900/80"
            : "border-gray-200 bg-white text-gray-700 hover:border-primary/50 hover:text-gray-950 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
        )}
      >
        <FlagMark flag={language.flag} flagUrl={language.flag_url} />
        <span className="font-semibold">{language.short}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-[90] mt-2 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-gray-900">
          <div className="px-2 py-1.5 text-[11px] font-semibold text-gray-400">{t("common.language")}</div>
          {languages.map((item) => (
            <button
              type="button"
              key={item.code}
              onClick={() => {
                setLocale(item.code);
                setOpen(false);
              }}
              className={clsx(
                "flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-sm transition",
                item.code === language.code
                  ? "bg-primary/10 font-semibold text-primary"
                  : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/10"
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <FlagMark flag={item.flag} flagUrl={item.flag_url} />
                <span className="truncate">{item.name}</span>
              </span>
              <span className="text-xs text-gray-400">{item.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
