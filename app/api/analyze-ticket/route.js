import { NextResponse } from "next/server";
import { analyzeTicket } from "@/lib/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/analyze-ticket
 *
 * Thin wrapper: parse JSON, hand off to lib/analyze.js, return result.
 * All real logic lives in lib/analyze.js so the local test harness can
 * exercise the same code path without booting Next.js.
 */
export async function POST(req) {
  let raw;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }
  const result = await analyzeTicket(raw);
  return NextResponse.json(result.body, { status: result.status });
}

// Defensive: log unexpected methods so debugging a misconfigured harness is
// easier. We don't throw — just return a 405.
export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } }
  );
}