import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Lightweight liveness check. Must respond within 10s.
 * No DB calls, no auth, no I/O — just a static JSON payload + timestamp.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "queue-storm-triage",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}