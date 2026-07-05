"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, BadgeDollarSign, Banknote, BellRing, Bot, CreditCard, Gauge, Gift, Image, KeyRound, Network, ReceiptText, Share2, TrendingUp, Users, WalletCards } from "lucide-react";
import { adminApi } from "@/lib/api";
import type { AdminDashboard } from "@starai/shared-types";

const num = (v?: number) => (v ?? 0).toLocaleString("zh-CN");
const money = (v?: number) => `¥${(v ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const credit = (v?: number) => `${(v ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 算力`;

export default function DashboardPage() {
  const [stats, setStats] = useState<AdminDashboard | null>(null);

  useEffect(() => {
    adminApi<AdminDashboard>("/dashboard").then(setStats).catch(console.error);
  }, []);

  const successRate = useMemo(() => {
    if (!stats?.total_tasks) return 0;
    return Math.round((stats.succeeded_tasks / stats.total_tasks) * 1000) / 10;
  }, [stats]);

  const topCards = [
    { label: "注册用户", value: num(stats?.total_users), sub: `今日新增 ${num(stats?.new_users_today)}`, icon: Users },
    { label: "收入金额", value: money(stats?.total_revenue), sub: `在线 ${money(stats?.online_revenue)} / 卡密 ${credit(stats?.card_recharge_amount)}`, icon: BadgeDollarSign },
    { label: "消费金额", value: credit(stats?.total_consumption), sub: `今日消耗 ${credit(stats?.consumption_today)}`, icon: TrendingUp },
    { label: "任务成功率", value: `${successRate}%`, sub: `成功 ${num(stats?.succeeded_tasks)} / 失败 ${num(stats?.failed_tasks)}`, icon: Gauge },
  ];

  const secondary = [
    { label: "总任务数", value: num(stats?.total_tasks), sub: `今日 ${num(stats?.tasks_today)}`, icon: Activity },
    { label: "活跃模型", value: num(stats?.active_models), sub: "已启用模型数量", icon: Bot },
    { label: "API Token", value: num(stats?.api_tokens), sub: `API 调用 ${num(stats?.api_calls)} 次`, icon: KeyRound },
    { label: "API 成本", value: credit(stats?.api_cost), sub: `今日调用 ${num(stats?.api_calls_today)} 次`, icon: ReceiptText },
    { label: "可用卡密", value: num(stats?.available_cards), sub: `已兑换 ${num(stats?.used_cards)} 张`, icon: CreditCard },
    { label: "卡密面值池", value: credit(stats?.total_card_face_value), sub: "全部生成卡密面值", icon: WalletCards },
    { label: "已发布作品", value: num(stats?.published_works), sub: "灵感广场已通过内容", icon: Image },
    { label: "在线公告", value: num(stats?.published_announcements), sub: "当前已发布公告数量", icon: BellRing },
    { label: "推荐绑定用户", value: num(stats?.referred_users), sub: "已通过推荐码建立关系", icon: Share2 },
    { label: "活跃推荐人", value: num(stats?.active_referrers), sub: "已有直属下级的用户", icon: Network },
    { label: "推荐算力奖励", value: credit(stats?.referral_reward_compute), sub: "已发放到算力余额", icon: Gift },
    { label: "推荐现金奖励", value: money(stats?.referral_reward_cash), sub: "已发放到现金账户", icon: Banknote },
  ];

  const healthCards = [
    {
      label: "收入 / 消耗差额",
      value: credit((stats?.total_revenue ?? 0) - (stats?.total_consumption ?? 0)),
      sub: "可粗略观察平台毛余量",
    },
    {
      label: "平均每次 API 成本",
      value: stats?.api_calls ? credit((stats?.api_cost ?? 0) / stats.api_calls) : credit(0),
      sub: "总 API 成本 / 总 API 调用",
    },
    {
      label: "任务失败占比",
      value: `${stats?.total_tasks ? Math.round(((stats?.failed_tasks ?? 0) / stats.total_tasks) * 1000) / 10 : 0}%`,
      sub: "用于观察上游稳定性",
    },
    {
      label: "内容供给状态",
      value: `${num(stats?.published_works)} / ${num(stats?.published_announcements)}`,
      sub: "作品数 / 公告数",
    },
  ];

  const suggestions = [
    stats && stats.failed_tasks > 0 ? `失败任务 ${num(stats.failed_tasks)} 个，建议检查上游渠道稳定性和模型错误日志。` : "任务失败率正常，模型链路当前较稳定。",
    stats && stats.available_cards < 20 ? "可用卡密数量偏少，运营活动前建议提前生成新批次。" : "卡密库存充足，可继续支持兑换活动。",
    stats && stats.api_tokens > 0 ? "已有用户创建 API Token，可继续关注 API 调用成本和限额策略。" : "暂无活跃 API Token，可在前台 API 文档和套餐页加强引导。",
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">运营概览</h1>
          <p className="mt-1 text-sm text-gray-500">聚合收入、消耗、任务、API、卡密、内容和公告指标，方便快速判断平台运行状态。</p>
        </div>
        <div className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-500 shadow-sm">数据实时读取后台统计</div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {topCards.map((card) => {
          const Icon = card.icon;
          return (
            <section key={card.label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-gray-950/5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-500">{card.label}</div>
                  <div className="mt-2 text-2xl font-bold text-gray-950">{card.value}</div>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-950 text-white">
                  <Icon size={18} />
                </div>
              </div>
              <div className="mt-4 truncate text-xs text-gray-400">{card.sub}</div>
            </section>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-gray-950/5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-gray-950">关键运营指标</h2>
            <span className="text-xs text-gray-400">财务 / API / 卡密 / 内容</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {secondary.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>{item.label}</span>
                    <Icon size={16} />
                  </div>
                  <div className="mt-2 text-xl font-bold text-gray-950">{item.value}</div>
                  <div className="mt-1 truncate text-xs text-gray-400">{item.sub}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-gray-950/5">
          <h2 className="font-semibold text-gray-950">运营提醒</h2>
          <div className="mt-4 space-y-3">
            {suggestions.map((text, idx) => (
              <div key={idx} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm leading-relaxed text-gray-600">
                {text}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl bg-gray-950 p-4 text-sm text-white">
            <div className="text-white/60">平台沉淀余额</div>
            <div className="mt-1 text-2xl font-bold">{credit(stats?.wallet_balance_total)}</div>
            <div className="mt-2 text-xs text-white/50">用户钱包当前剩余算力总额，可用于观察未来交付压力。</div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-gray-950/5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-gray-950">经营健康度</h2>
          <span className="text-xs text-gray-400">帮助运营快速判断是否需要干预</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {healthCards.map((item) => (
            <div key={item.label} className="rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white p-4">
              <div className="text-sm text-gray-500">{item.label}</div>
              <div className="mt-2 text-xl font-bold text-gray-950">{item.value}</div>
              <div className="mt-1 text-xs text-gray-400">{item.sub}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
