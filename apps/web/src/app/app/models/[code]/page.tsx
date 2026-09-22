"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Model } from "@starai/shared-types";
import { ModelWorkspace } from "@/components/workbench/ModelWorkspace";
import { useI18n } from "@/i18n/I18nProvider";

export default function ModelDetailPage() {
  const { code } = useParams<{ code: string }>();
  const { ts } = useI18n();
  const [model, setModel] = useState<Model | null>(null);

  useEffect(() => {
    api<Model>(`/api/models/${code}`).then(setModel).catch(console.error);
  }, [code]);

  if (!model) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        {ts("加载中...")}
      </div>
    );
  }

  return <ModelWorkspace model={model} />;
}
