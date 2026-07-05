"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi, adminUploadFile } from "@/lib/api";
import { AdminPagination } from "@/components/AdminPagination";

type RoleTemplate = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  system_prompt: string;
  icon_url?: string | null;
  is_enabled: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

type FormState = {
  isEdit: boolean;
  code: string;
  name: string;
  description: string;
  system_prompt: string;
  icon_url: string;
  is_enabled: boolean;
  sort_order: number;
};

const empty: FormState = {
  isEdit: false,
  code: "",
  name: "",
  description: "",
  system_prompt: "",
  icon_url: "",
  is_enabled: true,
  sort_order: 0,
};

const PAGE_SIZE = 10;

export default function RoleTemplatesPage() {
  const [items, setItems] = useState<RoleTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((i) => (i.code + " " + i.name + " " + (i.description || "")).toLowerCase().includes(kw));
  }, [items, q]);
  const paginated = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await adminApi<{ items: RoleTemplate[] }>("/role-templates");
      setItems(r.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [q]);

  const startEdit = (t: RoleTemplate) => {
    setForm({
      isEdit: true,
      code: t.code,
      name: t.name,
      description: (t.description as string) || "",
      system_prompt: t.system_prompt || "",
      icon_url: (t.icon_url as string) || "",
      is_enabled: !!t.is_enabled,
      sort_order: t.sort_order || 0,
    });
    setFormOpen(true);
  };

  const startCreate = () => {
    setForm(empty);
    setFormOpen(true);
  };

  const reset = () => {
    setForm(empty);
    setFormOpen(false);
  };

  const uploadIcon = async (file: File) => {
    const url = await adminUploadFile(file);
    setForm((p) => ({ ...p, icon_url: url }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await adminApi("/role-templates", {
      method: "POST",
      body: JSON.stringify({
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        system_prompt: form.system_prompt,
        icon_url: form.icon_url,
        is_enabled: form.is_enabled,
        sort_order: form.sort_order,
      }),
    });
    reset();
    refresh();
  };

  const toggleEnabled = async (t: RoleTemplate) => {
    await adminApi("/role-templates", {
      method: "POST",
      body: JSON.stringify({
        code: t.code,
        name: t.name,
        description: t.description || "",
        system_prompt: t.system_prompt || "",
        icon_url: t.icon_url || "",
        is_enabled: !t.is_enabled,
        sort_order: t.sort_order || 0,
      }),
    });
    refresh();
  };

  const del = async (code: string) => {
    if (!confirm(`确认删除模板 ${code}？`)) return;
    await adminApi(`/role-templates/${encodeURIComponent(code)}`, { method: "DELETE" });
    refresh();
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <h1 className="text-2xl font-bold">角色模板</h1>
          <p className="text-sm text-gray-500 mt-1">维护前台“创建角色”可选模板（支持上传 LOGO）。</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={refresh} className="px-4 py-2 rounded-xl border text-sm hover:bg-gray-50">
            刷新
          </button>
          <button onClick={startCreate} className="px-4 py-2 rounded-xl bg-primary text-dark font-semibold text-sm">
            新增模板
          </button>
        </div>
      </div>

      {formOpen && (
      <form onSubmit={save} className="bg-white rounded-2xl border p-6 mb-6 grid grid-cols-2 gap-4">
        <div className="col-span-2 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">{form.isEdit ? "编辑模板" : "新增模板"}</h2>
          <button type="button" onClick={reset} className="text-sm text-gray-500 hover:text-gray-700">
            收起
          </button>
        </div>
        <div className="col-span-2 px-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm text-gray-600">
          模板将出现在用户端“角色管理 → 创建角色 → 选择模板”中。建议填入清晰的系统提示词，并设置合适的排序。
        </div>
        <div>
          <label className="text-xs text-gray-500">code（唯一）</label>
          <input
            className="w-full mt-1 px-3 py-2 rounded-lg border text-sm font-mono"
            placeholder="writer_master"
            value={form.code}
            disabled={form.isEdit}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">名称</label>
          <input
            className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
            placeholder="全能写作大师"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500">描述</label>
          <input
            className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
            placeholder="一句话描述（可选）"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        <div className="col-span-2">
          <label className="text-xs text-gray-500">LOGO</label>
          <div className="mt-1 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center">
              {form.icon_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.icon_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-gray-400">无</span>
              )}
            </div>
            <label className="px-3 py-2 rounded-lg border text-sm cursor-pointer hover:bg-gray-50">
              上传
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadIcon(f);
                  e.target.value = "";
                }}
              />
            </label>
            <input
              className="flex-1 px-3 py-2 rounded-lg border text-sm"
              placeholder="或粘贴图片 URL"
              value={form.icon_url}
              onChange={(e) => setForm({ ...form, icon_url: e.target.value })}
            />
          </div>
        </div>

        <div className="col-span-2">
          <label className="text-xs text-gray-500">system_prompt</label>
          <textarea
            className="w-full mt-1 px-3 py-2 rounded-lg border text-xs font-mono h-28"
            placeholder="你是一位..."
            value={form.system_prompt}
            onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
          />
        </div>

        <div>
          <label className="text-xs text-gray-500">排序</label>
          <input
            type="number"
            className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
            value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value || "0", 10) })}
          />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })} />
          <span className="text-sm text-gray-700">启用</span>
        </div>

        <div className="col-span-2 flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={reset} className="px-4 py-2 rounded-xl border text-sm">
            取消
          </button>
          <button type="submit" className="px-4 py-2 rounded-xl bg-primary text-dark font-semibold text-sm">
            {form.isEdit ? "保存修改" : "确认新增"}
          </button>
        </div>
      </form>
      )}

      <div className="bg-white rounded-2xl border p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="font-semibold">模板列表</div>
          <input className="px-3 py-2 rounded-xl border text-sm w-[280px]" placeholder="搜索 code / 名称" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {loading ? (
          <div className="text-sm text-gray-400 py-10 text-center">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-gray-400 py-10 text-center">暂无模板</div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {paginated.map((t) => (
              <div key={t.code} className="border rounded-2xl p-4 flex items-start justify-between gap-4 hover:border-gray-300 transition bg-white">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0">
                    {t.icon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.icon_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-gray-400">无</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-gray-900">{t.name}</div>
                      <span className="text-xs text-gray-400 font-mono">{t.code}</span>
                      {!t.is_enabled && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">已停用</span>}
                    </div>
                    <div className="text-sm text-gray-500 mt-1 line-clamp-2">{t.description}</div>
                    <div className="text-xs text-gray-400 mt-2 line-clamp-2 font-mono">{t.system_prompt}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleEnabled(t)}
                    className={`px-3 py-2 rounded-xl border text-sm ${
                      t.is_enabled ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/15" : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {t.is_enabled ? "停用" : "启用"}
                  </button>
                  <button onClick={() => startEdit(t)} className="px-3 py-2 rounded-xl border text-sm hover:bg-gray-50">
                    编辑
                  </button>
                  <button onClick={() => del(t.code)} className="px-3 py-2 rounded-xl border text-sm text-red-600 hover:bg-red-50">
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <AdminPagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>
    </div>
  );
}

