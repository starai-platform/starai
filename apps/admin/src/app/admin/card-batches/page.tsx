"use client";



import { useEffect, useMemo, useState } from "react";

import { adminApi } from "@/lib/api";
import { AdminPagination } from "@/components/AdminPagination";

import type { CardBatch } from "@starai/shared-types";



interface Card {

  id: number;

  code?: string;

  value: number;

  status: string;

  used_by?: number | null;

  used_at?: string | null;

  created_at: string;

}

const PAGE_SIZE = 20;



const STATUS_LABEL: Record<string, string> = {

  unused: "未使用",

  used: "已使用",

  disabled: "已停用",

  expired: "已过期",

};



const STATUS_CLASS: Record<string, string> = {

  unused: "text-green-600",

  used: "text-gray-400",

  disabled: "text-red-500",

  expired: "text-amber-500",

};



function downloadText(filename: string, content: string) {

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");

  a.href = url;

  a.download = filename;

  a.click();

  URL.revokeObjectURL(url);

}



export default function CardBatchesPage() {

  const [batches, setBatches] = useState<CardBatch[]>([]);
  const [page, setPage] = useState(1);

  const [codes, setCodes] = useState<string[]>([]);

  const [lastBatchName, setLastBatchName] = useState("");

  const [form, setForm] = useState({ name: "", value: 100, quantity: 10 });

  const [creating, setCreating] = useState(false);

  const [msg, setMsg] = useState("");



  const [detailBatch, setDetailBatch] = useState<CardBatch | null>(null);

  const [cards, setCards] = useState<Card[]>([]);

  const [cardFilter, setCardFilter] = useState("");



  const load = () => adminApi<CardBatch[]>("/card-batches").then(setBatches);

  useEffect(() => {

    load();

  }, []);



  const handleCreate = async (e: React.FormEvent) => {

    e.preventDefault();

    setCreating(true);

    setMsg("");

    try {

      const res = await adminApi<{ batch: CardBatch; codes: string[] }>("/card-batches", {

        method: "POST",

        body: JSON.stringify({ ...form, type: "compute" }),

      });

      setCodes(res.codes || []);

      setLastBatchName(form.name);

      setMsg(`批次「${form.name}」已生成 ${res.codes?.length || 0} 张卡密，已加密保存，可随时在明细中查看`);

      setForm({ name: "", value: 100, quantity: 10 });

      load();

    } catch (err) {

      setMsg(err instanceof Error ? err.message : "生成失败");

    } finally {

      setCreating(false);

    }

  };



  const openDetail = async (b: CardBatch) => {

    setDetailBatch(b);

    setCardFilter("");

    setCards([]);

    const res = await adminApi<{ items: Card[] }>(`/card-batches/${b.id}/export`);

    setCards(res.items || []);

  };



  const refreshDetail = async () => {

    if (!detailBatch) return;

    const res = await adminApi<{ items: Card[] }>(`/card-batches/${detailBatch.id}/export`);

    setCards(res.items || []);

  };



  const disableCard = async (id: number) => {

    await adminApi(`/cards/${id}/disable`, { method: "PATCH" });

    refreshDetail();

  };



  const copyText = async (text: string) => {

    try {

      await navigator.clipboard.writeText(text);

      setMsg("已复制到剪贴板");

    } catch {

      setMsg("复制失败，请手动选择复制");

    }

  };



  const copyAllCodes = (list: string[]) => {

    if (!list.length) return;

    copyText(list.join("\n"));

  };



  const exportCsv = () => {

    if (!detailBatch) return;

    const header = "id,code,value,status,used_at,created_at\n";

    const rows = cards

      .map((c) =>

        [c.id, c.code || "", c.value, c.status, c.used_at || "", c.created_at]

          .map((v) => `"${String(v).replace(/"/g, '""')}"`)

          .join(",")

      )

      .join("\n");

    downloadText(`batch_${detailBatch.id}_cards.csv`, header + rows);

  };



  const filteredCards = useMemo(

    () => cards.filter((c) => !cardFilter || c.status === cardFilter),

    [cards, cardFilter]

  );



  const stats = useMemo(() => {

    const s: Record<string, number> = { unused: 0, used: 0, disabled: 0, expired: 0 };

    cards.forEach((c) => (s[c.status] = (s[c.status] || 0) + 1));

    return s;

  }, [cards]);



  const missingCodeCount = useMemo(() => cards.filter((c) => !c.code).length, [cards]);
  const paginatedBatches = useMemo(() => batches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [batches, page]);



  return (

    <div>

      <h1 className="text-2xl font-bold mb-6">卡密管理</h1>



      <form onSubmit={handleCreate} className="bg-white rounded-2xl p-6 border mb-6 flex flex-wrap gap-4 items-end">

        <div>

          <label className="text-xs text-gray-500">批次名称</label>

          <input

            className="block mt-1 px-3 py-2 border rounded-lg text-sm"

            value={form.name}

            onChange={(e) => setForm({ ...form, name: e.target.value })}

            required

          />

        </div>

        <div>

          <label className="text-xs text-gray-500">面值</label>

          <input

            type="number"

            className="block mt-1 px-3 py-2 border rounded-lg text-sm w-24"

            value={form.value}

            onChange={(e) => setForm({ ...form, value: parseFloat(e.target.value) })}

          />

        </div>

        <div>

          <label className="text-xs text-gray-500">数量</label>

          <input

            type="number"

            className="block mt-1 px-3 py-2 border rounded-lg text-sm w-24"

            value={form.quantity}

            onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) })}

          />

        </div>

        <button

          type="submit"

          disabled={creating}

          className="px-4 py-2 bg-primary rounded-xl text-dark font-semibold text-sm disabled:opacity-50"

        >

          {creating ? "生成中..." : "生成批次"}

        </button>

      </form>



      {msg && (

        <p className={`text-sm mb-4 ${msg.includes("失败") ? "text-red-600" : "text-emerald-600"}`}>{msg}</p>

      )}



      {codes.length > 0 && (

        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-6">

          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">

            <p className="text-sm font-medium text-green-700">

              批次「{lastBatchName}」已生成 {codes.length} 张卡密（已保存，可随时在明细查看）

            </p>

            <div className="flex items-center gap-3">

              <button onClick={() => copyAllCodes(codes)} className="text-xs text-green-700 hover:underline font-medium">

                复制全部

              </button>

              <button

                onClick={() => downloadText(`${lastBatchName || "cards"}.txt`, codes.join("\n"))}

                className="text-xs text-green-700 hover:underline font-medium"

              >

                下载 TXT

              </button>

              <button onClick={() => setCodes([])} className="text-xs text-green-600 hover:underline">

                收起

              </button>

            </div>

          </div>

          <div className="font-mono text-xs space-y-1 max-h-40 overflow-y-auto bg-white/60 rounded-lg p-3">

            {codes.map((c) => (

              <div key={c}>{c}</div>

            ))}

          </div>

        </div>

      )}



      <div className="bg-white rounded-2xl border overflow-hidden">

        <table className="w-full text-sm">

          <thead className="bg-gray-50 text-gray-500">

            <tr>

              <th className="text-left px-4 py-3">ID</th>

              <th className="text-left px-4 py-3">名称</th>

              <th className="text-left px-4 py-3">面值</th>

              <th className="text-left px-4 py-3">数量</th>

              <th className="text-left px-4 py-3">创建时间</th>

              <th className="text-left px-4 py-3">操作</th>

            </tr>

          </thead>

          <tbody className="divide-y">

            {paginatedBatches.map((b) => (

              <tr key={b.id}>

                <td className="px-4 py-3">{b.id}</td>

                <td className="px-4 py-3">{b.name}</td>

                <td className="px-4 py-3">{b.value}</td>

                <td className="px-4 py-3">{b.quantity}</td>

                <td className="px-4 py-3 text-xs text-gray-400">{new Date(b.created_at).toLocaleString()}</td>

                <td className="px-4 py-3">

                  <button onClick={() => openDetail(b)} className="text-xs text-secondary hover:underline">

                    查看明细

                  </button>

                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>
      <AdminPagination page={page} total={batches.length} pageSize={PAGE_SIZE} onPageChange={setPage} />



      {detailBatch && (

        <div

          className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"

          onClick={() => setDetailBatch(null)}

        >

          <div

            className="bg-white rounded-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col shadow-xl"

            onClick={(e) => e.stopPropagation()}

          >

            <div className="flex items-center justify-between px-6 py-4 border-b">

              <div>

                <h3 className="font-bold">批次明细 · {detailBatch.name}</h3>

                <p className="text-xs text-gray-400 mt-0.5">

                  未使用 {stats.unused} · 已使用 {stats.used} · 已停用 {stats.disabled}

                </p>

              </div>

              <button onClick={() => setDetailBatch(null)} className="text-sm text-gray-400 hover:text-gray-600">

                关闭

              </button>

            </div>



            <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b">

              <select

                value={cardFilter}

                onChange={(e) => setCardFilter(e.target.value)}

                className="px-3 py-1.5 rounded-lg border text-sm"

              >

                <option value="">全部状态</option>

                {Object.keys(STATUS_LABEL).map((s) => (

                  <option key={s} value={s}>

                    {STATUS_LABEL[s]}

                  </option>

                ))}

              </select>

              <button

                onClick={() => copyAllCodes(filteredCards.map((c) => c.code).filter(Boolean) as string[])}

                className="text-xs text-secondary hover:underline"

              >

                复制当前列表卡密

              </button>

              <button onClick={exportCsv} className="text-xs text-secondary hover:underline">

                导出 CSV

              </button>

              <span className="text-xs text-gray-400 ml-auto">

                卡密已加密存储，管理员可随时查看

                {missingCodeCount > 0 ? `（${missingCodeCount} 条历史数据无备份）` : ""}

              </span>

            </div>



            <div className="overflow-y-auto">

              <table className="w-full text-sm">

                <thead className="bg-gray-50 text-gray-500 sticky top-0">

                  <tr>

                    <th className="text-left px-6 py-2">卡密</th>

                    <th className="text-left px-6 py-2">面值</th>

                    <th className="text-left px-6 py-2">状态</th>

                    <th className="text-left px-6 py-2">使用时间</th>

                    <th className="text-left px-6 py-2">操作</th>

                  </tr>

                </thead>

                <tbody className="divide-y">

                  {filteredCards.map((c) => (

                    <tr key={c.id}>

                      <td className="px-6 py-2">

                        {c.code ? (

                          <div className="flex items-center gap-2">

                            <span className="font-mono text-xs text-gray-800">{c.code}</span>

                            <button

                              onClick={() => copyText(c.code!)}

                              className="text-[10px] text-secondary hover:underline shrink-0"

                            >

                              复制

                            </button>

                          </div>

                        ) : (

                          <span className="text-xs text-amber-500">历史批次无备份</span>

                        )}

                      </td>

                      <td className="px-6 py-2">{c.value}</td>

                      <td className={`px-6 py-2 ${STATUS_CLASS[c.status] || ""}`}>

                        {STATUS_LABEL[c.status] || c.status}

                      </td>

                      <td className="px-6 py-2 text-xs text-gray-400">

                        {c.used_at ? new Date(c.used_at).toLocaleString() : "—"}

                      </td>

                      <td className="px-6 py-2">

                        {c.status === "unused" ? (

                          <button onClick={() => disableCard(c.id)} className="text-xs text-red-500 hover:underline">

                            停用

                          </button>

                        ) : (

                          <span className="text-xs text-gray-300">—</span>

                        )}

                      </td>

                    </tr>

                  ))}

                  {filteredCards.length === 0 && (

                    <tr>

                      <td colSpan={5} className="text-center text-gray-400 py-8">

                        无符合条件的卡密

                      </td>

                    </tr>

                  )}

                </tbody>

              </table>

            </div>

          </div>

        </div>

      )}

    </div>

  );

}


