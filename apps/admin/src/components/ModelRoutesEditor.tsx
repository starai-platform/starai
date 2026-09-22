"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/api";

interface ModelRoute {
  id: number;
  route_name: string;
  provider: string;
  protocol: string;
  upstream_model: string;
  endpoint: string;
  base_url: string;
  api_key?: string;
  auth_type: string;
  api_key_header: string;
  headers: Record<string, unknown>;
  extra_params: Record<string, unknown>;
  runtime_rule: Record<string, unknown>;
  cost_rule: Record<string, unknown>;
  priority: number;
  weight: number;
  timeout_seconds: number;
  max_retries: number;
  is_enabled: boolean;
  health_status: string;
  consecutive_failures: number;
  success_count: number;
  failure_count: number;
  cooldown_until?: string;
}

interface ModelRouteAttempt {
  id: number;
  request_id: string;
  route_name: string;
  attempt: number;
  status: string;
  status_code?: number;
  error_code?: string;
  latency_ms: number;
  created_at: string;
}

interface ModelRouteProfit {
  route_id: number;
  request_count: number;
  revenue: number;
  provider_cost: number;
  gross_profit: number;
  margin_rate: number;
}

type RouteForm = Omit<ModelRoute, "id" | "health_status" | "consecutive_failures" | "success_count" | "failure_count" | "cooldown_until">;

const supportedBillingTypes = new Set(["per_token", "per_request", "per_image", "per_second"]);

function normalizedBillingType(value: unknown) {
  const billingType = String(value || "").trim();
  return supportedBillingTypes.has(billingType) ? billingType : "per_token";
}

const emptyRoute = (defaults: { upstreamModel: string; endpoint: string; billingType: string; requestMode: string }): RouteForm => ({
  route_name: "",
  provider: "",
  protocol: "openai",
  upstream_model: defaults.upstreamModel,
  endpoint: defaults.endpoint,
  base_url: "",
  api_key: "",
  auth_type: "bearer",
  api_key_header: "Authorization",
  headers: {},
  extra_params: {},
  runtime_rule: {},
  cost_rule: defaults.billingType === "per_token"
    ? { billing_type: "per_token", input_cost_per_m: 0, output_cost_per_m: 0 }
    : { billing_type: defaults.billingType, unit_cost: 0 },
  priority: 100,
  weight: 100,
  timeout_seconds: defaults.requestMode === "images" ? 600 : (["chat_completions", "responses"].includes(defaults.requestMode) ? 90 : 120),
  max_retries: ["chat_completions", "responses"].includes(defaults.requestMode) ? 1 : 0,
  is_enabled: true,
});

function jsonText(value: Record<string, unknown>) {
  return JSON.stringify(value || {}, null, 2);
}

function normalizedCostRule(value: Record<string, unknown> | undefined, fallbackBillingType: string) {
  const rule = { ...(value || {}) };
  const configuredType = String(rule.billing_type || "").trim();
  if (!configuredType) {
    rule.billing_type = normalizedBillingType(fallbackBillingType);
  }
  return rule;
}

function healthStyle(status: string) {
  if (status === "healthy") return "bg-green-50 text-green-700 border-green-200";
  if (status === "degraded" || status === "half_open") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function healthLabel(status: string) {
  return ({ healthy: "正常", degraded: "降级", open: "已熔断", half_open: "恢复探测" } as Record<string, string>)[status] || status;
}

function attemptLabel(status: string) {
  return ({ success: "成功", failed: "失败", rejected: "请求被拒绝" } as Record<string, string>)[status] || status;
}

interface PrimaryRouteConnection {
  upstreamModel: string;
  endpoint: string;
  protocol: string;
  provider: string;
  baseUrl: string;
  apiKey?: string;
  authType: string;
  apiKeyHeader: string;
}

export function ModelRoutesEditor({ modelId, upstreamModel, endpoint, requestMode, modelBillingType, onPrimaryConnectionChange, onPrimaryBillingTypeChange }: { modelId: number; upstreamModel: string; endpoint: string; requestMode: string; modelBillingType: string; onPrimaryConnectionChange?: (connection: PrimaryRouteConnection) => void; onPrimaryBillingTypeChange?: (billingType: string) => void }) {
  const defaultBillingType = normalizedBillingType(modelBillingType);
  const canSyncModelBillingType = supportedBillingTypes.has(String(modelBillingType || "").trim());
  const [routes, setRoutes] = useState<ModelRoute[]>([]);
  const [attempts, setAttempts] = useState<ModelRouteAttempt[]>([]);
  const [profits, setProfits] = useState<ModelRouteProfit[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RouteForm>(() => emptyRoute({ upstreamModel, endpoint, billingType: defaultBillingType, requestMode }));
  const [advanced, setAdvanced] = useState({ headers: "{}", extra: "{}", runtime: "{}" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [routeItems, attemptItems, profitItems] = await Promise.all([
      adminApi<ModelRoute[]>(`/models/${modelId}/routes`),
      adminApi<ModelRouteAttempt[]>(`/models/${modelId}/route-attempts?limit=20`),
      adminApi<ModelRouteProfit[]>(`/models/${modelId}/route-profit?days=30`),
    ]);
    setRoutes(routeItems);
    setAttempts(attemptItems);
    setProfits(profitItems);
    return routeItems;
  }, [modelId]);
  useEffect(() => { void load(); }, [load]);

  const beginCreate = () => {
    const next = emptyRoute({ upstreamModel, endpoint, billingType: defaultBillingType, requestMode });
    setEditingId(0);
    setForm(next);
    setAdvanced({ headers: "{}", extra: "{}", runtime: "{}" });
    setMessage("");
  };

  const beginEdit = (route: ModelRoute) => {
    setEditingId(route.id);
    setForm({
      route_name: route.route_name, provider: route.provider, protocol: ["openai_compatible", "new_api"].includes(route.protocol) ? "openai" : route.protocol,
      upstream_model: route.upstream_model, endpoint: route.endpoint, base_url: route.base_url,
      api_key: route.api_key || "", auth_type: route.auth_type, api_key_header: route.api_key_header,
      headers: route.headers || {}, extra_params: route.extra_params || {}, runtime_rule: route.runtime_rule || {}, cost_rule: normalizedCostRule(route.cost_rule, defaultBillingType),
      priority: route.priority, weight: route.weight, timeout_seconds: requestMode === "images" ? Math.max(600, route.timeout_seconds) : route.timeout_seconds,
      max_retries: route.max_retries, is_enabled: route.is_enabled,
    });
    setAdvanced({ headers: jsonText(route.headers), extra: jsonText(route.extra_params), runtime: jsonText(route.runtime_rule) });
    setMessage("");
  };

  const save = async () => {
    try {
      setBusy(true);
      setMessage("");
      const payload = {
        ...form,
        headers: JSON.parse(advanced.headers || "{}"),
        extra_params: JSON.parse(advanced.extra || "{}"),
        runtime_rule: JSON.parse(advanced.runtime || "{}"),
        cost_rule: { ...normalizedCostRule(form.cost_rule, defaultBillingType), billing_type: billingType },
      };
      let savedRoute: ModelRoute;
      if (editingId) {
        savedRoute = await adminApi<ModelRoute>(`/models/${modelId}/routes/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        savedRoute = await adminApi<ModelRoute>(`/models/${modelId}/routes`, { method: "POST", body: JSON.stringify(payload) });
      }
      const refreshedRoutes = await load();
      const primary = refreshedRoutes[0];
      if (primary) {
        onPrimaryConnectionChange?.({
          upstreamModel: primary.upstream_model,
          endpoint: primary.endpoint,
          protocol: primary.protocol,
          provider: primary.provider,
          baseUrl: primary.base_url,
          apiKey: primary.api_key,
          authType: primary.auth_type,
          apiKeyHeader: primary.api_key_header,
        });
        if (primary.id === savedRoute.id && canSyncModelBillingType) onPrimaryBillingTypeChange?.(billingType);
      }
      setEditingId(null);
      setMessage(primary?.id === savedRoute.id && canSyncModelBillingType ? "线路已保存；主线路计费方式已同步到模型售价配置" : "线路已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存线路失败");
    } finally { setBusy(false); }
  };

  const toggleEnabled = async (route: ModelRoute) => {
    if (route.is_enabled && routes.filter((item) => item.is_enabled).length === 1 && !window.confirm("这是当前唯一启用的线路。禁用后该模型将暂时无法调用，是否继续？")) return;
    try {
      setBusy(true);
      setMessage("");
      await adminApi(`/models/${modelId}/routes/${route.id}/enabled`, {
        method: "PATCH",
        body: JSON.stringify({ is_enabled: !route.is_enabled }),
      });
      await load();
      setMessage(`线路已${route.is_enabled ? "禁用" : "启用"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "切换线路状态失败");
    } finally { setBusy(false); }
  };

  const test = async (route: ModelRoute) => {
    try {
      setBusy(true);
      const result = await adminApi<{ ok: boolean; message: string; latency_ms: number }>(`/models/${modelId}/routes/${route.id}/test`, { method: "POST" });
      setMessage(`${result.ok ? "连接正常" : "连接失败"}：${result.message}${result.latency_ms ? `（${result.latency_ms}ms）` : ""}`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "测试失败"); }
    finally { setBusy(false); }
  };

  const testAll = async () => {
    if (!window.confirm("将依次检查全部已启用线路。图片线路只做参数校验，不会提交生图任务；是否继续？")) return;
    try {
      setBusy(true);
      const results = await adminApi<Array<{ result: { ok: boolean } }>>(`/models/${modelId}/routes/test-all`, { method: "POST" });
      const passed = results.filter((item) => item.result.ok).length;
      setMessage(`批量检查完成：${passed}/${results.length} 条线路正常`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "批量检查失败"); }
    finally { setBusy(false); }
  };

  const resetHealth = async (route: ModelRoute) => {
    setBusy(true);
    try {
      await adminApi(`/models/${modelId}/routes/${route.id}/reset-health`, { method: "POST" });
      await load();
      setMessage("线路健康状态已恢复");
    } finally { setBusy(false); }
  };

  const remove = async (route: ModelRoute) => {
    if (!window.confirm(`确认删除线路“${route.route_name}”？`)) return;
    setBusy(true);
    try {
      await adminApi(`/models/${modelId}/routes/${route.id}`, { method: "DELETE" });
      await load();
      if (editingId === route.id) setEditingId(null);
    } finally { setBusy(false); }
  };

  const setCostField = (key: string, value: string | number) => setForm((current) => ({
    ...current,
    cost_rule: { ...(current.cost_rule || {}), [key]: value },
  }));
  const setImageTierCost = (tier: string, value: number) => setForm((current) => ({
    ...current,
    cost_rule: {
      ...(current.cost_rule || {}),
      unit_cost: tier === "1K" ? value : Number(current.cost_rule?.unit_cost || value),
      unit_cost_by_size: { ...((current.cost_rule?.unit_cost_by_size as Record<string, number> | undefined) || {}), [tier]: value },
    },
  }));

  const billingType = normalizedBillingType(form.cost_rule?.billing_type || defaultBillingType);
  const unhealthyRoutes = routes.filter((route) => route.is_enabled && route.health_status !== "healthy");

  return (
    <section className="col-span-2 rounded-2xl border border-blue-100 bg-blue-50/40 p-5" onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">上游线路池</h3>
          <p className="mt-1 text-xs leading-5 text-gray-500">同一平台模型可配置多条线路。优先级数字越小越优先；同优先级按权重分流，故障时自动切换。成本金额只用于利润统计；主线路的计费方式会同步到模型售价配置。</p>
        </div>
        <div className="flex shrink-0 gap-2"><button type="button" disabled={busy || routes.length === 0} onClick={testAll} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40">检查全部线路</button><button type="button" onClick={beginCreate} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700">＋ 新增线路</button></div>
      </div>

      {unhealthyRoutes.length > 0 && (
        <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div><div className="font-semibold">线路故障提醒：{unhealthyRoutes.length} 条启用线路状态异常</div><div className="mt-1 text-amber-700">{unhealthyRoutes.map((route) => `${route.route_name}（${healthLabel(route.health_status)}，连续失败 ${route.consecutive_failures} 次）`).join("；")}</div></div>
          <button type="button" disabled={busy} onClick={testAll} className="shrink-0 font-medium text-amber-800 hover:underline disabled:opacity-40">立即复检</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead className="bg-gray-50 text-gray-500"><tr><th className="p-3">线路</th><th className="p-3">上游模型</th><th className="p-3">优先级 / 权重</th><th className="p-3">健康状态</th><th className="p-3">成功 / 失败</th><th className="p-3">近 30 天毛利</th><th className="p-3 text-right">操作</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {routes.map((route) => (
              <tr key={route.id}>
                <td className="p-3"><div className="flex items-center gap-2"><div className="font-medium text-gray-900">{route.route_name}</div>{routes[0]?.id === route.id && <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">主线路</span>}<span className={`rounded-full px-1.5 py-0.5 text-[10px] ${route.is_enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{route.is_enabled ? "已启用" : "已禁用"}</span></div><div className="mt-1 text-gray-400">{route.provider || "未标注渠道"} · {route.protocol}</div></td>
                <td className="p-3"><div className="font-mono text-gray-700">{route.upstream_model}</div><div className="mt-1 max-w-[300px] truncate text-gray-400" title={route.base_url}>{route.base_url}</div></td>
                <td className="p-3 text-gray-700">{route.priority} / {route.weight}</td>
                <td className="p-3"><span className={`inline-flex rounded-full border px-2 py-1 ${healthStyle(route.health_status)}`}>{healthLabel(route.health_status)}</span>{route.consecutive_failures > 0 && <div className="mt-1 text-gray-400">连续失败 {route.consecutive_failures}</div>}</td>
                <td className="p-3 text-gray-600">{route.success_count} / {route.failure_count}</td>
                <td className="p-3 text-gray-600">{(() => { const profit = profits.find((item) => item.route_id === route.id); return profit ? <><div className={profit.gross_profit >= 0 ? "font-medium text-green-600" : "font-medium text-red-600"}>{profit.gross_profit.toFixed(4)}</div><div className="mt-1 text-gray-400">收入 {profit.revenue.toFixed(4)} · 成本 {profit.provider_cost.toFixed(4)} · {profit.request_count} 次</div></> : "-"; })()}</td>
                <td className="p-3"><div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => toggleEnabled(route)} className={route.is_enabled ? "text-amber-600 hover:underline" : "text-green-600 hover:underline"}>{route.is_enabled ? "禁用" : "启用"}</button><button type="button" disabled={busy || !route.is_enabled} onClick={() => test(route)} className="text-blue-600 hover:underline disabled:text-gray-300 disabled:no-underline">测试</button><button type="button" disabled={busy} onClick={() => beginEdit(route)} className="text-gray-700 hover:underline">编辑</button>{route.health_status !== "healthy" && <button type="button" disabled={busy} onClick={() => resetHealth(route)} className="text-amber-600 hover:underline">恢复</button>}<button type="button" disabled={busy} onClick={() => remove(route)} className="text-red-500 hover:underline">删除</button></div></td>
              </tr>
            ))}
            {routes.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-400">尚未配置线路。保存模型时填写的原上游连接仍可兼容使用，也可以在此建立正式线路池。</td></tr>}
          </tbody>
        </table>
      </div>

      <details className="mt-4 rounded-xl border border-gray-200 bg-white">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-xs font-medium text-gray-700">
          <span>最近线路调用（{attempts.length}）</span><span className="font-normal text-gray-400">用于排查切换、限流和超时</span>
        </summary>
        <div className="overflow-x-auto border-t">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="bg-gray-50 text-gray-500"><tr><th className="p-3">时间</th><th className="p-3">请求 ID</th><th className="p-3">线路</th><th className="p-3">尝试</th><th className="p-3">结果</th><th className="p-3">HTTP / 错误</th><th className="p-3">耗时</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {attempts.map((item) => <tr key={item.id}><td className="p-3 text-gray-500">{new Date(item.created_at).toLocaleString()}</td><td className="p-3 font-mono text-gray-600">{item.request_id}</td><td className="p-3 text-gray-700">{item.route_name}</td><td className="p-3">#{item.attempt}</td><td className="p-3"><span className={item.status === "success" ? "text-green-600" : item.status === "rejected" ? "text-amber-600" : "text-red-600"}>{attemptLabel(item.status)}</span></td><td className="p-3 text-gray-500">{item.status_code || "-"}{item.error_code ? ` / ${item.error_code}` : ""}</td><td className="p-3 text-gray-500">{item.latency_ms}ms</td></tr>)}
              {attempts.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-400">暂无线路调用记录</td></tr>}
            </tbody>
          </table>
        </div>
      </details>

      {editingId !== null && (
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-blue-200 bg-white p-4">
          {((editingId !== 0 && routes[0]?.id === editingId) || routes.length === 0) && <p className="col-span-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">这是主线路。保存后，上游连接字段及计费方式会同步到模型配置；上游成本金额仍只属于该线路，模型售价金额不会被覆盖。同步后的模型配置请点击页面底部“保存修改”提交。</p>}
          <label className="text-xs text-gray-600">线路名称<input value={form.route_name} onChange={(e) => setForm({ ...form, route_name: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm" placeholder="例如：Anthropic 官方" /></label>
          <label className="text-xs text-gray-600">渠道标识<input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm" placeholder="anthropic / proxy-a" /></label>
          <label className="text-xs text-gray-600">协议<select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm"><option value="openai">OpenAI 兼容</option><option value="claude">Anthropic Messages</option><option value="gemini">Gemini 原生</option></select></label>
          <label className="text-xs text-gray-600">上游模型名<input value={form.upstream_model} onChange={(e) => setForm({ ...form, upstream_model: e.target.value })} className="mt-1 w-full rounded-lg border p-2 font-mono text-sm" /></label>
          <label className="col-span-2 text-xs text-gray-600">Base URL<input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} className="mt-1 w-full rounded-lg border p-2 font-mono text-sm" placeholder="https://api.example.com" /></label>
          <label className="text-xs text-gray-600">Endpoint<input value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} className="mt-1 w-full rounded-lg border p-2 font-mono text-sm" /></label>
          <label className="text-xs text-gray-600">API Key<input type="password" value={form.api_key || ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })} className="mt-1 w-full rounded-lg border p-2 font-mono text-sm" placeholder="留空或保留掩码表示不修改" /></label>
          <label className="text-xs text-gray-600">优先级<input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} className="mt-1 w-full rounded-lg border p-2 text-sm" /></label>
          <label className="text-xs text-gray-600">同优先级权重<input type="number" min={1} value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} className="mt-1 w-full rounded-lg border p-2 text-sm" /></label>
          <label className="text-xs text-gray-600">超时秒数{requestMode === "images" ? <span className="ml-1 text-gray-400">（图片建议至少 600）</span> : ["chat_completions", "responses"].includes(requestMode) && <span className="ml-1 text-gray-400">（建议不超过 90）</span>}<input type="number" min={1} value={form.timeout_seconds} onChange={(e) => setForm({ ...form, timeout_seconds: Number(e.target.value) })} className="mt-1 w-full rounded-lg border p-2 text-sm" /></label>
          <label className="text-xs text-gray-600">单线路重试次数{["chat_completions", "responses"].includes(requestMode) && <span className="ml-1 text-gray-400">（瞬时网关错误建议 1）</span>}<input type="number" min={0} max={3} value={form.max_retries} onChange={(e) => setForm({ ...form, max_retries: Number(e.target.value) })} className="mt-1 w-full rounded-lg border p-2 text-sm" /></label>
          <div className="col-span-2 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
          <div className="mb-1 text-xs font-medium text-gray-800">上游成本（平台算力单位）</div>
          <p className="mb-3 text-[11px] text-gray-500">这里填写折算后的平台算力成本，用于和用户实际扣费计算毛利；不会向用户展示，也不会改变模型售价。</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <label className="text-xs text-gray-600">计费方式<select value={billingType} onChange={(e) => setForm((current) => ({ ...current, cost_rule: { ...(current.cost_rule || {}), billing_type: e.target.value } }))} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm"><option value="per_token">按 Token</option><option value="per_request">按次</option><option value="per_image">按图片</option><option value="per_second">按秒</option></select></label>
              {billingType === "per_token" ? <>
                <label className="text-xs text-gray-600">输入 / 百万 Token<input type="number" min={0} step="0.000001" value={Number(form.cost_rule?.input_cost_per_m || 0)} onChange={(e) => setCostField("input_cost_per_m", Number(e.target.value))} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm" /></label>
                <label className="text-xs text-gray-600">输出 / 百万 Token<input type="number" min={0} step="0.000001" value={Number(form.cost_rule?.output_cost_per_m || 0)} onChange={(e) => setCostField("output_cost_per_m", Number(e.target.value))} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm" /></label>
                <label className="text-xs text-gray-600">缓存读取 / 百万<input type="number" min={0} step="0.000001" value={Number(form.cost_rule?.cache_read_cost_per_m || 0)} onChange={(e) => setCostField("cache_read_cost_per_m", Number(e.target.value))} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm" /></label>
                <label className="text-xs text-gray-600">缓存写入 / 百万<input type="number" min={0} step="0.000001" value={Number(form.cost_rule?.cache_write_cost_per_m || 0)} onChange={(e) => setCostField("cache_write_cost_per_m", Number(e.target.value))} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm" /></label>
              </> : billingType === "per_image" ? <>
                {["1K", "2K", "4K"].map((tier) => (
                  <label key={tier} className="text-xs text-gray-600">{tier} 上游成本 / 张<input type="number" min={0} step="0.000001" value={Number((form.cost_rule?.unit_cost_by_size as Record<string, number> | undefined)?.[tier] ?? form.cost_rule?.unit_cost ?? 0)} onChange={(e) => setImageTierCost(tier, Math.max(0, Number(e.target.value) || 0))} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm" /></label>
                ))}
              </> : <label className="text-xs text-gray-600">上游单位成本<input type="number" min={0} step="0.000001" value={Number(form.cost_rule?.unit_cost || 0)} onChange={(e) => setCostField("unit_cost", Number(e.target.value))} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm" /></label>}
            </div>
          </div>
          <details className="col-span-2 rounded-lg border p-3"><summary className="cursor-pointer text-xs font-medium text-gray-700">高级配置</summary><div className="mt-3 grid grid-cols-3 gap-3"><label className="text-xs text-gray-600">请求头 JSON<textarea value={advanced.headers} onChange={(e) => setAdvanced({ ...advanced, headers: e.target.value })} className="mt-1 h-28 w-full rounded-lg border p-2 font-mono text-xs" /></label><label className="text-xs text-gray-600">附加参数 JSON<textarea value={advanced.extra} onChange={(e) => setAdvanced({ ...advanced, extra: e.target.value })} className="mt-1 h-28 w-full rounded-lg border p-2 font-mono text-xs" /></label><label className="text-xs text-gray-600">线路运行规则 JSON<textarea value={advanced.runtime} onChange={(e) => setAdvanced({ ...advanced, runtime: e.target.value })} className="mt-1 h-28 w-full rounded-lg border p-2 font-mono text-xs" /></label></div></details>
          <div className="col-span-2 grid grid-cols-2 gap-3 rounded-lg border p-3">
            {([ ["vision", "图片理解"], ["video_analysis", "视频理解"] ] as const).map(([key, label]) => {
              let rule: Record<string, unknown> = {};
              try { rule = JSON.parse(advanced.runtime || "{}"); } catch { /* Keep the JSON editor editable. */ }
              const caps = (rule?.capabilities || {}) as Record<string, unknown>;
              const aliases = key === "vision" ? ["vision", "image_input", "multimodal"] : ["video_analysis", "video_input", "video_understanding"];
              const declared = aliases.find((alias) => typeof caps[alias] === "boolean");
              return <label key={key} className="text-xs text-gray-600">{label}
                <select className="mt-1 w-full rounded-lg border p-2" value={declared ? String(caps[declared]) : "inherit"} onChange={(e) => {
                  try {
                    const next = JSON.parse(advanced.runtime || "{}");
                    const capabilities = { ...(next.capabilities || {}) };
                    aliases.forEach((alias) => delete capabilities[alias]);
                    if (e.target.value !== "inherit") capabilities[key] = e.target.value === "true";
                    setAdvanced({ ...advanced, runtime: JSON.stringify({ ...next, capabilities }, null, 2) });
                  } catch { setMessage("请先修正线路运行规则 JSON"); }
                }}><option value="inherit">继承模型设置</option><option value="true">支持</option><option value="false">不支持</option></select>
              </label>;
            })}
            <p className="col-span-2 text-xs text-gray-500">作用于聊天、画布和工作流的分析请求；不支持所需媒体的线路会被跳过。勾选不会赋予上游模型本身不具备的能力。</p>
          </div>
          <label className="col-span-2 flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })} />启用该线路</label>
          <div className="col-span-2 flex items-center justify-between"><span className="text-xs text-red-500">{message}</span><div className="flex gap-2"><button type="button" onClick={() => setEditingId(null)} className="rounded-lg border px-4 py-2 text-xs">取消</button><button type="button" disabled={busy} onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? "保存中…" : "保存线路"}</button></div></div>
        </div>
      )}
      {editingId === null && message && <p className="mt-3 text-xs text-gray-600">{message}</p>}
    </section>
  );
}
