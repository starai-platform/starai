import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StarAI 管理后台",
  icons: {
    icon: "/site-icon",
    shortcut: "/site-icon",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-surface">{children}</body>
    </html>
  );
}
