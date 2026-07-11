"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

interface WorkflowNode {
  id: string;
  type: string;
  name: string;
}

interface Workflow {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  nodes: WorkflowNode[];
  price_rule: { unit_price?: number };
}

export default function AgentsPage() {
	const { t } = useI18n();
  const [items, setItems] = useState<Workflow[]>([]);

  useEffect(() => {
    api<{ items: Workflow[] }>("/api/agents").then((r) => setItems(r.items || []));
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">{t("agent.listTitle")}</h1>
        <p className="text-sm text-gray-500 mb-6">{t("agent.listDesc")}</p>

        {items.length === 0 ? (
          <div className="text-center text-gray-400 py-16">{t("agent.listEmpty")}</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((w) => (
              <Link
                key={w.code}
                href={`/app/agents/${w.code}`}
                className="soft-card p-5 hover:shadow-lg transition block"
              >
                <div className="w-12 h-12 rounded-2xl bg-gray-900 text-white flex items-center justify-center text-2xl mb-3">
                  {w.icon || "🤖"}
                </div>
                <h3 className="font-semibold text-gray-900">{w.name}</h3>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{w.description}</p>
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  {w.nodes?.map((n, i) => (
                    <span key={n.id} className="flex items-center gap-1.5">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{n.name}</span>
                      {i < w.nodes.length - 1 && <span className="text-gray-300 text-xs">→</span>}
                    </span>
                  ))}
                </div>
                {w.price_rule?.unit_price != null && (
                  <div className="text-xs text-primary mt-3">≈ {w.price_rule.unit_price} {t("agent.costPerRun")}</div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
