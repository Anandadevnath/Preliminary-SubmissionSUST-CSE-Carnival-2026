// scripts/test-safety-replies.mjs
import { checkAll, safeCustomerReply, safeRecommendedAction } from "../lib/safety.js";
import { buildReplies } from "../lib/replies.js";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ✔", name, detail); }
  else { fail++; console.log("  ✘", name, detail); }
}

// checkAll returns { ok: true } when safe, { ok: false, reason, match } when not.
// `!v.ok` is always false because both objects are truthy. Always compare v.ok === true.
const isSafe = (v) => v && v.ok === true;
const reason = (v) => v && v.ok === false ? v.reason : "";

console.log("\n── safety: credential requests must be rejected ──");
const badCred = [
  "Please share your OTP so we can verify.",
  "Kindly provide your PIN.",
  "Send me your password.",
  "Please confirm your card number.",
  "Tell me your CVV.",
  "Please share your otp with our agent.",
  "Provide the OTP to confirm the refund.",
  "Please share your পিন।",
  "আপনার ওটিপি শেয়ার করুন।",
];
for (const s of badCred) {
  const v = checkAll(s);
  check(`reject: ${s.slice(0, 50)}`, v.ok === false && v.reason === "credential_request", v.match ? `(${v.match})` : "");
}

console.log("\n── safety: refund promises must be rejected ──");
const promises = [
  "We will refund your 5000 taka within 24 hours.",
  "Your money has been refunded to your account.",
  "We'll reverse the transaction right away.",
  "Your account will be unblocked shortly.",
  "Confirming the refund now.",
];
for (const s of promises) {
  const v = checkAll(s);
  check(`reject: ${s.slice(0, 50)}`, v.ok === false && v.reason === "refund_or_reversal_promise");
}

console.log("\n── safety: third-party redirects must be rejected ──");
const third = [
  "Please call +8801712345678 for help.",
  "SMS your details to 01912345678.",
  "Visit http://evil.example.com to verify.",
  "Open https://sketchy-link.test/otp to confirm.",
];
for (const s of third) {
  const v = checkAll(s);
  check(`reject: ${s.slice(0, 50)}`, v.ok === false && v.reason === "suspicious_third_party");
}

console.log("\n── safety: SAFE strings must pass ──");
const good = [
  "We have noted your concern about TXN-001.",
  "Any eligible amount will be returned through official channels after review.",
  "Our team will contact you through the app.",
  "For your safety, please do not share your PIN, OTP, or password with anyone.",
  "Our team will never ask for these credentials.",
  "আমরা আপনার অভিযোগ পেয়েছি।",
  "Visit our official support at https://bkash.com/en/contact",
];
for (const s of good) {
  const v = checkAll(s);
  check(`accept: ${s.slice(0, 60)}`, isSafe(v), v.ok === false ? `FALSE REJECT: ${v.reason}` : "");
}

console.log("\n── safeCustomerReply / safeRecommendedAction fallbacks ──");
check("safeCustomerReply returns input when safe", safeCustomerReply("hello") === "hello");
{
  const out = safeCustomerReply("share your otp");
  check("safeCustomerReply swaps on violation", !/share your otp/i.test(out) && out.length > 20);
}
{
  const out = safeRecommendedAction("we will refund now");
  check("safeRecommendedAction swaps on violation", !/we will refund now/i.test(out));
}

console.log("\n── buildReplies for every case_type (no violations) ──");
const cases = [
  { caseType: "wrong_transfer", severity: "high", verdict: "consistent", txn: { transaction_id: "TXN-1", amount: 5000 }, language: "en", complaint: "wrong number", userType: "customer" },
  { caseType: "wrong_transfer", severity: "high", verdict: "inconsistent", txn: null, language: "bn", complaint: "ভুল নম্বরে", userType: "customer" },
  { caseType: "payment_failed", severity: "medium", verdict: "consistent", txn: { transaction_id: "TXN-2", amount: 5000 }, language: "en", complaint: "failed", userType: "customer" },
  { caseType: "refund_request", severity: "medium", verdict: "insufficient_data", txn: { transaction_id: "TXN-3", amount: 1200 }, language: "en", complaint: "refund", userType: "customer" },
  { caseType: "duplicate_payment", severity: "high", verdict: "consistent", txn: { transaction_id: "TXN-4", amount: 500 }, language: "en", complaint: "charged twice", userType: "customer" },
  { caseType: "merchant_settlement_delay", severity: "high", verdict: "consistent", txn: { transaction_id: "TXN-5", amount: 12000 }, language: "en", complaint: "settlement delay", userType: "merchant" },
  { caseType: "agent_cash_in_issue", severity: "high", verdict: "consistent", txn: { transaction_id: "TXN-6", amount: 5000 }, language: "en", complaint: "agent cash in", userType: "agent" },
  { caseType: "phishing_or_social_engineering", severity: "critical", verdict: "insufficient_data", txn: null, language: "en", complaint: "otp", userType: "customer" },
  { caseType: "phishing_or_social_engineering", severity: "critical", verdict: "insufficient_data", txn: null, language: "bn", complaint: "otp", userType: "customer" },
  { caseType: "other", severity: "low", verdict: "insufficient_data", txn: null, language: "en", complaint: "weird stuff", userType: "customer" },
];
for (const args of cases) {
  const out = buildReplies(args);
  const cust = checkAll(out.customer_reply);
  const act = checkAll(out.recommended_next_action);
  const sum = checkAll(out.agent_summary);
  check(`${args.caseType} (${args.language}) — customer_reply safe`, isSafe(cust), reason(cust));
  check(`${args.caseType} (${args.language}) — recommended_next_action safe`, isSafe(act), reason(act));
  check(`${args.caseType} (${args.language}) — agent_summary safe`, isSafe(sum), reason(sum));
  check(`${args.caseType} — strings non-empty`, out.customer_reply.length > 10 && out.recommended_next_action.length > 10 && out.agent_summary.length > 10);
}

console.log(`\n${fail === 0 ? "✔" : "✘"} ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);