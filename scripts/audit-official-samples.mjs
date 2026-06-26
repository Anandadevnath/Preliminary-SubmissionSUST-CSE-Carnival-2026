// scripts/audit-official-samples.mjs
// Round 3.5 — Compare current analyzeTicket output against the 10 official
// SUST sample cases. For each case we check every required field and report
// any deviation, especially: relevant_transaction_id, evidence_verdict,
// case_type, department, severity, human_review_required.

import { config } from "dotenv";
config({ path: ".env.local" });
import { readFile } from "node:fs/promises";

const { analyzeTicket } = await import("../lib/analyze.js");

const raw = await readFile(new URL("./SUST_Preli_Sample_Cases.json", import.meta.url), "utf8");
const PACK = JSON.parse(raw);

let pass = 0, fail = 0;
const deviations = [];

function check(label, cond, got, expected) {
  if (cond) { pass++; console.log(`  ✔ ${label}`); }
  else {
    fail++;
    console.log(`  ✘ ${label} — got=${JSON.stringify(got)} expected=${JSON.stringify(expected)}`);
    deviations.push({ label, got, expected });
  }
}

console.log(`═══ Official SUST Sample Cases — ${PACK.cases.length} cases ═══\n`);

for (const c of PACK.cases) {
  console.log(`\n── ${c.id}: ${c.label} ──`);
  const r = await analyzeTicket(c.input);
  const exp = c.expected_output;

  // Required fields comparison
  check("ticket_id matches", r.body.ticket_id === exp.ticket_id, r.body.ticket_id, exp.ticket_id);
  check("relevant_transaction_id matches", r.body.relevant_transaction_id === exp.relevant_transaction_id, r.body.relevant_transaction_id, exp.relevant_transaction_id);
  check("evidence_verdict matches", r.body.evidence_verdict === exp.evidence_verdict, r.body.evidence_verdict, exp.evidence_verdict);
  check("case_type matches", r.body.case_type === exp.case_type, r.body.case_type, exp.case_type);
  check("severity matches", r.body.severity === exp.severity, r.body.severity, exp.severity);
  check("department matches", r.body.department === exp.department, r.body.department, exp.department);
  check("human_review_required matches", r.body.human_review_required === exp.human_review_required, r.body.human_review_required, exp.human_review_required);

  // Optional but expected
  if (exp.confidence !== undefined) {
    const close = typeof r.body.confidence === "number" &&
      Math.abs(r.body.confidence - exp.confidence) <= 0.15;
    check(`confidence ≈ ${exp.confidence}`, close, r.body.confidence, exp.confidence);
  }
  if (Array.isArray(exp.reason_codes)) {
    const haveSome = Array.isArray(r.body.reason_codes) && r.body.reason_codes.length > 0;
    check("reason_codes non-empty array", haveSome, r.body.reason_codes);
  }

  // Safety: never promise refund in customer_reply
  const cr = r.body.customer_reply || "";
  check("customer_reply is non-empty string", typeof cr === "string" && cr.length > 5, cr.slice(0, 50));
  check("customer_reply does NOT promise refund",
    !/\bwe (?:will|shall|'ll|are going to) refund\b/i.test(cr) &&
    !/\byour money will be refunded\b/i.test(cr) &&
    !/\bconfirming the refund\b/i.test(cr),
    cr.match(/\bwe (?:will|shall|'ll|are going to) refund\b/i)?.[0]
  );
  check("customer_reply does NOT ask for PIN/OTP",
    !/\b(?:share|provide|send|tell|give|enter)\s+(?:us|me|your|my)?\s*(?:pin|otp|password|secret|cvv)\b/i.test(cr) ||
    /\bdo not share\b/i.test(cr),
    cr.match(/\b(?:share|provide|send|tell|give|enter)\s+(?:us|me|your|my)?\s*(?:pin|otp|password)\b/i)?.[0]
  );
}

console.log("\n═══ Summary ═══");
console.log(`  ${pass} pass · ${fail} fail`);
if (deviations.length) {
  console.log("\n── All deviations ──");
  for (const d of deviations) console.log(`  ✘ ${d.label} — got=${JSON.stringify(d.got).slice(0, 80)} expected=${JSON.stringify(d.expected).slice(0, 80)}`);
}
process.exit(fail === 0 ? 0 : 1);
