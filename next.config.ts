import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Electron renderer: statik export (out/) — sunucu çalışmaz, her şey IPC üzerinden.
  output: "export",
  // file:// üzerinden yüklendiğinden göreli yollar gerekir.
  assetPrefix: "./",
  images: { unoptimized: true },
};

export default nextConfig;
