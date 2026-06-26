// lib/classifier.js
// Pure functions only. No I/O. No globals. Easy to test, easy to audit.
//
// Strategy:
//   1. Normalize the complaint text (lowercase, strip, collapse whitespace).
//   2. Match keyword groups per case_type for English + Bangla + Banglish.
//   3. Find the most likely transaction in `transaction_history` by score.
//   4. Compare complaint claims vs transaction reality → evidence_verdict.
//   5. Compute severity (default + bumps) and department (default + reroutes).
//   6. Compute `human_review_required` and `confidence` from signals.

import {
  CASE_TYPES,
  DEFAULT_DEPARTMENT,
  DEFAULT_SEVERITY,
} from "./taxonomy.js";

// ────────────────────────────────────────────────────────────────────────────
// Keyword groups. Each entry: case_type → { en: [...], bn: [...], weight: N }
// Higher weight = stronger signal. We add 1 per match, then divide by
// total weight of the matched group to get a 0..1 confidence per case_type.
// ────────────────────────────────────────────────────────────────────────────
const KEYWORDS = Object.freeze({
  wrong_transfer: {
    weight: 1.0,
    en: [
      "wrong number", "wrong recipient", "sent to wrong", "mistakenly sent",
      "by mistake", "wrong transfer", "wrong account", "sent it to the wrong",
      "accidentally transferred", "sent by mistake", "wrongly sent",
      "transferred to wrong", "sent 5000",
    ],
    bn: [
      "ভুল নম্বরে", "ভুল রিসিভার", "ভুল একাউন্ট", "ভুল করে পাঠিয়ে",
      "ভুল ট্রান্সফার", "ভুলে পাঠিয়ে", "ভুল ব্যক্তি",
    ],
    amount_hint: "any",
  },

  payment_failed: {
    weight: 1.0,
    en: [
      "payment failed", "transaction failed", "failed but", "balance deducted",
      "money deducted", "charged but", "failed but money", "amount deducted",
      "payment unsuccessful", "didn't go through", "did not go through",
      "failed but balance", "showed failed", "txn failed",
    ],
    bn: [
      "পেমেন্ট ব্যর্থ", "লেনদেন ব্যর্থ", "টাকা কেটে গেছে", "ডেবিট হয়েছে",
      "পেমেন্ট হয়নি", "টাকা কাটা", "ব্যর্থ হয়েছে",
    ],
    require_txn_type: ["transfer", "payment"],
  },

  refund_request: {
    weight: 0.95,
    en: [
      "refund", "money back", "return my money", "i want my money back",
      "please refund", "kindly refund", "want a refund", "reverse the",
      "reverse transaction", "give me back", "want it back",
    ],
    bn: ["ফেরত", "রিফান্ড", "টাকা ফেরত", "ফেরত দিন"],
  },

  duplicate_payment: {
    weight: 1.1, // slightly stronger — duplicate wording is rarely about refunds
    en: [
      "charged twice", "deducted twice", "double charged", "two times",
      "duplicate", "twice for the same", "paid twice", "charged two times",
      "double payment", "duplicate charge", "twice for",
    ],
    bn: ["দুইবার কাটা", "দুইবার চার্জ", "একই পেমেন্ট দুইবার"],
  },

  merchant_settlement_delay: {
    weight: 0.9,
    en: [
      "settlement", "merchant", "shop didn't receive", "store hasn't received",
      "merchant payment", "shop payment pending", "settlement delay",
      "merchant not received", "didn't get the money", "shop owner",
      "withdraw to merchant", "settlement pending",
    ],
    bn: ["মার্চেন্ট", "দোকান", "সেটেলমেন্ট", "পেমেন্ট পাইনি"],
    user_type_hint: "merchant",
  },

  agent_cash_in_issue: {
    weight: 0.9,
    en: [
      "agent", "cash in", "deposit through", "agent didn't", "agent number",
      "deposited through agent", "agent cash", "cash deposit",
      "deposit but not received", "agent said", "deposit pending",
    ],
    bn: ["এজেন্ট", "ক্যাশ ইন", "এজেন্টের মাধ্যমে", "জমা হয়নি"],
    user_type_hint: "agent",
  },

  phishing_or_social_engineering: {
    weight: 1.5, // safety-critical → boost
    en: [
      "otp", "pin", "password", "cvv", "someone called", "called me asking",
      "asked for my", "share my otp", "share my pin", "fraud call",
      "scam message", "fake link", "phishing", "suspicious call",
      "asked for otp", "asked for pin", "asked for password",
      "share otp", "share pin", "share password",
      "is that bkash", "is that nagad", "is that rocket",
      "someone is asking", "asked me to share",
    ],
    bn: [
      "ওটিপি", "পিন", "পাসওয়ার্ড", "কেউ ফোন", "কেউ জিজ্ঞেস",
      "ফাঁদ", "স্ক্যাম", "ভুয়া লিংক", "প্রতারণা",
    ],
  },
});

// Phishing-specific check — even if no complaint keywords, the *combination*
// of "OTP/PIN" + any request to share is automatic phishing.
const SHARING_PHRASES = [
  /share (?:my |your |the )?(?:otp|pin|password|cvv)/i,
  /(?:otp|pin|password|cvv).{0,30}(?:share|send|provide|tell|give)/i,
  /(?:asked|telling|told).{0,30}(?:otp|pin|password|cvv)/i,
  /(?:share|tell me|give me).{0,20}(?:otp|pin|password)/i,
];

// ────────────────────────────────────────────────────────────────────────────
// Normalize
//   - lowercase
//   - strip diacritics (NB: we keep them for Bengali so vowel signs survive;
//     we only normalize smart quotes)
//   - keep letters, marks, numbers, whitespace — strip everything else
//     (punctuation, emoji, currency symbols). Including \p{M} is critical
//     for Bengali: the vowel signs (ি ে া etc.) are Marks, not Letters,
//     and dropping them would shred the keyword strings.
// ────────────────────────────────────────────────────────────────────────────
export function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ────────────────────────────────────────────────────────────────────────────
// Score all case_types for a complaint.
// ────────────────────────────────────────────────────────────────────────────
function scoreComplaint(complaint) {
  const text = normalize(complaint);
  const scores = {};
  for (const [type, spec] of Object.entries(KEYWORDS)) {
    let s = 0;
    let hits = 0;
    for (const phrase of spec.en || []) {
      if (text.includes(phrase)) {
        s += 1;
        hits++;
      }
    }
    for (const phrase of spec.bn || []) {
      if (text.includes(phrase)) {
        s += 1;
        hits++;
      }
    }
    if (spec.user_type_hint) {
      // tiny weight — user_type alone shouldn't decide case_type
      // (caller does the real boost)
    }
    if (hits > 0) scores[type] = (s * spec.weight) / Math.max(1, hits);
  }

  // Proximity patterns — "charged X twice" / "twice for the same" / "double
  // charged" are duplicate_payment signals even when filler words intervene.
  const dupProximity =
    /\b(?:charged|paid|deducted|taken)\b[\s\S]{0,20}\b(?:twice|two times|double)\b/i.test(
      text
    ) ||
    /\b(?:twice|two times|double)\b[\s\S]{0,20}\b(?:charged|paid|deducted|same payment)\b/i.test(
      text
    );
  if (dupProximity) {
    scores.duplicate_payment = Math.max(scores.duplicate_payment || 0, 1.0);
  }

  // Phishing safety override — if the complaint explicitly asks for credential
  // sharing, it's phishing regardless of scoreboard.
  for (const re of SHARING_PHRASES) {
    if (re.test(text)) {
      scores.phishing_or_social_engineering = Math.max(
        scores.phishing_or_social_engineering || 0,
        2.0
      );
      break;
    }
  }

  return scores;
}

// ────────────────────────────────────────────────────────────────────────────
// Pick the winning case_type + score.
// ────────────────────────────────────────────────────────────────────────────
function pickCaseType(complaint, userType) {
  const scores = scoreComplaint(complaint);

  // Tiny user_type reroute nudges (don't override strong signals).
  if (userType === "merchant" && (scores.merchant_settlement_delay ?? 0) > 0) {
    scores.merchant_settlement_delay += 0.2;
  }
  if (userType === "agent" && (scores.agent_cash_in_issue ?? 0) > 0) {
    scores.agent_cash_in_issue += 0.2;
  }

  let bestType = "other";
  let bestScore = 0;
  for (const [type, s] of Object.entries(scores)) {
    if (s > bestScore) {
      bestScore = s;
      bestType = type;
    }
  }

  // Confidence = best score normalized to 0..1 (saturate at 2.0).
  const confidence = Math.max(0.3, Math.min(1, bestScore / 2));
  return { case_type: bestType, confidence, raw_scores: scores };
}

// ────────────────────────────────────────────────────────────────────────────
// Transaction scoring.
// Pick the transaction in history most relevant to the complaint. Score by
// type match, recency, and (if complaint mentions a number) counterparty.
// ────────────────────────────────────────────────────────────────────────────
function pickTransaction(complaint, history, caseType) {
  if (!Array.isArray(history) || history.length === 0) {
    return { transaction: null, score: 0, reason: "no_history" };
  }

  const text = normalize(complaint);
  const now = Date.now();

  let best = null;
  let bestScore = -1;
  let bestReason = "low_signal";

  for (const txn of history) {
    let s = 0;
    const reasons = [];

    // Type alignment with case_type
    if (caseType === "wrong_transfer" && txn.type === "transfer") {
      s += 1.0;
      reasons.push("type_transfer");
    }
    if (caseType === "payment_failed" &&
        (txn.type === "transfer" || txn.type === "payment")) {
      s += 1.0;
      reasons.push("type_payment");
    }
    if (caseType === "refund_request" &&
        (txn.status === "completed" || txn.status === "reversed")) {
      s += 0.6;
      reasons.push("completed_txn");
    }
    if (caseType === "duplicate_payment" &&
        (txn.type === "transfer" || txn.type === "payment")) {
      s += 0.7;
      reasons.push("payment_type");
    }
    if (caseType === "merchant_settlement_delay" && txn.type === "settlement") {
      s += 1.0;
      reasons.push("type_settlement");
    }
    if (caseType === "agent_cash_in_issue" && txn.type === "cash_in") {
      s += 1.0;
      reasons.push("type_cash_in");
    }

    // Status mismatches reduce the score
    if (caseType === "payment_failed" && txn.status === "completed") {
      s -= 0.4;
      reasons.push("status_conflict");
    }

    // Number mention — if complaint mentions a phone, look for it in counterparty
    const phoneMatch = text.match(/\+?88?01[3-9]\d{8}|\b01[3-9]\d{8}\b/);
    if (phoneMatch && txn.counterparty &&
        txn.counterparty.replace(/\D/g, "").includes(phoneMatch[0].replace(/\D/g, ""))) {
      s += 1.5;
      reasons.push("counterparty_match");
    }

    // Amount mention — if complaint mentions a number near "taka/BDT"
    const amountMatch = text.match(/(\d{2,7})\s*(taka|tk|bdt|টাকা)?/);
    if (amountMatch && typeof txn.amount === "number") {
      const mentioned = Number(amountMatch[1]);
      if (Math.abs(mentioned - txn.amount) <= Math.max(1, txn.amount * 0.05)) {
        s += 0.8;
        reasons.push("amount_match");
      }
    }

    // Recency tiebreaker — within last 24h wins
    const ts = Date.parse(txn.timestamp);
    if (Number.isFinite(ts)) {
      const ageH = (now - ts) / 36e5;
      if (ageH < 24) s += 0.3;
      else if (ageH < 72) s += 0.1;
    }

    if (s > bestScore) {
      bestScore = s;
      best = txn;
      bestReason = reasons.join(",") || "fallback";
    }
  }

  // Threshold: must beat 0.4 to claim a match. Otherwise say no match.
  if (bestScore < 0.4) {
    return { transaction: null, score: bestScore, reason: "below_threshold" };
  }
  return { transaction: best, score: bestScore, reason: bestReason };
}

// ────────────────────────────────────────────────────────────────────────────
// Compare complaint claim vs transaction reality → evidence_verdict.
// ────────────────────────────────────────────────────────────────────────────
function reconcileEvidence(complaint, txn, caseType) {
  if (!txn) return { verdict: "insufficient_data", reason: "no_transaction" };

  const text = normalize(complaint);

  // Phishing is its own beast — there's no transaction claim to reconcile.
  if (caseType === "phishing_or_social_engineering") {
    return { verdict: "insufficient_data", reason: "phishing_no_txn_claim" };
  }

  // Status-based reconciliation
  if (caseType === "payment_failed") {
    if (txn.status === "failed") return { verdict: "consistent", reason: "status_failed" };
    if (txn.status === "completed") return { verdict: "inconsistent", reason: "status_completed" };
    if (txn.status === "pending") return { verdict: "insufficient_data", reason: "status_pending" };
    if (txn.status === "reversed") return { verdict: "consistent", reason: "status_reversed_implies_failed" };
  }

  if (caseType === "wrong_transfer" || caseType === "duplicate_payment") {
    if (txn.status === "completed") return { verdict: "consistent", reason: "completed_transfer" };
    if (txn.status === "failed") return { verdict: "inconsistent", reason: "txn_failed_not_completed" };
    if (txn.status === "pending") return { verdict: "insufficient_data", reason: "pending" };
    if (txn.status === "reversed") return { verdict: "inconsistent", reason: "already_reversed" };
  }

  if (caseType === "refund_request") {
    if (txn.status === "completed") return { verdict: "consistent", reason: "completed_can_be_refunded" };
    if (txn.status === "failed") return { verdict: "inconsistent", reason: "failed_nothing_to_refund" };
    if (txn.status === "reversed") return { verdict: "inconsistent", reason: "already_reversed" };
    if (txn.status === "pending") return { verdict: "insufficient_data", reason: "pending" };
  }

  if (caseType === "merchant_settlement_delay" && txn.type === "settlement") {
    if (txn.status === "pending") return { verdict: "consistent", reason: "settlement_pending" };
    if (txn.status === "completed") return { verdict: "inconsistent", reason: "settlement_completed" };
    if (txn.status === "failed") return { verdict: "inconsistent", reason: "settlement_failed" };
  }

  if (caseType === "agent_cash_in_issue" && txn.type === "cash_in") {
    if (txn.status === "pending") return { verdict: "consistent", reason: "cash_in_pending" };
    if (txn.status === "completed") return { verdict: "inconsistent", reason: "cash_in_completed" };
    if (txn.status === "failed") return { verdict: "consistent", reason: "cash_in_failed_visible" };
  }

  // Fallback heuristic: claim contains "didn't receive" / "not received" /
  // "didn't get" while status is completed → inconsistent.
  const saysNotReceived =
    /\b(not received|didn'?t receive|did not receive|didn'?t get|did not get|haven'?t received|hasn'?t arrived|আসেনি|পাইনি)\b/i.test(
      text
    );
  if (saysNotReceived && txn.status === "completed") {
    return { verdict: "inconsistent", reason: "completed_but_says_not_received" };
  }

  return { verdict: "insufficient_data", reason: "no_strong_signal" };
}

// ────────────────────────────────────────────────────────────────────────────
// Severity. Starts from the default for the case_type, then bumps up or down
// based on amount, evidence, channel, and inconsistencies.
// ────────────────────────────────────────────────────────────────────────────
const SEV_RANK = { low: 0, medium: 1, high: 2, critical: 3 };
function bumpSeverity(current, delta) {
  const next = (SEV_RANK[current] || 1) + delta;
  const idx = Math.max(0, Math.min(3, next));
  return ["low", "medium", "high", "critical"][idx];
}

function computeSeverity({ caseType, txn, evidence, complaint }) {
  let sev = DEFAULT_SEVERITY[caseType] || "medium";
  const text = normalize(complaint);

  // Large amounts → high or critical
  if (txn && typeof txn.amount === "number") {
    if (txn.amount >= 50000) sev = bumpSeverity(sev, +2);
    else if (txn.amount >= 10000) sev = bumpSeverity(sev, +1);
  }

  // Inconsistent evidence (customer is wrong) → bump up so an agent double-checks
  if (evidence === "inconsistent") sev = bumpSeverity(sev, +1);

  // Phishing is always critical
  if (caseType === "phishing_or_social_engineering") sev = "critical";

  // call_center channel usually = more urgent
  // (handled via channel metadata; keep simple)

  return sev;
}

// ────────────────────────────────────────────────────────────────────────────
// Department rerouting. Start with the default for the case_type, then
// adjust when the situation calls for it.
// ────────────────────────────────────────────────────────────────────────────
function computeDepartment({ caseType, evidence, txn }) {
  let dept = DEFAULT_DEPARTMENT[caseType] || "customer_support";

  // Vague refund / insufficient data → customer_support
  if (caseType === "refund_request" && evidence === "insufficient_data") {
    dept = "customer_support";
  }

  // High-value dispute → still dispute_resolution (already correct), but if
  // evidence is inconsistent and amount is large, escalate to fraud_risk
  if (evidence === "inconsistent" && caseType === "wrong_transfer" &&
      txn && typeof txn.amount === "number" && txn.amount >= 50000) {
    dept = "fraud_risk";
  }

  return dept;
}

// ────────────────────────────────────────────────────────────────────────────
// human_review_required. Defaults to true for: phishing, critical severity,
// high-value disputes, inconsistent evidence, and ambiguous cases.
// ────────────────────────────────────────────────────────────────────────────
function needsHumanReview({ caseType, severity, evidence, txn }) {
  if (caseType === "phishing_or_social_engineering") return true;
  if (severity === "critical") return true;
  if (evidence === "inconsistent") return true;
  if (evidence === "insufficient_data" && (severity === "high" || severity === "critical")) return true;
  if (txn && typeof txn.amount === "number" && txn.amount >= 50000 &&
      (caseType === "wrong_transfer" || caseType === "duplicate_payment" ||
       caseType === "refund_request")) {
    return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Public entry point. Pure function — no I/O, no globals. Used by both the
// Next.js API route and the local test harness.
// ────────────────────────────────────────────────────────────────────────────
export function classify(req) {
  const { complaint, user_type, transaction_history } = req;

  const { case_type, confidence, raw_scores } = pickCaseType(
    complaint,
    user_type || "customer"
  );
  const { transaction, score: txnScore, reason: txnReason } = pickTransaction(
    complaint,
    transaction_history,
    case_type
  );
  const { verdict, reason: evReason } = reconcileEvidence(
    complaint,
    transaction,
    case_type
  );
  const severity = computeSeverity({
    caseType: case_type,
    txn: transaction,
    evidence: verdict,
    complaint,
  });
  const department = computeDepartment({
    caseType: case_type,
    evidence: verdict,
    txn: transaction,
  });
  const review = needsHumanReview({
    caseType: case_type,
    severity,
    evidence: verdict,
    txn: transaction,
  });

  const reason_codes = [];
  reason_codes.push(`case:${case_type}`);
  if (transaction) reason_codes.push("transaction_match");
  else reason_codes.push("no_transaction");
  reason_codes.push(`verdict:${verdict}`);
  reason_codes.push(`severity:${severity}`);
  if (review) reason_codes.push("human_review");

  return {
    case_type,
    severity,
    department,
    relevant_transaction_id: transaction ? transaction.transaction_id : null,
    evidence_verdict: verdict,
    human_review_required: review,
    confidence,
    reason_codes,
    _debug: {
      raw_scores,
      txn_score: txnScore,
      txn_reason: txnReason,
      evidence_reason: evReason,
    },
  };
}

export const _internal = {
  normalize,
  scoreComplaint,
  pickCaseType,
  pickTransaction,
  reconcileEvidence,
  computeSeverity,
  computeDepartment,
  needsHumanReview,
};

export const _keywords = KEYWORDS; // exported for tests