"use client";

export interface SchemaProp {
  type?: string;
  title?: string;
  placeholder?: string;
  enum?: (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  widget?: string;
  "x-placement"?: string;
  "x-order"?: number;
}

export interface JsonSchema {
  properties?: Record<string, SchemaProp>;
}

export function schemaProperties(schema: unknown): Record<string, SchemaProp> {
  if (schema && typeof schema === "object" && "properties" in schema) {
    const props = (schema as JsonSchema).properties;
    if (props && typeof props === "object") return props;
  }
  return {};
}

export function schemaDefaults(schema: unknown): Record<string, unknown> {
  const props = schemaProperties(schema);
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(props)) {
    if (prop.default !== undefined) out[key] = prop.default;
    else if (prop.enum && prop.enum.length) out[key] = prop.enum[0];
  }
  return out;
}

function coerce(prop: SchemaProp, raw: string): unknown {
  if (prop.type === "number" || prop.type === "integer") {
    const n = prop.type === "integer" ? parseInt(raw, 10) : parseFloat(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

interface Props {
  schema: unknown;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  layout?: "inline" | "stacked";
  placement?: "all" | "top" | "default";
}

function isTopField(prop: SchemaProp) {
  return prop["x-placement"] === "top" || prop["x-placement"] === "audio_top";
}

export function SchemaForm({ schema, values, onChange, layout = "inline", placement = "all" }: Props) {
  const props = schemaProperties(schema);
  const entries = Object.entries(props)
    .filter(([, prop]) => placement === "all" || (placement === "top" ? isTopField(prop) : !isTopField(prop)))
    .sort((a, b) => (a[1]["x-order"] ?? 99) - (b[1]["x-order"] ?? 99));
  if (entries.length === 0) return null;

  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  const stacked = layout === "stacked";

  const controlCls = stacked
    ? "w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm focus:outline-none focus:border-primary"
    : "px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs focus:outline-none focus:border-primary";

  const renderControl = (key: string, prop: SchemaProp) => {
    const value = values[key] ?? prop.default ?? "";
    if (prop.enum && prop.enum.length) {
      return (
        <select value={String(value)} onChange={(e) => set(key, coerce(prop, e.target.value))} className={controlCls}>
          {prop.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      );
    }
    if (prop.type === "boolean") {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => set(key, e.target.checked)}
          className="accent-secondary"
        />
      );
    }
    if (prop.type === "number" || prop.type === "integer") {
      return (
        <input
          type="number"
          value={value === "" ? "" : Number(value)}
          min={prop.minimum}
          max={prop.maximum}
          onChange={(e) => set(key, coerce(prop, e.target.value))}
          className={stacked ? controlCls : "w-20 " + controlCls}
        />
      );
    }
    if (prop.widget === "textarea") {
      return (
        <textarea
          value={String(value)}
          placeholder={prop.placeholder}
          onChange={(e) => set(key, e.target.value)}
          rows={stacked ? 3 : 2}
          className={(stacked ? controlCls : "w-full " + controlCls) + " resize-none"}
        />
      );
    }
    return (
      <input
        type="text"
        value={String(value)}
        placeholder={prop.placeholder}
        onChange={(e) => set(key, e.target.value)}
        className={controlCls}
      />
    );
  };

  if (stacked) {
    return (
      <div className="space-y-4">
        {entries.map(([key, prop]) => (
          <div key={key}>
            <label className="block text-sm text-gray-600 mb-1">{prop.title || key}</label>
            {renderControl(key, prop)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {entries.map(([key, prop]) => (
        <label key={key} className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="shrink-0">{prop.title || key}</span>
          {renderControl(key, prop)}
        </label>
      ))}
    </div>
  );
}
