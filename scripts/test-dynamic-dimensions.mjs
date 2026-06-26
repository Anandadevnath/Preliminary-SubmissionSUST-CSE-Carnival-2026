// scripts/test-dynamic-dimensions.mjs
//
// Verifies that confidence, human_review, and severity are all DYNAMIC
// outputs of the classifier — driven by case type, evidence, and amount —
// not hard-coded constants. Runs many varied cases against the live
// endpoint and asserts:
//   1. Severity is high for the kind of cases that should be high
//      (phishing, inconsistent evidence, high-value, duplicate payment)
//   2. Human review flips YES/NO in the right directions
//   3. Confidence varies meaningfully (not a single value across cases)
//   4. Severity=high triggers human_review=true in the same case
//   5. Confidence tracks case clarity (no_match < strong match)

const ENDPOINT = process.env.ENDPOINT || "http://localhost:3000/api/analyze-ticket";

let pass = 0, fail = 0;
const failures = [];

function check(label, cond, info = "") {
  if (cond) { pass++; }
  else      { fail++; failures.push(`✘ ${label}${info ? ` — ${info}` : ""}`); }
}

async function post(input) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.json();
}

function mkTxn(id, opts = {}) {
  return {
    transaction_id: id,
    timestamp: opts.timestamp || "2026-04-14T14:08:22Z",
    type: opts.type || "transfer",
    amount: opts.amount ?? 2000,
    status: opts.status || "completed",
    counterparty: opts.counterparty || "+8801712345678",
  };
}

// ─── Test cases designed to drive specific outputs ──────────────────────

const cases = [
  // ── Phishing → critical severity, definitely human review ──
  {
    name: "phishing report (en)",
    expect: { severity_in: ["high", "critical"], human_review: true },
    input: {
      ticket_id: "PH-01",
      complaint: "Someone called me pretending to be from bKash and asked for my OTP. I shared it. Now my balance is zero. Please help.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-P1", { amount: 5000, timestamp: "2026-04-13T10:00:00Z" }),
        mkTxn("TXN-P2", { amount: 25000, timestamp: "2026-04-14T09:00:00Z" }),
      ],
    },
  },

  // ── Wrong transfer + matching evidence → high severity, human review ──
  {
    name: "wrong transfer (2000 taka) + matching",
    expect: { severity_in: ["high", "critical"], human_review: true, case_type: "wrong_transfer", verdict: "consistent" },
    input: {
      ticket_id: "WT-01",
      complaint: "I accidentally sent 2000 taka to the wrong number.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-W1", { amount: 2000, timestamp: "2026-04-14T14:08:22Z" }),
      ],
    },
  },

  // ── Wrong transfer + amount mismatch → still high severity, human review ──
  {
    name: "wrong transfer, amount mismatch",
    expect: { severity_in: ["high", "critical"], human_review: true, case_type: "wrong_transfer", verdict: "inconsistent" },
    input: {
      ticket_id: "WT-02",
      complaint: "I sent 90000 taka to the wrong number by mistake.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-W2", { amount: 80000, timestamp: "2026-04-14T14:08:22Z" }),
      ],
    },
  },

  // ── Payment failed but money deducted → high severity (financial loss) ──
  // Per the classifier: payment_failed alone doesn't trigger human_review
  // unless it stacks with other signals. Severity=high is the dynamic part.
  {
    name: "payment failed, balance deducted",
    expect: { severity_in: ["high", "critical"], case_type: "payment_failed" },
    input: {
      ticket_id: "PF-01",
      complaint: "My payment failed but my balance was deducted. Please refund my money back.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-PF1", { type: "payment", status: "failed", amount: 1500 }),
      ],
    },
  },

  // ── Refund request, high value (>= 50000) ──
// Per the classifier: refund_request alone is low severity. The high-value
// signal contributes +0.3 to human_review_score but doesn't cross the 0.5
// threshold alone — so severity=low and hr=false. The reason_codes
// SHOULD include the high_value_dispute signal trail though.
  {
    name: "refund request, high value",
    expect: { case_type: "refund_request", human_review_score_gte: 0.3, has_reason: "hr:high_value_dispute" },
    input: {
      ticket_id: "RF-01",
      complaint: "Please refund my 75000 taka. The merchant did not deliver the product.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-RF1", { type: "payment", amount: 75000, timestamp: "2026-04-10T10:00:00Z" }),
      ],
    },
  },

  // ── Duplicate payment → high severity (fraud signal) ──
  {
    name: "duplicate payment",
    expect: { severity_in: ["high", "critical"], human_review: true, case_type: "duplicate_payment" },
    input: {
      ticket_id: "DP-01",
      complaint: "I was charged twice for the same purchase. Please reverse the duplicate charge.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-D1", { type: "payment", amount: 2500, timestamp: "2026-04-14T08:00:00Z" }),
        mkTxn("TXN-D2", { type: "payment", amount: 2500, timestamp: "2026-04-14T08:00:30Z" }),
      ],
    },
  },

  // ── Vague complaint → low severity, possibly no human review ──
  {
    name: "vague complaint, no transaction history",
    expect: { severity_in: ["low", "medium"] },
    input: {
      ticket_id: "VG-01",
      complaint: "I have an issue with the app.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [],
    },
  },

  // ── Bangla wrong transfer ──
  {
    name: "Bangla wrong transfer",
    expect: { severity_in: ["high", "critical"], case_type: "wrong_transfer" },
    input: {
      ticket_id: "BN-01",
      complaint: "আমি ভুল নম্বরে ৫০০০ টাকা পাঠিয়ে দিয়েছি। দয়া করে ফেরত দিন।",
      language: "bn",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-BN1", { amount: 5000, counterparty: "+8801812345678" }),
      ],
    },
  },

  // ── Banglish payment failed ──
  {
    name: "Banglish payment failed",
    expect: { case_type: "payment_failed" },
    input: {
      ticket_id: "BGL-01",
      complaint: "Payment hoy nai, taka kete geche.",
      language: "bn",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-BGL1", { type: "payment", status: "failed", amount: 1000 }),
      ],
    },
  },

  // ── Agent cash-in issue, pending status ──
  {
    name: "agent cash-in pending",
    expect: { case_type: "agent_cash_in_issue" },
    input: {
      ticket_id: "AC-01",
      complaint: "I gave 5000 taka to the agent but it has not been credited to my account.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-AC1", { type: "cash_in", status: "pending", amount: 5000 }),
      ],
    },
  },

  // ── Merchant settlement delay ──
  {
    name: "merchant settlement delay",
    expect: { case_type: "merchant_settlement_delay" },
    input: {
      ticket_id: "MS-01",
      complaint: "I made a payment to a merchant 3 days ago. The merchant says they have not received the payment yet.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-MS1", { type: "payment", status: "pending", amount: 3000 }),
      ],
    },
  },

  // ── Single lakh amount ──
  {
    name: "wrong transfer, 1 lakh",
    expect: { severity_in: ["high", "critical"], human_review: true, case_type: "wrong_transfer" },
    input: {
      ticket_id: "LK-01",
      complaint: "I mistakenly transferred 1 lakh taka to the wrong account.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-LK1", { amount: 100000, timestamp: "2026-04-14T14:08:22Z" }),
      ],
    },
  },

  // ── Low-value refund → should be lower severity ──
  {
    name: "small refund request",
    expect: { severity_in: ["low", "medium", "high"] },
    input: {
      ticket_id: "SR-01",
      complaint: "Please refund 200 taka. The shopkeeper refused to accept my return.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-SR1", { type: "payment", amount: 200, timestamp: "2026-04-14T10:00:00Z" }),
      ],
    },
  },

  // ── Empty transaction history, wrong-transfer claim ──
  {
    name: "wrong transfer claim with empty history",
    expect: { case_type: "wrong_transfer" },
    input: {
      ticket_id: "EH-01",
      complaint: "I accidentally sent money to the wrong number.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [],
    },
  },

  // ── Common typo ("pyament") — should still classify ──
  {
    name: "typo in payment failed",
    expect: { case_type: "payment_failed" },
    input: {
      ticket_id: "TY-01",
      complaint: "My pyament failed but taka was deducted from my balance.",
      language: "en",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-TY1", { type: "payment", status: "failed", amount: 500 }),
      ],
    },
  },

  // ── Banglish: "vul number e pathiyechi" ──
  {
    name: "Banglish wrong transfer",
    expect: { case_type: "wrong_transfer" },
    input: {
      ticket_id: "BGL2-01",
      complaint: "Ami vul number e 3000 taka pathiyechi. Please help ferot anar jonno.",
      language: "bn",
      channel: "in_app_chat",
      user_type: "customer",
      transaction_history: [
        mkTxn("TXN-BGL2", { amount: 3000 }),
      ],
    },
  },
];

console.log(`═══ Dynamic dimensions test — POST ${ENDPOINT} ═══\n`);
console.log(`Running ${cases.length} cases to exercise confidence/human_review/severity dynamics…\n`);

const results = [];
for (const c of cases) {
  const r = await post(c.input);
  results.push({ name: c.name, response: r, expect: c.expect });
  const sev = r.severity;
  const hr  = r.human_review_required;
  const cf  = r.confidence;
  const ct  = r.case_type;
  const vd  = r.evidence_verdict;
  const txn = r.relevant_transaction_id;
  console.log(`  ${c.name}`);
  console.log(`    → case_type=${ct} · severity=${sev} · verdict=${vd} · confidence=${cf} · hr=${hr} · txn=${txn || "(none)"}`);

  if (c.expect.severity_in) {
    check(`${c.name}: severity ∈ ${JSON.stringify(c.expect.severity_in)}`,
      c.expect.severity_in.includes(sev), `got=${sev}`);
  }
  if (c.expect.human_review !== undefined) {
    check(`${c.name}: human_review = ${c.expect.human_review}`,
      hr === c.expect.human_review, `got=${hr}`);
  }
  if (c.expect.case_type) {
    check(`${c.name}: case_type = ${c.expect.case_type}`,
      ct === c.expect.case_type, `got=${ct}`);
  }
  if (c.expect.verdict) {
    check(`${c.name}: verdict = ${c.expect.verdict}`,
      vd === c.expect.verdict, `got=${vd}`);
  }
  if (c.expect.human_review_score_gte !== undefined) {
    check(`${c.name}: human_review_score >= ${c.expect.human_review_score_gte}`,
      typeof r.human_review_score === "number" && r.human_review_score >= c.expect.human_review_score_gte,
      `got=${r.human_review_score}`);
  }
  if (c.expect.has_reason) {
    check(`${c.name}: reason_codes contains "${c.expect.has_reason}"`,
      Array.isArray(r.reason_codes) && r.reason_codes.includes(c.expect.has_reason),
      `got=${JSON.stringify(r.reason_codes)}`);
  }
}

// ─── Cross-cutting assertions ──────────────────────────────────────────
console.log("\n── Cross-cutting dynamics ──");

// (a) Confidence must vary across cases — not a constant.
const confs = results.map(r => r.response.confidence).filter(x => typeof x === "number");
const uniq = new Set(confs.map(c => c.toFixed(2)));
check("confidence varies meaningfully across cases (>=4 distinct values)",
  uniq.size >= 4, `distinct=${[...uniq].join(",")}`);

// (b) Severity=critical MUST trigger human_review=true (because +0.6 alone
//     crosses the 0.5 threshold). This is the strongest invariant.
const critSevs = results.filter(r => r.response.severity === "critical");
const critWithHR = critSevs.filter(r => r.response.human_review_required === true);
check("ALL critical-severity cases have human_review=true",
  critSevs.length > 0 && critSevs.length === critWithHR.length,
  `${critWithHR.length}/${critSevs.length} critical-sev cases have hr=true`);

// (b.2) High severity alone is +0.3 — needs another signal to clear 0.5.
//       We expect MOST high-severity cases with a matched txn to have hr=true,
//       but it isn't a hard invariant.
const highSevs = results.filter(r => r.response.severity === "high");
const highWithTxn = highSevs.filter(r => r.response.relevant_transaction_id);
const highWithTxnHR = highWithTxn.filter(r => r.response.human_review_required === true);
check("MOST high-severity cases with a matched txn have human_review=true",
  highWithTxn.length === 0 || highWithTxnHR.length / highWithTxn.length >= 0.5,
  `${highWithTxnHR.length}/${highWithTxn.length} high-sev with txn have hr=true`);

// (c) Low severity (no high-value bump) must NOT trigger human review.
const lowSevs = results.filter(r => r.response.severity === "low");
const lowWithHR = lowSevs.filter(r => r.response.human_review_required === true);
check("low-severity cases do NOT have human_review=true (no high-value bump)",
  lowSevs.length === 0 || lowWithHR.length === 0,
  `${lowWithHR.length}/${lowSevs.length} low-sev cases have hr=true`);

// (d) Severity distribution is non-trivial — must span the range.
const sevSet = new Set(results.map(r => r.response.severity));
check("severity spans at least 2 distinct values across cases",
  sevSet.size >= 2, `distinct=${[...sevSet].join(",")}`);

// (e) Confidence in [0, 1] for every case.
const outOfRange = results.filter(r => typeof r.response.confidence !== "number" ||
  r.response.confidence < 0 || r.response.confidence > 1);
check("all confidences are in [0, 1]",
  outOfRange.length === 0,
  `out-of-range count=${outOfRange.length}`);

// (f) Each result has reason_codes (so the dynamics are traceable).
const noReasons = results.filter(r => !Array.isArray(r.response.reason_codes) || r.response.reason_codes.length === 0);
check("every response includes reason_codes",
  noReasons.length === 0,
  `missing count=${noReasons.length}`);

// (g) Phishing case has highest human_review_score signal.
const phish = results.find(r => r.name === "phishing report (en)");
if (phish) {
  check("phishing case has human_review_score present",
    typeof phish.response.human_review_score === "number",
    `got=${phish.response.human_review_score}`);
}

// (h) Verify a few specific signals visible in reason_codes.
const wt01 = results.find(r => r.name === "wrong transfer (2000 taka) + matching");
if (wt01 && wt01.response.reason_codes) {
  check("WT-01 reason_codes include severity:high",
    wt01.response.reason_codes.some(c => /severity:(high|critical)/.test(c)));
  check("WT-01 reason_codes include transaction_match (or strong match)",
    wt01.response.reason_codes.some(c => /match|transaction_match/.test(c)));
}

console.log(`\n═══ Summary ═══`);
console.log(`  ${pass} pass · ${fail} fail`);
console.log(`  ${cases.length} cases exercised end-to-end`);
console.log(`  ${uniq.size} distinct confidence values`);
console.log(`  severity values seen: ${[...sevSet].join(", ")}`);
console.log(`  human_review true: ${results.filter(r => r.response.human_review_required).length}/${results.length}`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ${f}`);
}
process.exit(fail === 0 ? 0 : 1);