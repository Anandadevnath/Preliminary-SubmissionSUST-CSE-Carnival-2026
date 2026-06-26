import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Problem §4: must return {"status":"ok"} within 60s of service start.
 * No DB calls, no auth, no I/O — just a static JSON payload + timestamp.
 *
 * Per problem §4.1, this is the judge's readiness probe.
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