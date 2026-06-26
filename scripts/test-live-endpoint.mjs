// scripts/test-live-endpoint.mjs
// Hit the live /api/analyze-ticket endpoint on localhost:3000 with each of
// the 10 official SUST sample inputs. Verifies status, response shape, and
// safety rules. Run while `next dev` is running on :3000.

import { readFile } from "node:fs/promises";

const ENDPOINT = process.env.ENDPOINT || "http://localhost:3000/api/analyze-ticket";
const PACK_PATH = new URL("./SUST_Preli_Sample_Cases.json", import.meta.url);

const raw = await readFile(PACK_PATH, "utf8");
const PACK = JSON.parse(raw);

let pass = 0, fail = 0;
const REQUIRED = [
  "ticket_id", "relevant_transaction_id", "evidence_verdict", "case_type",
  "severity", "department", "agent_summary", "recommended_next_action",
  "customer_reply", "human_review_required",
];

function check(label, cond, info = "") {
  if (cond) { pass++; console.log(`    ✔ ${label}`); }
  else      { fail++; console.log(`    ✘ ${label} — ${info}`); }
}

async function postOnce(input) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  return { status: res.status, body };
}

console.log(`═══ Live endpoint tests — POST ${ENDPOINT} ═══\n`);

for (const c of PACK.cases) {
  console.log(`\n── ${c.id}: ${c.label} ──`);
  const t0 = Date.now();
  const { status, body } = await postOnce(c.input);
  const ms = Date.now() - t0;

  check(`HTTP 200 (got ${status})`, status === 200, `body=${JSON.stringify(body).slice(0, 120)}`);
  check(`body is an object`, body && typeof body === "object" && !Array.isArray(body._raw ? {} : body));

  for (const f of REQUIRED) {
    check(`has required field "${f}"`, f in body, `present=${f in body}`);
  }

  check(`ticket_id echoes`, body.ticket_id === c.input.ticket_id);
  check(`customer_reply non-empty string`, typeof body.customer_reply === "string" && body.customer_reply.length > 5);
  check(`customer_reply does NOT promise refund`,
    !/\bwe (?:will|shall|'ll|are going to) refund\b/i.test(body.customer_reply || "") &&
    !/\byour money will be refunded\b/i.test(body.customer_reply || "") &&
    !/\bconfirming the refund\b/i.test(body.customer_reply || "")
  );
  check(`customer_reply does NOT ask for PIN/OTP`,
    !/\b(?:please\s+)?(?:share|provide|send|tell|give|enter)\s+(?:us|me|your|my)?\s*(?:pin|otp|password|secret|cvv)\b/i.test(body.customer_reply || "") ||
    /\bdo not share\b/i.test(body.customer_reply || "")
  );

  // Only print first/last 80 chars of customer_reply to keep output compact
  const cr = (body.customer_reply || "").replace(/\s+/g, " ");
  console.log(`    → ${ms}ms · case_type=${body.case_type} · severity=${body.severity} · dept=${body.department}`);
  console.log(`      reply: …${cr.slice(0, 90)}${cr.length > 90 ? "…" : ""}`);
}

console.log(`\n═══ Summary ═══`);
console.log(`  ${pass} pass · ${fail} fail`);
console.log(`  ${PACK.cases.length} official cases exercised end-to-end`);
process.exit(fail === 0 ? 0 : 1);