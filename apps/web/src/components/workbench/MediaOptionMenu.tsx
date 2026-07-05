"use client";

import { useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export function MediaOptionMenu({
  icon,
  label,
  activeLabel,
  title,
  subtitle,
  tone = "white",
  compactOnMobile = false,
  children,
}: {
  icon: ReactNode;
  label?: string;
  activeLabel: string;
  title: string;
  subtitle: string;
  tone?: "white" | "yellow";
  compactOnMobile?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        left: Math.min(rect.left, window.innerWidth - 272),
        bottom: window.innerHeight - rect.top + 8,
      });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        className={`h-8 rounded-xl border text-xs flex items-center gap-1.5 shadow-sm transition ${compactOnMobile ? "px-2 sm:px-2.5" : "px-2.5"} ${
          tone === "yellow"
            ? "bg-amber-100 border-amber-300 text-gray-900 dark:bg-amber-500/10 dark:border-amber-400/30 dark:text-amber-100"
            : "bg-white border-gray-200 text-gray-700 dark:bg-white/5 dark:border-white/10 dark:text-gray-200"
        }`}
      >
        <span className="text-gray-500 dark:text-gray-400">{icon}</span>
        <span className={compactOnMobile ? "hidden sm:inline" : ""}>{activeLabel || label}</span>
        <ChevronDown size={13} className={`text-gray-500 transition dark:text-gray-400 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)}>
          <div
            className="fixed w-[220px] max-w-[calc(100vw-1rem)] rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden dark:bg-gray-900 dark:border-white/10"
            style={{ left: pos.left, bottom: pos.bottom }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/10">
              <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mt-1">{subtitle}</div>
            </div>
            <div className="p-2.5 max-h-[280px] overflow-y-auto bg-white dark:bg-gray-900">{children(() => setOpen(false))}</div>
          </div>
        </div>
      )}
    </>
  );
}

export function MediaMenuOption({
  selected,
  children,
  onClick,
}: {
  selected: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full h-10 px-3.5 rounded-xl text-left flex items-center justify-between text-sm font-semibold ${
        selected
          ? "bg-primary/10 dark:bg-primary/15 text-gray-900 dark:text-gray-100"
          : "bg-gray-50 hover:bg-gray-100 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
      }`}
    >
      <span>{children}</span>
      {selected && <Check size={16} className="text-primary" />}
    </button>
  );
}
