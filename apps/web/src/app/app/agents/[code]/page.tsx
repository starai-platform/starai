"use client";

import { pollAsync } from "@/lib/pollAsync";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, apiForLocale } from "@/lib/api";
import { SchemaForm, schemaDefaults } from "@/components/workbench/SchemaForm";
import { useI18n } from "@/i18n/I18nProvider";
import { AgentIcon } from "@/components/workbench/AgentIcon";
import { NovelWorkshopLanding } from "@/components/workbench/NovelWorkshopLanding";
import { PhotoStudioLanding, PhotoStudioInputBar, PhotoStudioTopBar } from "@/components/workbench/PhotoStudioLanding";
import { VirtualTryOnInputBar, VirtualTryOnLanding, VirtualTryOnResult } from "@/components/workbench/VirtualTryOnLanding";
import { NovelChapterList } from "@/components/workbench/NovelChapterList";
import { Loader2 } from "lucide-react";

interface Workflow {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  input_schema: Record<string, unknown>;
  nodes: { id: string; name: string; type: string }[];
  runtime_config?: { roles?: any[] };
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
  inputs?: Record<string, any>;
  outputs: Record<string, unknown>;
  actual_cost: number;
  error_message?: string;
  node_runs: NodeRun[];
}

const STATUS_KEY: Record<string, string> = {
  pending: "status.pending", running: "status.running", succeeded: "status.succeeded", failed: "status.failed",
};

// 写真馆照片单元：按任务状态展示生成中/失败/成片，图片加载失败时降级为失败态，避免破图图标
function PhotoStudioCell({ item, index }: { item: any; index: number }) {
  const { ts } = useI18n();
  const [broken, setBroken] = useState(false);
  const out = item.output || {};
  const url = String(out.image_url || (Array.isArray(out.images) && out.images[0]?.url) || "");
  if (item.status === "succeeded" && url && !broken) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-fuchsia-100 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img loading="lazy" decoding="async" src={url} alt={`写真 ${index + 1}`} onError={() => setBroken(true)} className="aspect-[3/4] w-full object-cover" />
      </a>
    );
  }
  if (item.status === "failed" || broken) {
    return <div className="flex aspect-[3/4] items-center justify-center rounded-2xl border border-red-100 bg-red-50/60 text-xs text-red-400 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300">{ts("生成失败")}</div>;
  }
  return (
    <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl bg-fuchsia-100/60 dark:bg-white/5">
      <Loader2 size={20} className="animate-spin text-fuchsia-400" />
      <span className="text-xs text-fuchsia-500 dark:text-fuchsia-300">{ts("生成中…")}</span>
    </div>
  );
}

export default function AgentWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const { t, ts, locale } = useI18n();
  const code = params?.code as string;
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [project, setProject] = useState<Project | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const pollRef = useRef<(() => void) | null>(null);
  const pollScopeRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    if (code) {
      apiForLocale<Workflow>(`/api/agents/${code}`, locale, { signal: controller.signal })
        .then((wf) => {
          if (controller.signal.aborted) return;
          setWorkflow(wf);
          setForm(schemaDefaults(wf.input_schema));
        })
        .catch((error) => {
          if (error?.name !== "AbortError") setWorkflow(null);
        });
    }
    return () => {
      controller.abort();
    };
  }, [code, locale]);

  useEffect(() => {
    pollScopeRef.current = code;
    return () => {
      pollScopeRef.current = null;
      pollRef.current?.();
    };
  }, [code]);

  const startPolling = (publicId: string) => {
    if (pollScopeRef.current !== code) return;
    pollRef.current?.();
    pollRef.current = pollAsync(async (signal) => {
      try {
        const p = await api<Project>(`/api/agent-projects/${publicId}`, { signal });
        if (signal.aborted) return;
        setProject(p);
        if (p.status === "succeeded" || p.status === "failed") {
          pollRef.current?.();
        }
      } catch {
        /* ignore */
      }
    }, 1500);
  };

  const run = async (inputs: Record<string, unknown> = form) => {
    setSubmitting(true);
    setError("");
    try {
      setForm(inputs);
      const p = await api<Project>(`/api/agents/${code}/projects`, {
        method: "POST",
        body: JSON.stringify({ inputs }),
      });
      setProject(p);
      startPolling(p.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("agentRun.startFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    if (!project) return;
    await api(`/api/agent-projects/${project.public_id}/retry`, { method: "POST" });
    startPolling(project.public_id);
  };

  const loadHistory = async (id: string) => {
    try {
      setError("");
      const p = await api<Project>(`/api/agent-projects/${id}`);
      setProject(p);
      if (p.status === "pending" || p.status === "running" || p.status === "waiting_confirm") startPolling(p.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("历史记录加载失败"));
    }
  };

  const confirmPhotoPlan = async (prompt: string) => {
    if (!project) return;
    setError("");
    try {
      await api(`/api/agent-projects/${project.public_id}/steps/confirm/confirm`, {
        method: "POST",
        body: JSON.stringify({ payload: { prompt } }),
      });
      const p = await api<Project>(`/api/agent-projects/${project.public_id}`);
      setProject(p);
      startPolling(p.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("agentRun.startFailed"));
    }
  };

  if (!workflow) {
    return <div className="flex-1 p-8 text-center text-gray-400">{t("common.loading")}</div>;
  }

  // 检查是否是AI小说工坊
  const isNovelWorkshop = workflow.code === 'ai_novel_workshop';
  const isPhotoStudio = workflow.code === 'ai_photo_studio';
  const runtime = workflow.runtime_config as any;
  const isVirtualTryOn = runtime?.agent_mode === "virtual_try_on" || runtime?.preset_code === "virtual_try_on" || workflow.code === "ai_virtual_tryon";
  const roles = workflow.runtime_config?.roles || [];

  if (isVirtualTryOn) {
    const tryOnBar = <VirtualTryOnInputBar key={`${photoInputKey}:${project?.public_id || "new"}`} defaultModelCode={runtime?.generation_model_code} initialInputs={project?.inputs} error={error} onSubmit={run} />;
    return (
      <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#fff1f3] text-gray-900 dark:bg-[#12070a] dark:text-white">
        <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(190,24,93,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(190,24,93,.05)_1px,transparent_1px)] [background-size:40px_40px]" />
        {project ? (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col"><VirtualTryOnResult workflowCode={workflow.code} workflowName={ts(workflow.name)} project={project as any} onNewTask={() => { setProject(null); setPhotoInputKey((key) => key + 1); }} onLoadHistory={loadHistory} /></div>
        ) : (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto"><VirtualTryOnLanding workflowCode={workflow.code} workflowName={ts(workflow.name)} workflowDescription={ts(workflow.description || "")} roles={roles} onNewTask={() => setPhotoInputKey((key) => key + 1)} onLoadHistory={loadHistory} /></div>
        )}
        {tryOnBar}
      </div>
    );
  }

  // 如果是写真馆，采用展示区 + 底部常驻输入栏结构（提交后不跳转）
  if (isPhotoStudio) {
    const photoBar = <PhotoStudioInputBar key={photoInputKey} defaultModelCode={(workflow.runtime_config as any)?.generation_model_code} error={error} onSubmit={run} />;
    if (!project) {
      return (
        <div className="relative flex h-screen flex-col overflow-hidden bg-[#fdf0f9] text-gray-900 dark:bg-[#0a0510] dark:text-white">
          <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(15,23,42,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.06)_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-60 dark:[background-image:linear-gradient(rgba(232,121,249,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(232,121,249,.08)_1px,transparent_1px)]" />
          <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto">
            <PhotoStudioLanding
              workflowCode={workflow.code}
              workflowName={ts(workflow.name)}
              workflowDescription={ts(workflow.description || "")}
              roles={roles}
              onNewTask={() => { setProject(null); setPhotoInputKey((k) => k + 1); }}
            />
          </div>
          {photoBar}
        </div>
      );
    }
    const outputs = project.outputs || {};
    const styling = (outputs.styling || {}) as Record<string, any>;
    const mediaItems = Array.isArray(outputs.media_tasks) ? outputs.media_tasks as any[] : [];
    const photoInFlight = project.status === "pending" || project.status === "running";
    const extraPhotoCells = photoInFlight ? Math.max(0, Number(project.inputs?.count || 1) - mediaItems.length) : 0;
    return (
      <div className="relative flex h-screen flex-col overflow-hidden bg-[#fdf0f9] text-gray-900 dark:bg-[#0a0510] dark:text-white">
        {/* 网格背景 overlay：与落地页保持一致，避免提交后背景突变 */}
        <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(15,23,42,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.06)_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-60 dark:[background-image:linear-gradient(rgba(232,121,249,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(232,121,249,.08)_1px,transparent_1px)]" />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-8">
          {/* 项目页保留顶栏：新任务/历史始终可见可点 */}
          <div className="mb-4">
            <PhotoStudioTopBar workflowCode={workflow.code} onNewTask={() => { setProject(null); setPhotoInputKey((k) => k + 1); }} onLoadHistory={loadHistory} />
          </div>
          {project.status === "waiting_confirm" && mediaItems.length === 0 ? (
            (() => {
              const plan = String(styling.generation_prompt || styling.summary || styling.base_prompt || "");
              return (
                <div className="mx-auto w-full max-w-4xl">
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{ts("造型设计完成，等待确认")}</h1>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{ts("确认拍摄方案后，摄影师将按方案开拍。")}</p>
                  <div className="mt-5 rounded-2xl border border-fuchsia-100 bg-white/80 p-5 dark:border-fuchsia-400/20 dark:bg-white/5">
                    <div className="mb-2 text-sm font-semibold text-fuchsia-600 dark:text-fuchsia-300">{ts("💄 拍摄方案")}</div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700 dark:text-gray-200">{plan}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button onClick={() => void confirmPhotoPlan(plan)} className="rounded-xl bg-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-400">{ts("确认方案并开拍")}</button>
                    <button onClick={() => setProject(null)} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-600 dark:border-white/15 dark:text-gray-300">{ts("返回重新配置")}</button>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="mx-auto w-full max-w-5xl">
              <button onClick={() => setProject(null)} className="mb-5 text-sm text-fuchsia-500 hover:text-fuchsia-600 dark:text-fuchsia-300">{ts("← 再拍一套")}</button>
              <div className="mb-6 flex items-center justify-between gap-4">
                <div><h1 className="text-2xl font-bold text-gray-900 dark:text-white">{ts(workflow.name)}</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{project.status === "succeeded" ? t("写真拍摄完成") : project.status === "failed" ? t("拍摄失败") : t("AI 摄影团队正在拍摄")}</p></div>
                <span className="rounded-full border border-fuchsia-200 px-3 py-1 text-xs text-fuchsia-600 dark:border-fuchsia-400/30 dark:text-fuchsia-300">{STATUS_KEY[project.status] ? t(STATUS_KEY[project.status]) : project.status}</span>
              </div>
              {styling.summary ? <div className="mb-4 rounded-2xl border border-fuchsia-100 bg-white/80 px-4 py-3 text-sm text-gray-600 dark:border-fuchsia-400/20 dark:bg-white/5 dark:text-gray-300"><span className="mr-2 font-semibold text-fuchsia-600 dark:text-fuchsia-300">{ts("💄 拍摄方案")}</span>{String(styling.summary)}</div> : null}
              {(mediaItems.length > 0 || extraPhotoCells > 0) && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {mediaItems.map((item, index) => <PhotoStudioCell key={String(item.task_no || index)} item={item} index={index} />)}
                  {Array.from({ length: extraPhotoCells }).map((_, index) => (
                    <div key={`extra-${index}`} className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl bg-fuchsia-100/60 dark:bg-white/5">
                      <Loader2 size={20} className="animate-spin text-fuchsia-400" />
                      <span className="text-xs text-fuchsia-500 dark:text-fuchsia-300">{ts("生成中…")}</span>
                    </div>
                  ))}
                </div>
              )}
              {project.status === "succeeded" && <div className="mt-4 text-xs text-gray-400">{t("agentRun.cost", { amount: project.actual_cost.toFixed(2) })}</div>}
              {project.status === "failed" && (
                <div className="mt-4">
                  <p className="mb-2 text-sm text-red-500">{project.error_message}</p>
                  <button onClick={retry} className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white">{t("common.retry")}</button>
                </div>
              )}
            </div>
          )}
        </div>
        {photoBar}
      </div>
    );
  }

  // 如果是小说工坊且没有项目，显示自定义Landing页面
  if (isNovelWorkshop && !project) {
    return (
      <div className="h-screen flex flex-col">
        <NovelWorkshopLanding
          workflowCode={workflow.code}
          workflowName={ts(workflow.name)}
          workflowDescription={ts(workflow.description || "")}
          roles={roles}
          onSubmit={run}
          onLoadHistory={loadHistory}
        />
      </div>
    );
  }

  if (isNovelWorkshop && project) {
    const outputs = project.outputs || {};
    const chapters = Array.isArray(outputs.chapters) ? outputs.chapters as any[] : [];
    return (
      <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#eaf7fb] text-gray-900 dark:bg-[#05080f] dark:text-white">
        <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(15,23,42,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.08)_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-60 dark:[background-image:linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)]" />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-3 py-1.5 sm:px-5 sm:py-2 lg:px-8"><PhotoStudioTopBar workflowCode={workflow.code} historyFallbackTitle={t("小说任务")} onNewTask={() => setProject(null)} onLoadHistory={loadHistory} /></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3 sm:px-8 sm:pt-5">
            <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div><h1 className="text-2xl font-bold">{ts(workflow.name)}</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{project.status === "waiting_confirm" ? t("等待你的确认") : project.status === "succeeded" ? t("全书创作完成") : t("AI 编辑部正在协作创作")}</p></div>
            <span className="rounded-full border border-indigo-300 px-3 py-1 text-xs text-indigo-600 dark:border-indigo-400/30 dark:text-indigo-300">{project.status}</span>
          </div>
          <NovelChapterList chapters={chapters} currentChapter={Number(outputs.current_chapter || chapters.length)} totalChapters={Number(outputs.total_chapters || 0)} />
          {project.error_message && <p className="mt-4 text-sm text-red-500 dark:text-red-400">{project.error_message}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        <button onClick={() => router.push("/app/agents")} className="text-sm text-gray-400 hover:text-gray-600 mb-4">
          ← {t("agentRun.back")}
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gray-900 text-white flex items-center justify-center text-2xl overflow-hidden">
            <AgentIcon value={workflow.icon} alt={ts(workflow.name)} />
          </div>
          <div>
            <h1 className="text-xl font-bold">{ts(workflow.name)}</h1>
            <p className="text-sm text-gray-500">{ts(workflow.description || "")}</p>
          </div>
        </div>

        <div className="soft-card p-5 mb-6 space-y-4">
          <SchemaForm schema={workflow.input_schema} values={form} onChange={setForm} layout="stacked" />
          {error && <p className="text-danger text-sm">{error}</p>}
            <button
            onClick={() => run()}
            disabled={submitting || (project?.status === "running" || project?.status === "pending")}
            className="px-6 py-2.5 rounded-xl bg-primary text-dark font-semibold text-sm disabled:opacity-50"
          >
            {submitting ? t("agentRun.starting") : t("agentRun.start")}
          </button>
        </div>

        {project && (
          <div className="soft-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{t("agentRun.progress")}</h2>
              <span className={`text-sm font-medium ${
                project.status === "succeeded" ? "text-emerald-600" :
                project.status === "failed" ? "text-red-500" : "text-amber-600"
              }`}>
                {STATUS_KEY[project.status] ? t(STATUS_KEY[project.status]) : project.status}
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
                      {STATUS_KEY[n.status] ? t(STATUS_KEY[n.status]) : n.status}
                    </span>
                  </div>
                  {n.error && <p className="text-xs text-red-500 mt-2">{n.error}</p>}
                  {n.output?.text != null && (
                    <p className="text-sm text-gray-700 mt-2 leading-relaxed">{String(n.output.text)}</p>
                  )}
                  {n.output?.image_url != null && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img loading="lazy" decoding="async" src={String(n.output.image_url)} alt="" className="mt-2 rounded-xl max-w-xs" />
                  )}
                  {n.output?.video_url != null && (
                    <video src={String(n.output.video_url)} controls className="mt-2 rounded-xl max-w-sm w-full" />
                  )}
                </div>
              ))}
            </div>

            {project.status === "succeeded" && (
              <div className="text-xs text-gray-400 mt-4">{t("agentRun.cost", { amount: project.actual_cost.toFixed(2) })}</div>
            )}
            {project.status === "failed" && (
              <div className="mt-4">
                <p className="text-sm text-red-500 mb-2">{project.error_message}</p>
                <button onClick={retry} className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm">{t("common.retry")}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
