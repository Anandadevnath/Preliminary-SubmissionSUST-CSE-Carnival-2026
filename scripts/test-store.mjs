// scripts/test-store.mjs
// Live MongoDB test of lib/store.js. Writes a real doc, reads it back,
// counts by case_type, then cleans up.
import { config } from "dotenv";
import dns from "node:dns";
config({ path: ".env.local" });

// Replicate dns-fix
async function resolveMongoUri(uri) {
  if (!uri || !uri.startsWith("mongodb+srv://")) return uri;
  const m = uri.match(/^mongodb\+srv:\/\/([^:]+):([^@]+)@([^/]+)\/([^?]+)/);
  if (!m) return uri;
  const [, user, pass, host, db] = m;
  const r = new dns.Resolver();
  r.setServers(["1.1.1.1", "8.8.8.8"]);
  const records = await new Promise((res, rej) =>
    r.resolveSrv(`_mongodb._tcp.${host}`, (e, a) => (e ? rej(e) : res(a)))
  );
  const hosts = records.sort((a, b) => a.name.localeCompare(b.name))
    .map((x) => x.name + ":" + x.port).join(",");
  return `mongodb://${user}:${pass}@${hosts}/${db}?ssl=true&authSource=admin`;
}

// Set the env BEFORE importing store.js
process.env.MONGODB_URI = await resolveMongoUri(process.env.MONGODB_URI);

const { saveAnalysis, findAnalyses, caseTypeCounts } = await import("../lib/store.js");
const { getMongoClient } = await import("../lib/mongo-client.js");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ✔", name, detail); }
  else { fail++; console.log("  ✘", name, detail); }
}

const ticket = `STORE-TEST-${Date.now()}`;
const request = {
  ticket_id: ticket,
  complaint: "I sent 5000 taka to wrong number",
  language: "en",
  channel: "in_app_chat",
  user_type: "customer",
  transaction_history: [{ transaction_id: "TXN-S1", timestamp: "2026-04-14T14:08:22Z", type: "transfer", amount: 5000, status: "completed" }],
};
const response = {
  ticket_id: ticket,
  relevant_transaction_id: "TXN-S1",
  evidence_verdict: "consistent",
  case_type: "wrong_transfer",
  severity: "high",
  department: "dispute_resolution",
  agent_summary: "Customer reports sending 5000 BDT to wrong recipient via TXN-S1.",
  recommended_next_action: "Verify TXN-S1 with the customer.",
  customer_reply: "We have noted your concern about TXN-S1.",
  human_review_required: true,
  confidence: 0.9,
  reason_codes: ["wrong_transfer", "transaction_match"],
};

console.log("\n── store: save + read roundtrip ──");
const save = await saveAnalysis({ ticket_id: ticket, request, response, latency_ms: 42 });
check("saveAnalysis returns ok", save.ok === true, save.error || "");
check("saveAnalysis returns id", typeof save.id === "string" && save.id.length > 0, save.id);

const found = await findAnalyses(ticket, { limit: 1 });
check("findAnalyses returns array", Array.isArray(found));
check("findAnalyses finds our ticket", found.length === 1 && found[0].ticket_id === ticket);
check("roundtrip response.case_type preserved", found[0]?.response?.case_type === "wrong_transfer");
check("roundtrip latency_ms preserved", found[0]?.latency_ms === 42);
check("roundtrip ts is Date", found[0]?.ts instanceof Date);

// Cleanup
const client = await getMongoClient();
const col = client.db().collection("triage_results");
await col.deleteMany({ ticket_id: ticket });
console.log("  (cleanup: deleted test doc)");

const counts = await caseTypeCounts(24 * 3600 * 1000);
check("caseTypeCounts returns array", Array.isArray(counts));

console.log(`\n${fail === 0 ? "✔" : "✘"} ${pass} pass · ${fail} fail`);
await client.close();
process.exit(fail === 0 ? 0 : 1);