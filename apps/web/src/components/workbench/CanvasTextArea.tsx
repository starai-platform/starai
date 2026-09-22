"use client";

import { useRef, useState, type TextareaHTMLAttributes } from "react";

// Keep the browser's composition buffer local until the IME commits it.
export function CanvasTextArea({ value, className, onChange, onCompositionStart, onCompositionEnd, onKeyDown, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const composing = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  return <textarea {...props} className={`nodrag nowheel ${className || ""}`} value={draft ?? value}
    onCompositionStart={event => {
      composing.current = true;
      setDraft(event.currentTarget.value);
      onCompositionStart?.(event);
    }}
    onChange={event => {
      if (composing.current) setDraft(event.currentTarget.value);
      else onChange?.(event);
    }}
    onCompositionEnd={event => {
      composing.current = false;
      setDraft(null);
      onChange?.({ ...event, target: event.currentTarget });
      onCompositionEnd?.(event);
    }}
    onKeyDown={event => {
      event.stopPropagation();
      if (!composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) onKeyDown?.(event);
    }}
  />;
}
