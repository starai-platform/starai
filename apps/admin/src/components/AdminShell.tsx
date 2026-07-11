"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import {
  Bell,
  Activity,
  BookOpen,
  Boxes,
  ChartNoAxesCombined,
  ClipboardList,
  CreditCard,
  FileText,
  GalleryHorizontalEnd,
  GitBranch,
  Layers3,
  Languages,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  ReceiptText,
  WalletCards,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { clearAdminSession, hasAdminSession } from "@/lib/api";
import { AdminBrand } from "./AdminBrand";

const NAV_GROUPS = [
  {
    title: "运营",
    items: [
      { href: "/admin/dashboard", label: "运营概览", icon: LayoutDashboard },
      { href: "/admin/ops", label: "运营巡检", icon: Activity },
      { href: "/admin/users", label: "用户管理", icon: Users },
      { href: "/admin/tasks", label: "任务管理", icon: ClipboardList },
    ],
  },
  {
    title: "模型管理",
    items: [
      { href: "/admin/models", label: "模型管理", icon: Boxes },
      { href: "/admin/agents", label: "工作流", icon: GitBranch },
      { href: "/admin/home-cards", label: "多模型卡片", icon: Layers3 },
      { href: "/admin/channel-presets", label: "渠道预设", icon: ChartNoAxesCombined },
      { href: "/admin/role-templates", label: "角色模板", icon: MessageSquareText },
      { href: "/admin/api-docs", label: "API 文档", icon: BookOpen },
      { href: "/admin/content-translations", label: "内容翻译", icon: Languages },
    ],
  },
  {
    title: "增长与内容",
    items: [
      { href: "/admin/card-batches", label: "卡密管理", icon: CreditCard },
      { href: "/admin/orders", label: "订单管理", icon: ReceiptText },
      { href: "/admin/withdrawals", label: "提现管理", icon: WalletCards },
      { href: "/admin/announcements", label: "公告管理", icon: Bell },
      { href: "/admin/gallery", label: "灵感广场", icon: GalleryHorizontalEnd },
    ],
  },
  {
    title: "系统",
    items: [
      { href: "/admin/operation-logs", label: "操作日志", icon: FileText },
      { href: "/admin/admin-accounts", label: "管理员账号", icon: ShieldCheck },
      { href: "/admin/system-config", label: "系统配置", icon: Settings },
    ],
  },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [adminEmail, setAdminEmail] = useState("");
  const [adminRole, setAdminRole] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasAdminSession()) {
      router.replace("/admin/login");
      return;
    }
    setAdminEmail(localStorage.getItem("admin_email") || "管理员");
    setAdminRole(localStorage.getItem("admin_role") || "");
    setReady(true);
  }, [router]);

  const logout = () => {
    clearAdminSession();
    router.push("/admin/login");
  };

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">正在验证登录状态...</div>;
  }

  return (
    <div className="flex min-h-screen bg-[#f3f5f9] text-gray-900">
      <aside className="sticky top-0 flex h-screen w-[272px] shrink-0 flex-col border-r border-gray-200/80 bg-white/95 backdrop-blur">
        <div className="border-b border-gray-100 px-5 py-5">
          <AdminBrand
            titleClassName="font-bold text-gray-950"
            subtitle={adminEmail}
            subtitleClassName="mt-0.5 truncate text-[11px] text-gray-400"
          />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-6">
              <div className="mb-2 px-3 text-[11px] font-semibold tracking-wide text-gray-400">{group.title}</div>
              <div className="space-y-1">
                {group.items.filter((item) => item.href !== "/admin/admin-accounts" || adminRole === "super_admin").map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={clsx(
                        "flex h-11 items-center gap-3 rounded-2xl px-3 text-sm transition",
                        active
                          ? "bg-gray-950 font-semibold text-white shadow-sm shadow-gray-950/10"
                          : "text-gray-600 hover:bg-gray-100/80 hover:text-gray-950"
                      )}
                    >
                      <Icon size={17} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-gray-100 p-4">
          <div className="mb-3 flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
            <ShieldCheck size={15} />
            后台会话已启用
          </div>
          <button onClick={logout} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            <LogOut size={16} />
            退出登录
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-5 lg:p-8">{children}</main>
    </div>
  );
}
