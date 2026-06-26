// scripts/audit-performance.mjs
// Round 4 — Performance (10 pts).
// The rubric measures: (a) analyze-ticket latency, (b) throughput,
// (c) cold-start time, (d) memory footprint.
//
// Rules-based pipeline has no LLM call, so latency should be < 50ms
// end-to-end on a warm Node process. We benchmark that, plus the
// analyzer's throughput and cold start.

import { config } from "dotenv";
config({ path: ".env.local" });

const { analyzeTicket } = await import("../lib/analyze.js");

let pass = 0, fail = 0;
function check(label, cond, got, expected) {
  if (cond) { pass++; console.log(`  ✔ ${label}`); }
  else { fail++; console.log(`  ✘ ${label} — got=${JSON.stringify(got)} expected=${JSON.stringify(expected)}`); }
}

// ─────────────────────────────────────────────────────────────────────────
// Warm-path latency: single-request p50/p99
// ─────────────────────────────────────────────────────────────────────────
console.log("═══ Round 4: Warm latency (single request) ═══\n");

const samples = [
  // Empty-ish
  { ticket_id: "PERF-1", complaint: "I sent 500 to wrong number", transaction_history: [{ transaction_id: "T1", timestamp: "2026-04-14T14:08:22Z", type: "transfer", amount: 500, status: "completed" }] },
  // 20-txn history (max allowed)
  { ticket_id: "PERF-2", complaint: "duplicate payment 5000 taka", transaction_history: Array.from({ length: 20 }, (_, i) => ({ transaction_id: `TXN-${i}`, timestamp: "2026-04-14T14:08:22Z", type: "transfer", amount: 1000 + i, status: "completed", counterparty: "+8801712001122" })) },
  // Long complaint
  { ticket_id: "PERF-3", complaint: "I sent money to the wrong person. ".repeat(150), transaction_history: [] },
  // Phishing
  { ticket_id: "PERF-4", complaint: "Someone called me asking for my OTP. Is this bkash?", transaction_history: [] },
  // Bangla
  { ticket_id: "PERF-5", complaint: "আমি ভুল নম্বরে ৫০০০ টাকা পাঠিয়ে দিয়েছি। ফেরত দিন।", transaction_history: [] },
];

// Warm-up
for (let i = 0; i < 5; i++) await analyzeTicket(samples[i % samples.length]);

// Measure
const ITER = 200;
const timings = [];
for (let i = 0; i < ITER; i++) {
  const t0 = performance.now();
  await analyzeTicket(samples[i % samples.length]);
  timings.push(performance.now() - t0);
}
timings.sort((a, b) => a - b);
const p50 = timings[Math.floor(timings.length * 0.5)];
const p95 = timings[Math.floor(timings.length * 0.95)];
const p99 = timings[Math.floor(timings.length * 0.99)];
const avg = timings.reduce((s, t) => s + t, 0) / timings.length;
const max = timings[timings.length - 1];

console.log(`  iterations: ${ITER}`);
console.log(`  p50: ${p50.toFixed(2)}ms · p95: ${p95.toFixed(2)}ms · p99: ${p99.toFixed(2)}ms · avg: ${avg.toFixed(2)}ms · max: ${max.toFixed(2)}ms`);

// Rubric: < 200ms p99 for analyze-ticket is acceptable; < 100ms is good.
check("p50 < 50ms", p50 < 50, `${p50.toFixed(2)}ms`, "< 50ms");
check("p95 < 100ms", p95 < 100, `${p95.toFixed(2)}ms`, "< 100ms");
check("p99 < 200ms", p99 < 200, `${p99.toFixed(2)}ms`, "< 200ms");

// ─────────────────────────────────────────────────────────────────────────
// Throughput (req/s)
// ─────────────────────────────────────────────────────────────────────────
console.log("\n═══ Round 4: Throughput ═══\n");

const THROUGHPUT_MS = 2000; // 2s window
let throughputCount = 0;
const t0 = performance.now();
while (performance.now() - t0 < THROUGHPUT_MS) {
  await analyzeTicket(samples[throughputCount % samples.length]);
  throughputCount++;
}
const elapsed = performance.now() - t0;
const rps = (throughputCount / elapsed) * 1000;

console.log(`  ${throughputCount} requests in ${elapsed.toFixed(0)}ms = ${rps.toFixed(0)} req/s`);
check("throughput >= 100 req/s", rps >= 100, `${rps.toFixed(0)} req/s`, ">= 100 req/s");
check("throughput >= 500 req/s", rps >= 500, `${rps.toFixed(0)} req/s`, ">= 500 req/s");

// ─────────────────────────────────────────────────────────────────────────
// Cold-start time: measure first-call latency (proxy for cold start)
// A full subprocess spawn is too slow in CI; we instead measure the first
// request latency after a fresh dynamic import.
// ─────────────────────────────────────────────────────────────────────────
console.log("\n═══ Round 4: First-call latency ═══\n");

const coldImport = await import("../lib/analyze.js?cold=" + Date.now());
const ct0 = performance.now();
await coldImport.analyzeTicket({
  ticket_id: "COLD-1", complaint: "test wrong transfer", transaction_history: []
});
const coldLatency = performance.now() - ct0;
console.log(`  first-call latency (post fresh import): ${coldLatency.toFixed(2)}ms`);
check("first-call < 50ms (no LLM = fast)", coldLatency < 50, `${coldLatency.toFixed(2)}ms`, "< 50ms");

// ─────────────────────────────────────────────────────────────────────────
// Memory footprint
// ─────────────────────────────────────────────────────────────────────────
console.log("\n═══ Round 4: Memory ═══\n");

const memBefore = process.memoryUsage().rss;
// Run a large batch to let GC settle
for (let i = 0; i < 1000; i++) {
  await analyzeTicket(samples[i % samples.length]);
}
const memAfter = process.memoryUsage().rss;
const heap = process.memoryUsage().heapUsed / 1024 / 1024;
const rss = memAfter / 1024 / 1024;
console.log(`  RSS after 1000 reqs: ${rss.toFixed(1)} MB · heap: ${heap.toFixed(1)} MB`);
// MongoDB driver baseline alone is ~150-200MB; we allow up to 400MB for
// a working Mongo-connected process. Without Mongo it's ~80MB.
check("RSS < 400MB after 1000 reqs (with Mongo driver)", rss < 400, `${rss.toFixed(1)} MB`, "< 400 MB");

console.log("\n═══ Round 4 Results ═══");
console.log(`  ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
