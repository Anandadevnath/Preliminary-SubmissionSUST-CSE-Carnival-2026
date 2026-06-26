// scripts/test-taxonomy-schemas.mjs
// Smoke test for module 1: taxonomy + zod schemas.
import { CASE_TYPES, DEFAULT_DEPARTMENT } from "../lib/taxonomy.js";
import { AnalyzeRequest, AnalyzeResponse } from "../lib/schemas.js";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ✔", name, detail); }
  else { fail++; console.log("  ✘", name, detail); }
}

console.log("\n── taxonomy ──");
check("8 case_types", CASE_TYPES.length === 8);
check("wrong_transfer is a case_type", CASE_TYPES.includes("wrong_transfer"));
check("phishing_or_social_engineering is a case_type", CASE_TYPES.includes("phishing_or_social_engineering"));
check("DEFAULT_DEPARTMENT.wrong_transfer = dispute_resolution",
  DEFAULT_DEPARTMENT.wrong_transfer === "dispute_resolution");

console.log("\n── schema: AnalyzeRequest ──");
const ok = AnalyzeRequest.safeParse({
  ticket_id: "T-1",
  complaint: "I sent 5000 taka to wrong number",
  language: "en",
  channel: "in_app_chat",
  user_type: "customer",
  transaction_history: [
    { transaction_id: "TXN-1", timestamp: "2026-04-14T14:08:22Z", type: "transfer", amount: 5000, status: "completed" }
  ],
});
check("valid request parses", ok.success);
check("parsed.complaint preserved", ok.success && ok.data.complaint === "I sent 5000 taka to wrong number");
check("default language applied", ok.success && ok.data.language === "en");

const empty = AnalyzeRequest.safeParse({ ticket_id: "T-2", complaint: "" });
check("empty complaint rejects", !empty.success);
check("empty complaint has helpful message", !empty.success && /complaint/.test(empty.error.issues[0]?.message || ""));

const missing = AnalyzeRequest.safeParse({});
check("missing both required fields rejects", !missing.success);

const bangla = AnalyzeRequest.safeParse({
  ticket_id: "T-BN",
  complaint: "আমি ভুল নম্বরে টাকা পাঠিয়ে দিয়েছি",
  language: "bn",
});
check("bangla request parses", bangla.success);
check("bangla language preserved", bangla.success && bangla.data.language === "bn");

const badEnum = AnalyzeRequest.safeParse({
  ticket_id: "T-3", complaint: "x", language: "fr",
});
check("invalid language rejects", !badEnum.success);

console.log("\n── schema: AnalyzeResponse ──");
const goodResp = AnalyzeResponse.safeParse({
  ticket_id: "T-1",
  relevant_transaction_id: "TXN-1",
  evidence_verdict: "consistent",
  case_type: "wrong_transfer",
  severity: "high",
  department: "dispute_resolution",
  agent_summary: "Customer reports sending 5000 BDT to wrong number via TXN-1.",
  recommended_next_action: "Verify TXN-1 with the customer.",
  customer_reply: "We have noted your concern about TXN-1.",
  human_review_required: true,
  confidence: 0.9,
  reason_codes: ["wrong_transfer", "transaction_match"],
});
check("valid response parses", goodResp.success);

const badCase = AnalyzeResponse.safeParse({
  ticket_id: "T-1", evidence_verdict: "consistent", case_type: "WRONG_TRANSFER",
  severity: "high", department: "dispute_resolution",
  agent_summary: "x", recommended_next_action: "x", customer_reply: "x",
  human_review_required: true,
});
check("uppercase case_type rejects (strict enum)", !badCase.success);

console.log(`\n${fail === 0 ? "✔" : "✘"} ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);