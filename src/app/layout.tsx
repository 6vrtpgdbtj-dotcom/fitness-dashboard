import type { Metadata } from "next";
import "./globals.css";
import "@/components/dashboard/dashboard.css";

export const metadata: Metadata = {
  title: "1986 FITNESS | 중산점 운영",
  description: "중산점 운영 현황 대시보드"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
