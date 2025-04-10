import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codegrid Three.js Slider - Next.js",
  description: "Fluid distortion slider recreation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
