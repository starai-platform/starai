"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAdminToken } from "@/lib/api";

export default function AdminRoot() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getAdminToken() ? "/admin/dashboard" : "/admin/login");
  }, [router]);
  return null;
}
