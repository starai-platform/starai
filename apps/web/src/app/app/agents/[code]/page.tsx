"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { SchemaForm, schemaDefaults } from "@/components/workbench/SchemaForm";

interface Workflow {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  input_schema: Record<string, unknown>;
  nodes: { id: string; name: string; type: string }[];
}

interface NodeRun {
  node_id: string;
  name: string;
  type: string;
  status: string;
  output: Record<string, unknown>;
  cost: number;
  error?: string;
}

interface Project {
  public_id: string;
  status: string;
  outputs: Record<string, unknown>;
  actual_cost: number;
  error_message?: string;
  node_runs: NodeRun[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中", running: "执行中", succeeded: "已完成", failed: "失败",
};

export default function AgentWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const code = params?.code as string;
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [project, setProject] = useState<Project | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (code)
      api<Workflow>(`/api/agents/${code}`)
        .then((wf) => {
          setWorkflow(wf);
          setForm(schemaDefaults(wf.input_schema));
        })
        .catch(() => setWorkflow(null));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [code]);

  const startPolling = (publicId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const p = await api<Project>(`/api/agent-projects/${publicId}`);
        setProject(p);
        if (p.status === "succeeded" || p.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        /* ignore */
      }
    }, 1500);
  };

  const run = async () => {
    setSubmitting(true);
    setError("");
    try {
      const p = await api<Project>(`/api/agents/${code}/projects`, {
        method: "POST",
        body: JSON.stringify({ inputs: form }),
      });
      setProject(p);
      startPolling(p.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动失败");
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    if (!project) return;
    await api(`/api/agent-projects/${project.public_id}/retry`, { method: "POST" });
    startPolling(project.public_id);
  };

  if (!workflow) {
    return <div className="flex-1 p-8 text-center text-gray-400">加载中...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        <button onClick={() => router.push("/app/agents")} className="text-sm text-gray-400 hover:text-gray-600 mb-4">
          ← 返回智能体
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gray-900 text-white flex items-center justify-center text-2xl">
            {workflow.icon || "🤖"}
          </div>
          <div>
            <h1 className="text-xl font-bold">{workflow.name}</h1>
            <p className="text-sm text-gray-500">{workflow.description}</p>
          </div>
        </div>

        <div className="soft-card p-5 mb-6 space-y-4">
          <SchemaForm schema={workflow.input_schema} values={form} onChange={setForm} layout="stacked" />
          {error && <p className="text-danger text-sm">{error}</p>}
          <button
            onClick={run}
            disabled={submitting || (project?.status === "running" || project?.status === "pending")}
            className="px-6 py-2.5 rounded-xl bg-primary text-dark font-semibold text-sm disabled:opacity-50"
          >
            {submitting ? "启动中..." : "开始生成"}
          </button>
        </div>

        {project && (
          <div className="soft-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">执行进度</h2>
              <span className={`text-sm font-medium ${
                project.status === "succeeded" ? "text-emerald-600" :
                project.status === "failed" ? "text-red-500" : "text-amber-600"
              }`}>
                {STATUS_LABEL[project.status] || project.status}
              </span>
            </div>

            <div className="space-y-3">
              {(project.node_runs || []).map((n) => (
                <div key={n.node_id} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{n.name}</span>
                    <span className={`text-xs ${
                      n.status === "succeeded" ? "text-emerald-600" :
                      n.status === "failed" ? "text-red-500" :
                      n.status === "running" ? "text-amber-600" : "text-gray-400"
                    }`}>
                      {STATUS_LABEL[n.status] || n.status}
                    </span>
                  </div>
                  {n.error && <p className="text-xs text-red-500 mt-2">{n.error}</p>}
                  {n.output?.text != null && (
                    <p className="text-sm text-gray-700 mt-2 leading-relaxed">{String(n.output.text)}</p>
                  )}
                  {n.output?.image_url != null && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={String(n.output.image_url)} alt="" className="mt-2 rounded-xl max-w-xs" />
                  )}
                  {n.output?.video_url != null && (
                    <video src={String(n.output.video_url)} controls className="mt-2 rounded-xl max-w-sm w-full" />
                  )}
                </div>
              ))}
            </div>

            {project.status === "succeeded" && (
              <div className="text-xs text-gray-400 mt-4">本次消耗 {project.actual_cost.toFixed(2)} 算力</div>
            )}
            {project.status === "failed" && (
              <div className="mt-4">
                <p className="text-sm text-red-500 mb-2">{project.error_message}</p>
                <button onClick={retry} className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm">重试</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
