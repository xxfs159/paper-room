import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paper Room · 论文阅读室",
  description: "导入论文，在原文旁翻译、理解与提问。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
