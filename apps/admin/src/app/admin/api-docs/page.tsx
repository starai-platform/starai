"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api";
import { AdminPagination } from "@/components/AdminPagination";

interface AdminModel {
  id: number;
  code: string;
  display_name: string;
  category: string;
  request_mode: string;
  new_api_model: string;
  new_api_endpoint: string;
  is_enabled: boolean;
}

interface APIDoc {
  id: number;
  model_id: number;
  model_code: string;
  model_name: string;
  category: string;
  request_mode: string;
  new_api_model: string;
  slug: string;
  title: string;
  summary: string;
  protocol: string;
  base_url: string;
  endpoint: string;
  auth_header: string;
  sdk: string;
  content: Record<string, unknown>;
  is_published: boolean;
  sort_order: number;
}

interface FormState {
  id?: number;
  model_id: number;
  slug: string;
  title: string;
  summary: string;
  protocol: string;
  base_url: string;
  endpoint: string;
  auth_header: string;
  sdk: string;
  content: string;
  is_published: boolean;
  sort_order: number;
}

const EMPTY: FormState = {
  model_id: 0,
  slug: "",
  title: "",
  summary: "",
  protocol: "openai-compatible",
  base_url: "https://api.your-starai-domain.com",
  endpoint: "/v1/chat/completions",
  auth_header: "Authorization: Bearer <API_KEY>",
  sdk: "openai (Node/Python), curl",
  content: JSON.stringify(
    {
      features: ["OpenAI 兼容", "Bearer 鉴权", "标准 JSON 响应"],
      request_example: {
        model: "MODEL_CODE",
        messages: [{ role: "user", content: "你好，请介绍你的能力" }],
      },
      status_code: 200,
      http_status: 200,
      response_status: 200,
      response_example: {
        code: 0,
        message: "ok",
        data: {
          request_id: "req_xxx",
          conversation_id: "conv_xxx",
          content: "这是模型响应内容",
          cost: 0.01,
        },
      },
      responses: {
        "200": {
          description: "请求成功",
          body: {
            code: 0,
            message: "ok",
            data: {
              request_id: "req_xxx",
              conversation_id: "conv_xxx",
              content: "这是模型响应内容",
              cost: 0.01,
            },
          },
        },
        "400": { description: "请求参数错误", body: { code: 400, message: "模型不存在或未启用" } },
        "401": { description: "API Key 无效或已停用", body: { code: 401, message: "API Key 无效或已停用" } },
        "502": { description: "上游模型服务异常", body: { code: 502, message: "模型服务异常" } },
      },
      notes: ["请使用平台 API Key 调用", "model 字段填写平台模型编码"],
    },
    null,
    2
  ),
  is_published: true,
  sort_order: 0,
};

const PAGE_SIZE = 10;

function defaultEndpoint(mode: string, upstream?: string) {
  if (mode === "responses") return "/v1/responses";
  if (mode === "images") return "/v1/images/generations";
  if (mode === "video") return "/v1/video/generations";
  if (mode === "audio") return "/v1/audio/speech";
  if (mode === "custom" && upstream) return upstream;
  return "/v1/chat/completions";
}

function defaultProtocol(mode: string) {
  if (mode === "images") return "openai-compatible-image";
  if (mode === "video") return "new-api-compatible-video";
  if (mode === "audio") return "openai-compatible-audio";
  if (mode === "custom") return "custom-compatible";
  return "openai-compatible";
}

export default function AdminApiDocsPage() {
  const [docs, setDocs] = useState<APIDoc[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);

  const load = () => {
    adminApi<{ items: APIDoc[] }>("/api-docs").then((r) => setDocs(r.items || []));
    adminApi<AdminModel[]>("/models").then(setModels);
  };

  useEffect(() => {
    load();
  }, []);

  const usedModelIDs = useMemo(() => new Set(docs.filter((d) => d.id !== form.id).map((d) => d.model_id)), [docs, form.id]);
  const selectableModels = useMemo(() => models.filter((m) => !usedModelIDs.has(m.id)), [models, usedModelIDs]);
  const paginatedDocs = useMemo(() => docs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [docs, page]);

  const selectModel = (modelID: number) => {
    const m = models.find((x) => x.id === modelID);
    if (!m) {
      setForm({ ...form, model_id: modelID });
      return;
    }
    const nextContent = JSON.parse(form.content || "{}");
    nextContent.request_example = {
      ...(nextContent.request_example || {}),
      model: m.code,
    };
    setForm({
      ...form,
      model_id: m.id,
      slug: form.slug || m.code,
      title: form.title || m.display_name,
      summary: form.summary || `${m.display_name} 标准兼容调用文档`,
      protocol: defaultProtocol(m.request_mode),
      endpoint: defaultEndpoint(m.request_mode, m.new_api_endpoint),
      content: JSON.stringify(nextContent, null, 2),
    });
  };

  const openCreate = () => {
    setForm(EMPTY);
    setMsg("");
    setShowForm(true);
  };

  const openEdit = (doc: APIDoc) => {
    setForm({
      id: doc.id,
      model_id: doc.model_id,
      slug: doc.slug,
      title: doc.title,
      summary: doc.summary,
      protocol: doc.protocol,
      base_url: doc.base_url,
      endpoint: doc.endpoint,
      auth_header: doc.auth_header,
      sdk: doc.sdk,
      content: JSON.stringify(doc.content || {}, null, 2),
      is_published: doc.is_published,
      sort_order: doc.sort_order,
    });
    setMsg("");
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");
    let content: Record<string, unknown>;
    try {
      content = JSON.parse(form.content || "{}");
    } catch {
      setMsg("content JSON 格式错误");
      return;
    }
    if (!form.model_id) {
      setMsg("请选择平台已接入模型");
      return;
    }
    setSaving(true);
    const payload = { ...form, content, id: undefined };
    try {
      if (form.id) {
        await adminApi(`/api-docs/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await adminApi("/api-docs", { method: "POST", body: JSON.stringify(payload) });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (doc: APIDoc) => {
    if (!confirm(`确认删除「${doc.title}」的 API 文档？`)) return;
    await adminApi(`/api-docs/${doc.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">API 文档管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            文档必须选择平台已有模型；未接入模型不会出现在下拉列表中。
          </p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 rounded-xl bg-primary text-dark font-semibold text-sm">
          新增 API 文档
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="bg-white rounded-2xl p-6 border mb-6 grid grid-cols-2 gap-4">
          <div className="col-span-2 flex items-center justify-between">
            <h2 className="font-semibold">{form.id ? "编辑 API 文档" : "新增 API 文档"}</h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm text-gray-400 hover:text-gray-600">
              取消
            </button>
          </div>

          <div>
            <label className="text-xs text-gray-500">绑定模型（仅平台已接入）</label>
            <select
              value={form.model_id}
              onChange={(e) => selectModel(Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
              required
            >
              <option value={0}>请选择模型</option>
              {selectableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}（{m.code} / {m.request_mode}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Slug</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500">标题</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="text-xs text-gray-500">协议类型</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500">简介</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Base URL</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Endpoint</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500">鉴权 Header</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.auth_header} onChange={(e) => setForm({ ...form, auth_header: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500">SDK 建议</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.sdk} onChange={(e) => setForm({ ...form, sdk: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500">content JSON（features / request_example / response_example / notes）</label>
            <textarea className="w-full mt-1 px-3 py-2 rounded-lg border text-xs font-mono h-64" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
            发布到前台
          </label>
          <div>
            <label className="text-xs text-gray-500">排序</label>
            <input type="number" className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })} />
          </div>
          {msg && <p className={`col-span-2 text-sm ${msg.includes("失败") || msg.includes("错误") ? "text-red-500" : "text-emerald-600"}`}>{msg}</p>}
          <button type="submit" disabled={saving} className="col-span-2 py-2 bg-primary rounded-xl text-dark font-semibold disabled:opacity-50">
            {saving ? "保存中..." : "保存 API 文档"}
          </button>
        </form>
      )}

      <div className="bg-white rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-4 py-3">文档</th>
              <th className="text-left px-4 py-3">绑定模型</th>
              <th className="text-left px-4 py-3">端点</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {paginatedDocs.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{d.title}</div>
                  <div className="text-xs text-gray-400 font-mono">{d.slug}</div>
                </td>
                <td className="px-4 py-3">
                  <div>{d.model_name}</div>
                  <div className="text-xs text-gray-400">{d.model_code}</div>
                </td>
                <td className="px-4 py-3 text-xs font-mono text-gray-500">{d.endpoint}</td>
                <td className="px-4 py-3">
                  {d.is_published ? (
                    <span className="text-green-600">已发布</span>
                  ) : (
                    <span className="text-gray-400">草稿</span>
                  )}
                </td>
                <td className="px-4 py-3 space-x-3">
                  <button onClick={() => openEdit(d)} className="text-xs text-secondary hover:underline">编辑</button>
                  <button onClick={() => remove(d)} className="text-xs text-red-500 hover:underline">删除</button>
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-8">暂无 API 文档</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AdminPagination page={page} total={docs.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </div>
  );
}
