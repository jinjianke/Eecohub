import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EecoHub｜静态网站发布",
  description: "输入卡密，上传 HTML 或 ZIP，获得可公开访问的网址。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
