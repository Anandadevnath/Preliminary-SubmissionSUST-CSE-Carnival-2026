// scripts/test-stability.mjs
//
// Stability + idempotency check: hit the live endpoint many times with the
// same input and verify the outputs are stable (same case_type, severity,
// verdict, department, human_review) — confidence may jitter but stays
// in-range. Also hammers 50 distinct tickets to look for any 5xx / errors.

const ENDPOINT = process.env.ENDPOINT || "http://localhost:3000/api/analyze-ticket";

const tickets = [];
for (let i = 0; i < 50; i++) {
  tickets.push({
    ticket_id: `STAB-${String(i).padStart(3, "0")}`,
    complaint: i % 3 === 0
      ? `I accidentally sent ${1000 + i * 100} taka to the wrong number.`
      : i % 3 === 1
      ? `My payment failed but my balance was deducted. Please refund ${500 + i * 50} taka.`
      : `Please help — transaction TXN-S${i} issue with merchant.`,
    language: "en",
    channel: "in_app_chat",
    user_type: "customer",
    transaction_history: [
      {
        transaction_id: `TXN-S${i}`,
        timestamp: `2026-04-14T1${i % 9}:00:00Z`,
        type: i % 2 === 0 ? "transfer" : "payment",
        amount: i % 3 === 0 ? 1000 + i * 100 : 500 + i * 50,
        status: "completed",
        counterparty: "+8801712345678",
      },
    ],
  });
}

async function post(input) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return { status: res.status, body: await res.json() };
}

// Idempotency probe: post the same input 5 times.
const probe = tickets[0];
const probeRuns = [];
for (let i = 0; i < 5; i++) probeRuns.push(await post(probe));

const firstRun = probeRuns[0].body;
let pass = 0, fail = 0;
const failures = [];
function check(label, cond, info = "") {
  if (cond) pass++; else { fail++; failures.push(`✘ ${label}${info ? ` — ${info}` : ""}`); }
}

console.log(`═══ Stability + idempotency — POST ${ENDPOINT} ═══\n`);
console.log(`── Idempotency: posting same input 5 times ──`);
for (const r of probeRuns) {
  check(`HTTP 200`, r.status === 200, `got=${r.status}`);
  check(`case_type stable`, r.body.case_type === firstRun.case_type, `got=${r.body.case_type}`);
  check(`severity stable`, r.body.severity === firstRun.severity, `got=${r.body.severity}`);
  check(`verdict stable`, r.body.evidence_verdict === firstRun.evidence_verdict, `got=${r.body.evidence_verdict}`);
  check(`dept stable`, r.body.department === firstRun.department, `got=${r.body.department}`);
  check(`human_review stable`, r.body.human_review_required === firstRun.human_review_required,
    `got=${r.body.human_review_required}`);
  check(`confidence in [0.3, 0.97]`,
    typeof r.body.confidence === "number" && r.body.confidence >= 0.3 && r.body.confidence <= 0.97,
    `got=${r.body.confidence}`);
  check(`confidence stable (±0.05 of first)`, Math.abs(r.body.confidence - firstRun.confidence) <= 0.05,
    `first=${firstRun.confidence} got=${r.body.confidence}`);
}

console.log(`\n── 50 distinct tickets in sequence ──`);
const fifty = [];
for (let i = 0; i < tickets.length; i++) {
  const r = await post(tickets[i]);
  fifty.push(r);
  check(`STAB-${String(i).padStart(3, "0")}: HTTP 200`, r.status === 200, `got=${r.status}`);
  check(`STAB-${String(i).padStart(3, "0")}: case_type recognized`,
    typeof r.body.case_type === "string" && r.body.case_type.length > 0);
  check(`STAB-${String(i).padStart(3, "0")}: severity in {low,medium,high,critical}`,
    ["low", "medium", "high", "critical"].includes(r.body.severity),
    `got=${r.body.severity}`);
  check(`STAB-${String(i).padStart(3, "0")}: confidence in [0.3, 0.97]`,
    typeof r.body.confidence === "number" && r.body.confidence >= 0.3 && r.body.confidence <= 0.97,
    `got=${r.body.confidence}`);
}

const confs = fifty.map(r => r.body.confidence).filter(x => typeof x === "number");
const sevCounts = {};
for (const r of fifty) {
  sevCounts[r.body.severity] = (sevCounts[r.body.severity] || 0) + 1;
}
const ctCounts = {};
for (const r of fifty) {
  ctCounts[r.body.case_type] = (ctCounts[r.body.case_type] || 0) + 1;
}
console.log(`\n── Distribution across 50 tickets ──`);
console.log(`  severity: ${Object.entries(sevCounts).map(([k,v]) => `${k}=${v}`).join(" · ")}`);
console.log(`  case_type: ${Object.entries(ctCounts).map(([k,v]) => `${k}=${v}`).join(" · ")}`);
console.log(`  confidence: min=${Math.min(...confs).toFixed(2)} max=${Math.max(...confs).toFixed(2)} avg=${(confs.reduce((a,b)=>a+b,0)/confs.length).toFixed(2)}`);
console.log(`  human_review=true: ${fifty.filter(r => r.body.human_review_required).length}/${fifty.length}`);

check("50-ticket run produces at least 2 distinct case_types", Object.keys(ctCounts).length >= 2,
  `distinct=${Object.keys(ctCounts).join(",")}`);
check("50-ticket run produces at least 2 distinct severities", Object.keys(sevCounts).length >= 2,
  `distinct=${Object.keys(sevCounts).join(",")}`);
check("no ticket produced 5xx",
  fifty.every(r => r.status >= 200 && r.status < 300),
  `${fifty.filter(r => r.status >= 500).length}/50 hit 5xx`);

console.log(`\n═══ Summary ═══`);
console.log(`  ${pass} pass · ${fail} fail`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ${f}`);
}
process.exit(fail === 0 ? 0 : 1);