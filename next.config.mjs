import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin Turbopack's workspace root to this project. Without this, Next walks
  // up the directory tree looking for lockfiles and gets confused by the
  // unrelated package.json/package-lock.json in /home/raccoon.
  turbopack: {
    root: __dirname,
  },

  // Problem statement §4: judges call /health and /analyze-ticket.
  // The route handlers live under /api/* — rewrite to expose them at the root
  // paths so both URLs work without breaking existing callers.
  async rewrites() {
    return [
      { source: "/health", destination: "/api/health" },
      { source: "/analyze-ticket", destination: "/api/analyze-ticket" },
    ];
  },
};

export default nextConfig;
