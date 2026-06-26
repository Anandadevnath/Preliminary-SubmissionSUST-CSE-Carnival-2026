// scripts/audit-response-quality.mjs
// Round 5 — Response Quality (10 pts).
// Checks: (a) customer_reply tone (professional, helpful, not overpromising),
// (b) agent_summary specificity (mentions amount/txn when known),
// (c) recommended_next_action is operational, (d) safe phrases present,
// (e) length in expected ranges, (f) Bangla quality.

import { config } from "dotenv";
config({ path: ".env.local" });

const { analyzeTicket } = await import("../lib/analyze.js");

let pass = 0, fail = 0;
function check(label, cond, got, expected) {
  if (cond) { pass++; console.log(`  ✔ ${label}`); }
  else { fail++; console.log(`  ✘ ${label} — got=${JSON.stringify(got).slice(0, 100)} expected=${JSON.stringify(expected)}`); }
}

const samples = [
  {
    label: "wrong_transfer",
    input: {
      ticket_id: "RQ-1",
      complaint: "I sent 5000 to the wrong number by mistake",
      language: "en",
      transaction_history: [{ transaction_id: "TXN-A1", timestamp: "2026-04-14T14:08:22Z", type: "transfer", amount: 5000, status: "completed", counterparty: "+8801712345678" }],
    },
    expect: {
      mentionsAmount: true,
      mentionsTxnId: true,
      safePhrase: true,
      minReplyLen: 50,
      maxReplyLen: 800,
    },
  },
  {
    label: "payment_failed",
    input: {
      ticket_id: "RQ-2",
      complaint: "Payment failed but my balance was deducted 1000 taka",
      language: "en",
      transaction_history: [{ transaction_id: "TXN-B2", timestamp: "2026-04-14T14:08:22Z", type: "payment", amount: 1000, status: "failed" }],
    },
    expect: { mentionsAmount: true, mentionsTxnId: true, safePhrase: true, minReplyLen: 50, maxReplyLen: 800 },
  },
  {
    label: "phishing",
    input: {
      ticket_id: "RQ-3",
      complaint: "Someone called and asked for my OTP. Is this bkash?",
      language: "en",
      transaction_history: [],
    },
    expect: { mentionsAmount: false, mentionsTxnId: false, safePhrase: true, minReplyLen: 80, maxReplyLen: 800 },
  },
  {
    label: "refund_request",
    input: {
      ticket_id: "RQ-4",
      complaint: "Please refund my payment, my merchant didn't deliver the goods",
      language: "en",
      transaction_history: [{ transaction_id: "TXN-D4", timestamp: "2026-04-14T14:08:22Z", type: "payment", amount: 2500, status: "completed" }],
    },
    expect: { mentionsAmount: false, mentionsTxnId: true, safePhrase: true, minReplyLen: 50, maxReplyLen: 800, noRefundPromise: true },
  },
  {
    label: "duplicate_payment",
    input: {
      ticket_id: "RQ-5",
      complaint: "I was charged twice for the same payment 1500 taka",
      language: "en",
      transaction_history: [
        { transaction_id: "TXN-E1", timestamp: "2026-04-14T08:15:30Z", type: "payment", amount: 1500, status: "completed" },
        { transaction_id: "TXN-E2", timestamp: "2026-04-14T08:15:42Z", type: "payment", amount: 1500, status: "completed" },
      ],
    },
    expect: { mentionsTxnId: true, safePhrase: true, minReplyLen: 50, maxReplyLen: 800 },
  },
  {
    label: "merchant_settlement",
    input: {
      ticket_id: "RQ-6",
      complaint: "Settlement pending to my merchant account",
      language: "en",
      user_type: "merchant",
      transaction_history: [{ transaction_id: "TXN-F1", timestamp: "2026-04-14T14:08:22Z", type: "settlement", amount: 8000, status: "pending" }],
    },
    expect: { mentionsTxnId: true, safePhrase: true, minReplyLen: 50, maxReplyLen: 800 },
  },
  {
    label: "agent_cash_in",
    input: {
      ticket_id: "RQ-7",
      complaint: "Agent didn't credit my cash-in deposit 2000 taka",
      language: "en",
      transaction_history: [{ transaction_id: "TXN-G1", timestamp: "2026-04-14T14:08:22Z", type: "cash_in", amount: 2000, status: "pending", counterparty: "AGENT-100" }],
    },
    expect: { mentionsAmount: true, mentionsTxnId: true, safePhrase: true, minReplyLen: 50, maxReplyLen: 800 },
  },
  {
    label: "vague",
    input: {
      ticket_id: "RQ-8",
      complaint: "Something is wrong with my money. Please check.",
      language: "en",
      transaction_history: [],
    },
    expect: { safePhrase: true, minReplyLen: 50, maxReplyLen: 800 },
  },
  {
    label: "bn_phishing",
    input: {
      ticket_id: "RQ-9",
      complaint: "কেউ ফোন করে আমার কাছে ওটিপি চেয়েছে। এটা কি বিকাশ?",
      language: "bn",
      transaction_history: [],
    },
    expect: { safePhrase: true, minReplyLen: 50, maxReplyLen: 800, hasBangla: true },
  },
  {
    label: "bn_wrong_transfer",
    input: {
      ticket_id: "RQ-10",
      complaint: "আমি ভুল নম্বরে ৫০০০ টাকা পাঠিয়ে দিয়েছি। ফেরত দিন।",
      language: "bn",
      transaction_history: [{ transaction_id: "TXN-J1", timestamp: "2026-04-14T14:08:22Z", type: "transfer", amount: 5000, status: "completed", counterparty: "+8801712345678" }],
    },
    expect: { safePhrase: true, minReplyLen: 50, maxReplyLen: 800, hasBangla: true, mentionsAmount: true },
  },
];

console.log("═══ Round 5: Response Quality ═══\n");

for (const s of samples) {
  console.log(`── ${s.label} ──`);
  const r = await analyzeTicket(s.input);
  if (r.status !== 200) {
    fail++;
    console.log(`  ✘ HTTP ${r.status} for ${s.label}`);
    continue;
  }
  const j = r.body;
  const cr = j.customer_reply || "";
  const ag = j.agent_summary || "";
  const na = j.recommended_next_action || "";

  // Length
  check(`reply length in [${s.expect.minReplyLen}, ${s.expect.maxReplyLen}]`,
    cr.length >= s.expect.minReplyLen && cr.length <= s.expect.maxReplyLen,
    cr.length);

  // Safety phrase present (English or Bangla). NB: \b doesn't work for
// Bengali in V8 because Bengali script doesn't have word-boundary
// semantics; use lookarounds based on whitespace instead.
  if (s.expect.safePhrase) {
    check("contains safety reminder",
      /(?:^|[\s,.;])(?:PIN|OTP|password|পিন|ওটিপি|পাসওয়ার্ড)(?:[\s,.;]|$)/i.test(cr),
      cr.slice(0, 60));
  }

  // Amount mentioned
  if (s.expect.mentionsAmount) {
    check("mentions amount",
      /\d/.test(cr) || /\d/.test(ag),
      cr.match(/\d[\d,]*/g));
  }

  // Transaction ID mentioned (any of the supplied ones — duplicate payment
  // legitimately picks the second one as the suspected duplicate).
  if (s.expect.mentionsTxnId) {
    const txIds = (s.input.transaction_history || []).map((t) => t.transaction_id);
    const any = txIds.some((id) => cr.includes(id) || ag.includes(id) || na.includes(id));
    check(`mentions at least one txn id from [${txIds.join(", ")}]`,
      any,
      `cr has ${txIds.filter((id) => cr.includes(id))}, ag has ${txIds.filter((id) => ag.includes(id))}`);
  }

  // Bangla
  if (s.expect.hasBangla) {
    check("contains Bangla script",
      /[\u0980-\u09FF]/.test(cr) || /[\u0980-\u09FF]/.test(ag),
      "no Bangla found");
  }

  // No refund promise for refund case
  if (s.expect.noRefundPromise) {
    check("does NOT promise refund",
      !/\b(?:we (?:will|shall|'ll|are going to) refund\b|your money will be refunded|confirming the refund)\b/i.test(cr),
      cr.match(/\b(?:refund)\b/i)?.[0]);
  }

  // agent_summary is specific (mentions case details)
  check("agent_summary >= 30 chars", ag.length >= 30, ag.length);
  check("recommended_next_action >= 20 chars", na.length >= 20, na.length);
  check("agent_summary is one paragraph (no newlines)", !/\n/.test(ag), ag.slice(0, 30));

  // No emoji (professional tone)
  check("no emoji in customer_reply", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(cr), "emoji check");

  // Recommended action has a verb (English or Bangla — Bangla uses করুন/করতে etc.)
  check("recommended_next_action has action verb",
    /(?:^|[\s,.;])(?:verify|check|escalate|route|confirm|review|investigate|contact|update|notify|reconcile|verify|যাচাই|এসকেলেট|পর্যালোচনা|আপডেট|যোগাযোগ|রুট|নোটিফাই)(?:[\s,.;]|$)/i.test(na),
    na.slice(0, 60));

  console.log();
}

console.log("═══ Round 5 Results ═══");
console.log(`  ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
