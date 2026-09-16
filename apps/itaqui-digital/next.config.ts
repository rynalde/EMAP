import type { NextConfig } from "next";
// standalone só é útil para hospedagem própria; na Vercel o build já é empacotado.
const config: NextConfig = {
  output: process.env.VERCEL ? undefined : "standalone",
  devIndicators: false,
};
export default config;
