"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAdminToken } from "@/lib/api";

export default function AdminIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getAdminToken() ? "/admin/dashboard" : "/admin/login");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-400">
      正在进入后台...
    </div>
  );
}
