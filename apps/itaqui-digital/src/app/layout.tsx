import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
export const metadata: Metadata = {
  title: "Itaqui Digital — Mapa do Porto do Itaqui",
  description:
    "Explore o mapa do Porto do Itaqui. Infraestrutura, programação de navios, clima e integração AIS em uma experiência geográfica interativa.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0c181c",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
