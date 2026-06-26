// scripts/audit-schema.mjs
// Round 3 — Schema audit (15-point category).
// Tests the route handlers via direct function call (no HTTP server needed).
// This is more reliable than booting Next.js for CI environments and lets
// us test the exact JSON contract the judges will see.

import { config } from "dotenv";
config({ path: ".env.local" });

// Import the pure orchestration function (no Next.js dependency).
const { analyzeTicket } = await import("../lib/analyze.js");

let pass = 0, fail = 0;
function check(label, cond, got = "", expected = "") {
  if (cond) { pass++; console.log("  ✔", label); }
  else {
    fail++;
    console.log(`  ✘ ${label} — got=${JSON.stringify(got).slice(0, 100)} expected=${JSON.stringify(expected).slice(0, 100)}`);
  }
}

const VALID_CASE_TYPES = ["wrong_transfer","payment_failed","refund_request","duplicate_payment","merchant_settlement_delay","agent_cash_in_issue","phishing_or_social_engineering","other"];
const VALID_SEVERITIES = ["low","medium","high","critical"];
const VALID_DEPARTMENTS = ["customer_support","dispute_resolution","payments_ops","merchant_operations","agent_operations","fraud_risk"];
const VALID_VERDICTS = ["consistent","inconsistent","insufficient_data"];

console.log("═══ Round 3: Schema — happy path ═══\n");
{
  const r = await analyzeTicket({
    ticket_id: "SCHEMA-001",
    complaint: "I sent 5000 taka to wrong number by mistake",
    transaction_history: [
      { transaction_id: "TXN-1", timestamp: "2026-04-14T14:08:22Z", type: "transfer", amount: 5000, status: "completed" },
    ],
  });
  check("status 200", r.status === 200, r.status);
  check("ok === true", r.ok === true);
  const j = r.body;
  const required = ["ticket_id","relevant_transaction_id","evidence_verdict","case_type","severity","department","agent_summary","recommended_next_action","customer_reply","human_review_required"];
  for (const f of required) check(`field ${f} present`, f in j);
  check("ticket_id is string", typeof j.ticket_id === "string");
  check("ticket_id echoed", j.ticket_id === "SCHEMA-001");
  check("relevant_transaction_id is string", typeof j.relevant_transaction_id === "string");
  check("evidence_verdict in enum", VALID_VERDICTS.includes(j.evidence_verdict), j.evidence_verdict);
  check("case_type in enum", VALID_CASE_TYPES.includes(j.case_type), j.case_type);
  check("severity in enum", VALID_SEVERITIES.includes(j.severity), j.severity);
  check("department in enum", VALID_DEPARTMENTS.includes(j.department), j.department);
  check("agent_summary is string ≥ 5 chars", typeof j.agent_summary === "string" && j.agent_summary.length >= 5);
  check("recommended_next_action is string ≥ 5 chars", typeof j.recommended_next_action === "string" && j.recommended_next_action.length >= 5);
  check("customer_reply is string ≥ 5 chars", typeof j.customer_reply === "string" && j.customer_reply.length >= 5);
  check("human_review_required is boolean", typeof j.human_review_required === "boolean");
  check("confidence is number 0..1", typeof j.confidence === "number" && j.confidence >= 0 && j.confidence <= 1, j.confidence);
  check("reason_codes is array", Array.isArray(j.reason_codes));
}

console.log("\n═══ Round 3: Schema — no transaction case ═══\n");
{
  const r = await analyzeTicket({
    ticket_id: "SCHEMA-002",
    complaint: "Something is unclear to me, please help",
    transaction_history: [],
  });
  check("status 200", r.status === 200);
  check("relevant_transaction_id === null when no match", r.body.relevant_transaction_id === null, r.body.relevant_transaction_id);
  check("case_type 'other' when truly ambiguous", r.body.case_type === "other", r.body.case_type);
}

console.log("\n═══ Round 3: Schema — error responses ═══\n");
{
  const r = await analyzeTicket({});
  check("empty body → 400", r.status === 400, r.status);
  check("body.error is string", typeof r.body.error === "string", r.body.error);
}
{
  const r = await analyzeTicket({ ticket_id: "X" });
  check("missing complaint → 400", r.status === 400, r.status);
  check("body.field present", typeof r.body.field === "string", r.body.field);
}
{
  const r = await analyzeTicket({ ticket_id: "X", complaint: "   " });
  check("whitespace complaint → 422", r.status === 422, r.status);
}
{
  const r = await analyzeTicket({ ticket_id: "X", complaint: "ok", transaction_history: "not array" });
  check("bad transaction_history → 400", r.status === 400, r.status);
}
{
  const r = await analyzeTicket({ ticket_id: "X", complaint: "ok", transaction_history: [{ transaction_id: "T", timestamp: "now", type: "invalid_type", amount: 100 }] });
  check("invalid txn type → 400", r.status === 400, r.status);
}
{
  const r = await analyzeTicket({ ticket_id: 12345, complaint: "ok" });
  check("non-string ticket_id → 400", r.status === 400, r.status);
}
{
  const r = await analyzeTicket({ ticket_id: "X", complaint: "ok", transaction_history: [{ transaction_id: "T", timestamp: "now", amount: "not a number" }] });
  check("non-number amount → 400", r.status === 400, r.status);
}

console.log("\n═══ Round 3: Schema — boundary inputs ═══\n");
{
  // Ticket_id exactly 1 char
  const r = await analyzeTicket({ ticket_id: "X", complaint: "test" });
  check("1-char ticket_id → 200", r.status === 200, r.status);
}
{
  // Ticket_id at max length (120 chars)
  const r = await analyzeTicket({ ticket_id: "X".repeat(120), complaint: "test" });
  check("120-char ticket_id → 200", r.status === 200, r.status);
}
{
  // Ticket_id over max
  const r = await analyzeTicket({ ticket_id: "X".repeat(121), complaint: "test" });
  check("121-char ticket_id → 400", r.status === 400, r.status);
}
{
  // Empty ticket_id
  const r = await analyzeTicket({ ticket_id: "", complaint: "test" });
  check("empty ticket_id → 400", r.status === 400, r.status);
}
{
  // Whitespace ticket_id
  const r = await analyzeTicket({ ticket_id: "   ", complaint: "test" });
  check("whitespace ticket_id → 400 (zod min(1) after trim)", r.status === 400, r.status);
}
{
  // 4000-char complaint (exact bound)
  const complaint = "a".repeat(4000);
  const r = await analyzeTicket({ ticket_id: "X", complaint });
  check("4000-char complaint → 200", r.status === 200, r.status);
}
{
  // 4001-char complaint (over bound)
  const complaint = "I sent 100 taka to wrong number. ".repeat(110); // 4070 chars (but actually 3630 — fix)
  const longComplaint = "a".repeat(4001);
  const r = await analyzeTicket({ ticket_id: "X", complaint: longComplaint });
  check("over-bound complaint → 400", r.status === 400, r.status);
}

console.log("\n═══ Round 3: Schema — 20 transactions (boundary) ═══\n");
{
  const history = Array.from({ length: 20 }, (_, i) => ({
    transaction_id: `TXN-${i}`,
    timestamp: "2026-04-14T14:08:22Z",
    type: "transfer",
    amount: 100 + i,
    status: "completed",
  }));
  const r = await analyzeTicket({ ticket_id: "X", complaint: "wrong number", transaction_history: history });
  check("20 transactions → 200", r.status === 200, r.status);
}
{
  // 21 transactions → schema reject
  const history = Array.from({ length: 21 }, (_, i) => ({
    transaction_id: `TXN-${i}`, timestamp: "2026-04-14T14:08:22Z", type: "transfer", amount: 100, status: "completed",
  }));
  const r = await analyzeTicket({ ticket_id: "X", complaint: "wrong number", transaction_history: history });
  check("21 transactions → 400", r.status === 400, r.status);
}

console.log("\n═══ Round 3: Schema — content-types and unknown fields ═══\n");
{
  // Extra unknown fields at top level
  const r = await analyzeTicket({
    ticket_id: "X",
    complaint: "test",
    unknown_field: "should be stripped",
    nested: { evil: true },
  });
  check("unknown fields allowed at top level → 200", r.status === 200, r.status);
}
{
  // Extra fields in transaction
  const r = await analyzeTicket({
    ticket_id: "X",
    complaint: "test",
    transaction_history: [{
      transaction_id: "T1", timestamp: "2026-04-14T14:08:22Z", type: "transfer", amount: 100, status: "completed",
      unknown: "field", evil_payload: "<script>",
    }],
  });
  // Zod by default strips unknown keys
  check("unknown txn fields stripped → 200", r.status === 200, r.status);
}

console.log("\n═══ Round 3: Schema — null handling ═══\n");
{
  const r = await analyzeTicket({
    ticket_id: "X",
    complaint: "test",
    transaction_history: [{ transaction_id: "T1", timestamp: "2026-04-14T14:08:22Z", type: "transfer", amount: null, status: null }],
  });
  check("null amount + null status → 200", r.status === 200, r.status);
  // No txn match expected → relevant_transaction_id null
  check("relevant_transaction_id is null", r.body.relevant_transaction_id === null, r.body.relevant_transaction_id);
}

console.log("\n═══ Round 3: Schema — response shape strictness ═══\n");
{
  const r = await analyzeTicket({
    ticket_id: "STRICT-001",
    complaint: "I sent 500 to wrong number",
    transaction_history: [{ transaction_id: "T1", timestamp: "2026-04-14T14:08:22Z", type: "transfer", amount: 500, status: "completed" }],
  });
  const allowed = new Set([
    "ticket_id","relevant_transaction_id","evidence_verdict","case_type","severity","department",
    "agent_summary","recommended_next_action","customer_reply","human_review_required","confidence","reason_codes",
  ]);
  const extra = Object.keys(r.body).filter((k) => !allowed.has(k));
  check("no extra fields in response (strict shape)", extra.length === 0, extra);
}

console.log("\n═══ Round 3 Results ═══");
console.log(`  ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
