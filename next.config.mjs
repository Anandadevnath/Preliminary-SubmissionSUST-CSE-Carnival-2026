/** @type {import('next').NextConfig} */
const nextConfig = {
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
