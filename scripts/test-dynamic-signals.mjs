// scripts/test-dynamic-signals.mjs
// Verifies that the classifier's confidence, human_review_score, and
// evidence_verdict respond dynamically to the actual evidence rather than
// collapsing to flat constants. Run with:
//
//   node scripts/test-dynamic-signals.mjs
//
// Each assertion targets a specific dimension (keyword, transaction match,
// evidence, amount alignment, ambiguity) so a regression in any one
// dimension is caught here even if the headline numbers still happen to
// fall within tolerance elsewhere.

import { classify } from "../lib/classifier.js";
import { readFile } from "node:fs/promises";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ✔", name, detail); }
  else { fail++; console.log("  ✘", name, detail); }
}

const TXN = (id, opts = {}) => ({
  transaction_id: id,
  timestamp: opts.timestamp || "2026-04-14T14:08:22Z",
  type: opts.type || "transfer",
  amount: opts.amount ?? 5000,
  counterparty: opts.counterparty || "+8801719876543",
  status: opts.status || "completed",
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n── confidence discriminates across cases ──");
// Two complaints with the same keyword score but different evidence should
// produce different confidences. This is the headline test for the
// "dynamic, not static" promise.
{
  // (a) Strong match: clean wrong_transfer, amount aligns, single txn.
  const a = classify({
    complaint: "I sent 5000 taka to a wrong number.",
    language: "en",
    transaction_history: [TXN("TXN-A", { amount: 5000 })],
  });
  // (b) Same complaint, but no transaction history at all.
  const b = classify({
    complaint: "I sent 5000 taka to a wrong number.",
    language: "en",
    transaction_history: [],
  });
  check("clean match confidence > no-txn confidence",
    a.confidence > b.confidence,
    `clean=${a.confidence} no_txn=${b.confidence}`);
  check("clean match confidence ≥ 0.65",
    a.confidence >= 0.65, `got=${a.confidence}`);
  check("no-txn confidence < 0.65",
    b.confidence < 0.65, `got=${b.confidence}`);
  check("amount_alignment = 1.0 on clean match",
    a.signal_breakdown.amount_alignment === 1);
  check("transaction_match > 0 on clean match",
    a.signal_breakdown.transaction_match > 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n── ambiguity dampens confidence ──");
// Ambiguous-match cases must produce visibly lower confidence than the
// equivalent single-match case.
{
  const unambiguous = classify({
    complaint: "I sent 1000 taka to the wrong number by mistake.",
    language: "en",
    transaction_history: [TXN("TXN-U", { amount: 1000 })],
  });
  const ambiguous = classify({
    complaint: "I sent 1000 taka to the wrong number by mistake.",
    language: "en",
    transaction_history: [
      TXN("TXN-A1", { amount: 1000, counterparty: "+8801712001122" }),
      TXN("TXN-A2", { amount: 1000, counterparty: "+8801812334455" }),
      TXN("TXN-A3", { amount: 1000, counterparty: "+8801712001122", status: "failed" }),
    ],
  });
  check("ambiguous confidence < unambiguous confidence",
    ambiguous.confidence < unambiguous.confidence,
    `ambig=${ambiguous.confidence} unambig=${unambiguous.confidence}`);
  check("ambiguous has ambiguity_penalty = 1",
    ambiguous.signal_breakdown.ambiguity_penalty === 1);
  check("ambiguous has match_quality = 'ambiguous'",
    ambiguous.match_quality === "ambiguous");
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n── evidence_verdict responds to actual data ──");
// Same case_type, different status → different verdict.
{
  const rFailed = classify({
    complaint: "payment failed but balance deducted 1000 taka",
    language: "en",
    transaction_history: [TXN("TXN-F", { type: "payment", amount: 1000, status: "failed" })],
  });
  const rCompleted = classify({
    complaint: "payment failed but balance deducted 1000 taka",
    language: "en",
    transaction_history: [TXN("TXN-C", { type: "payment", amount: 1000, status: "completed" })],
  });
  check("failed txn → consistent",
    rFailed.evidence_verdict === "consistent",
    `got=${rFailed.evidence_verdict}`);
  check("completed txn → inconsistent",
    rCompleted.evidence_verdict === "inconsistent",
    `got=${rCompleted.evidence_verdict}`);
  check("inconsistent evidence → higher human_review_score than consistent",
    rCompleted.human_review_score > rFailed.human_review_score,
    `incon=${rCompleted.human_review_score} con=${rFailed.human_review_score}`);
  check("inconsistent evidence → human_review_required = true",
    rCompleted.human_review_required === true);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n── human_review_score is explainable ──");
// The score should reflect the actual risk profile, with a non-empty list
// of reasons explaining the boolean.
{
  const phishing = classify({
    complaint: "Someone called me asking for my OTP, is that bKash?",
    language: "en",
    transaction_history: [],
  });
  const vague = classify({
    complaint: "App crashed",
    language: "en",
    transaction_history: [],
  });
  check("phishing human_review_score ≥ 0.6",
    phishing.human_review_score >= 0.6, `got=${phishing.human_review_score}`);
  check("phishing human_review_required = true",
    phishing.human_review_required === true);
  check("phishing reasons include 'phishing_safety'",
    phishing.human_review_reasons.includes("phishing_safety"));
  check("vague human_review_score < 0.5",
    vague.human_review_score < 0.5, `got=${vague.human_review_score}`);
  check("vague human_review_required = false",
    vague.human_review_required === false);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n── amount_mismatch is reflected in confidence ──");
// Customer claims 50k but record shows 5k → mismatch should lower confidence.
{
  const match = classify({
    complaint: "I sent 5000 taka to the wrong number.",
    language: "en",
    transaction_history: [TXN("TXN-M", { amount: 5000 })],
  });
  const mismatch = classify({
    complaint: "I sent 50000 taka to the wrong number.",
    language: "en",
    transaction_history: [TXN("TXN-MM", { amount: 5000 })],
  });
  check("matched amount → amount_alignment = 1",
    match.signal_breakdown.amount_alignment === 1);
  check("mismatched amount → amount_alignment = 0",
    mismatch.signal_breakdown.amount_alignment === 0);
  check("mismatch flagged in reason_codes",
    mismatch.reason_codes.includes("amount_mismatch"));
  check("mismatch → higher human_review_score than match",
    mismatch.human_review_score > match.human_review_score,
    `mm=${mismatch.human_review_score} match=${match.human_review_score}`);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n── signal_breakdown fields are valid 0..1 ──");
{
  const r = classify({
    complaint: "I sent 5000 taka to the wrong number.",
    language: "en",
    transaction_history: [TXN("TXN-S", { amount: 5000 })],
  });
  const keys = [
    "keyword_strength", "keyword_gap", "transaction_match", "evidence_certainty",
    "amount_alignment", "language_signal", "ambiguity_penalty", "fraud_or_safety_signal",
  ];
  for (const k of keys) {
    const v = r.signal_breakdown[k];
    check(`signal_breakdown.${k} is number 0..1`,
      typeof v === "number" && v >= 0 && v <= 1, `got=${v}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n── confidence varies across case_types ──");
// Build 7 different complaint types and verify they don't all collapse to
// the same number (the regression we set out to fix).
{
  const cases = [
    ["wrong_transfer", "I sent 5000 taka to the wrong number."],
    ["payment_failed", "payment failed but balance deducted 1000 taka"],
    ["refund_request", "please refund my 3000 taka"],
    ["duplicate_payment", "I was charged twice for 500 taka"],
    ["merchant_settlement", "My settlement of 15000 taka has not arrived"],
    ["agent_cash_in", "I deposited through agent but balance didn't increase"],
    ["phishing", "Someone called asking for my OTP"],
  ];
  const scores = new Set();
  for (const [name, complaint] of cases) {
    const r = classify({
      complaint,
      language: "en",
      user_type: (name === "merchant_settlement" || name === "agent_cash_in") ? "merchant" : "customer",
      transaction_history: name === "phishing" ? [] : [
        TXN(`TXN-${name}`, {
          type: name === "merchant_settlement" ? "settlement"
              : name === "agent_cash_in" ? "cash_in"
              : name === "payment_failed" ? "payment"
              : name === "duplicate_payment" ? "payment"
              : "transfer",
          amount: name === "phishing" ? 0 : 5000,
          status: name === "payment_failed" ? "failed"
                : name === "merchant_settlement" ? "pending"
                : "completed",
        }),
      ],
    });
    scores.add(r.confidence);
    console.log(`    ${name.padEnd(20)} case_type=${r.case_type.padEnd(32)} conf=${r.confidence}`);
  }
  check("at least 4 distinct confidence values across case_types",
    scores.size >= 4, `got ${scores.size} distinct values`);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n── matches the official SUST sample pack (within ±0.15) ──");
{
  const raw = await readFile(new URL("./SUST_Preli_Sample_Cases.json", import.meta.url), "utf8");
  const pack = JSON.parse(raw);
  for (const c of pack.cases) {
    const r = classify(c.input);
    const exp = c.expected_output;
    if (typeof exp.confidence === "number") {
      check(`${c.id} confidence ≈ ${exp.confidence}`,
        Math.abs(r.confidence - exp.confidence) <= 0.15,
        `got=${r.confidence}`);
    }
    check(`${c.id} human_review_required matches`,
      r.human_review_required === exp.human_review_required,
      `got=${r.human_review_required}`);
  }
}

console.log(`\n${fail === 0 ? "✔" : "✘"} ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
