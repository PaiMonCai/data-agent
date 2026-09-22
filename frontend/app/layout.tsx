import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Data Agent",
  description: "自托管的数据分析 Agent",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
