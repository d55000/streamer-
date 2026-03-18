import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StreamPro — Universal Media Player",
  description:
    "A high-fidelity universal web media player supporting MP4, WebM, HLS, DASH, and MKV.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
