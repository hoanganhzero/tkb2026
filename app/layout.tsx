import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://edutkb.tranquochoanganh1986.chatgpt.site"),
  title: "EduTKB – Quản lý thời khóa biểu thông minh",
  description: "Không gian điều phối lịch học dành cho nhà trường Việt Nam: khai báo, phân công, xếp lịch, kiểm tra xung đột và công bố thời khóa biểu.",
  openGraph: {
    title: "EduTKB",
    description: "Điều phối thời khóa biểu nhà trường rõ ràng, linh hoạt và đồng bộ.",
  },
  twitter: {
    card: "summary_large_image",
    title: "EduTKB",
    description: "Điều phối thời khóa biểu nhà trường rõ ràng, linh hoạt và đồng bộ.",
  },
  icons: {
    icon: "/edutkb-mark.svg",
    shortcut: "/edutkb-mark.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
