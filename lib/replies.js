// lib/replies.js
// Templated customer_reply + agent_summary + recommended_next_action.
//
// Inputs:
//   - caseType, severity, verdict, txn (or null), language, complaint, userType
//
// Outputs (all strings, all post-filtered through lib/safety.js):
//   - agent_summary: 1–2 sentence internal digest for the support agent.
//   - recommended_next_action: suggested operational next step.
//   - customer_reply: safe, official reply for the customer.

import { safeCustomerReply, safeRecommendedAction } from "./safety.js";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function fmtAmount(txn) {
  if (!txn || typeof txn.amount !== "number") return "the amount";
  return `${txn.amount.toLocaleString("en-US")} BDT`;
}

function fmtClaim(claimed) {
  if (claimed === null || claimed === undefined) return null;
  return `${claimed.toLocaleString("en-US")} BDT`;
}

function fmtTxn(txn) {
  if (!txn) return "your recent transaction";
  return `transaction ${txn.transaction_id}`;
}

function verdictWord(v, lang) {
  if (lang === "bn") {
    return v === "consistent"
      ? "ডেটার সাথে সামঞ্জস্যপূর্ণ"
      : v === "inconsistent"
      ? "ডেটার সাথে সামঞ্জস্যপূর্ণ নয়"
      : "যথেষ্ট তথ্য নেই";
  }
  return v === "consistent"
    ? "consistent with the data"
    : v === "inconsistent"
    ? "contradicted by the data"
    : "not yet determined from the available data";
}

function pickLang(language) {
  if (language === "bn") return "bn";
  return "en";
}

// ────────────────────────────────────────────────────────────────────────────
// Per-case templates. Each template returns { agent_summary,
// recommended_next_action, customer_reply }. Templates NEVER include a
// credential request, refund promise, or third-party redirect — but they go
// through safeCustomerReply / safeRecommendedAction anyway as belt + braces.
// ────────────────────────────────────────────────────────────────────────────

const TEMPLATES = {
  wrong_transfer: (ctx) => {
    const { lang, txn, verdict, claimedAmount, amountMismatch } = ctx;
    const amt = fmtAmount(txn);
    const claimed = fmtClaim(claimedAmount);
    const tx = fmtTxn(txn);
    // When the customer's claimed amount differs from the txn-record amount,
    // lead the summary with the customer's claim — that's what they reported
    // — and flag the mismatch explicitly so the support agent sees both.
    const mismatchNote = (amountMismatch && claimed)
      ? (lang === "bn"
          ? ` গ্রাহক ${claimed} দাবি করেছেন, কিন্তু ${tx}-তে ${amt} রেকর্ড আছে — পরিমাণের অমিল রয়েছে।`
          : ` Customer claims ${claimed}, but ${tx} shows ${amt} — amount mismatch.`)
      : "";
    if (lang === "bn") {
      return {
        agent_summary: `গ্রাহক ${tx} এর মাধ্যমে ${amt} ভুল প্রাপকের কাছে পাঠিয়েছেন বলে জানিয়েছেন। প্রমাণ: ${verdictWord(verdict, "bn")}।${mismatchNote}`,
        recommended_next_action: amountMismatch && claimed
          ? `গ্রাহকের দাবিকৃত পরিমাণ (${claimed}) এবং ${tx}-এ রেকর্ড করা পরিমাণ (${amt}) মেলানো যাচ্ছে না। গ্রাহকের সাথে যোগাযোগ করে সঠিক লেনদেন যাচাই করুন এবং dispute_resolution-এ রুট করুন।`
          : `${tx} এর বিবরণ যাচাই করুন এবং প্রাপকের সাথে যোগাযোগের চেষ্টা করুন। বিভাগ: dispute_resolution।`,
        customer_reply: `আমরা ${tx} সম্পর্কে আপনার উদ্বেগ গ্রহণ করেছি। যেকোনো যোগ্য পরিমাণ অফিসিয়াল চ্যানেলের মাধ্যমে ফেরত দেওয়া হবে। আমাদের দল এই কেসটি পর্যালোচনা করছে। আপনার সুরক্ষার জন্য, অনুগ্রহ করে কারো সাথে আপনার পিন, ওটিপি বা পাসওয়ার্ড শেয়ার করবেন না।`,
      };
    }
    return {
      agent_summary: `Customer reports sending ${amt} to the wrong recipient via ${tx}. Evidence verdict: ${verdictWord(verdict, "en")}.${mismatchNote}`,
      recommended_next_action: amountMismatch && claimed
        ? `Customer's claimed amount (${claimed}) does not match the ${amt} recorded on ${tx}. Contact the customer to confirm which transaction they are referring to before initiating dispute_resolution.`
        : `Verify ${tx} details with the customer and attempt recipient contact through official channels. Route to dispute_resolution.`,
      customer_reply: `We have noted your concern about ${tx}. Any eligible amount will be returned to you through official channels after review. Our team is looking into this case. For your safety, please do not share your PIN, OTP, or password with anyone — our team will never ask for these.`,
    };
  },

  payment_failed: (ctx) => {
    const { lang, txn, verdict, claimedAmount, amountMismatch } = ctx;
    const amt = fmtAmount(txn);
    const claimed = fmtClaim(claimedAmount);
    const tx = fmtTxn(txn);
    const mismatchNote = (amountMismatch && claimed)
      ? (lang === "bn"
          ? ` গ্রাহক ${claimed} দাবি করেছেন, কিন্তু ${tx}-তে ${amt} রেকর্ড আছে — পরিমাণের অমিল রয়েছে।`
          : ` Customer claims ${claimed}, but ${tx} shows ${amt} — amount mismatch.`)
      : "";
    if (lang === "bn") {
      return {
        agent_summary: `গ্রাহক ${tx} ব্যর্থ হয়েছে বলে জানিয়েছেন কিন্তু ${amt} বাদ দেওয়া হয়েছে। প্রমাণ: ${verdictWord(verdict, "bn")}।${mismatchNote}`,
        recommended_next_action: amountMismatch && claimed
          ? `গ্রাহকের দাবিকৃত পরিমাণ (${claimed}) এবং ${tx}-এ রেকর্ড করা পরিমাণ (${amt}) মেলানো যাচ্ছে না। গ্রাহকের সাথে যোগাযোগ করে সঠিক লেনদেন যাচাই করুন এবং payments_ops-এ রুট করুন।`
          : `${tx} এর ব্যর্থতার কারণ যাচাই করুন এবং প্রয়োজনে অটো-রিভার্সাল স্ট্যাটাস পরীক্ষা করুন। বিভাগ: payments_ops।`,
        customer_reply: `আমরা ${tx} সম্পর্কে আপনার অভিযোগ পেয়েছি। পেমেন্ট অপারেশন দল এটি পর্যালোচনা করছে। যেকোনো যোগ্য পরিমাণ অফিসিয়াল চ্যানেলের মাধ্যমে ফেরত দেওয়া হবে। অনুগ্রহ করে কারো সাথে আপনার পিন, ওটিপি বা পাসওয়ার্ড শেয়ার করবেন না।`,
      };
    }
    return {
      agent_summary: `Customer reports ${tx} failed but ${amt} was deducted. Evidence verdict: ${verdictWord(verdict, "en")}.${mismatchNote}`,
      recommended_next_action: amountMismatch && claimed
        ? `Customer's claimed amount (${claimed}) does not match the ${amt} recorded on ${tx}. Verify which transaction is in question before reconciliation. Route to payments_ops.`
        : `Verify ${tx} failure reason and check auto-reversal status. Route to payments_ops for manual reconciliation if needed.`,
      customer_reply: `We have received your concern about ${tx}. Our payments team is reviewing it. Any eligible amount will be returned through official channels after the review. For your safety, please do not share your PIN, OTP, or password with anyone.`,
    };
  },

  refund_request: (ctx) => {
    const { lang, txn, verdict } = ctx;
    const tx = fmtTxn(txn);
    if (lang === "bn") {
      return {
        agent_summary: `গ্রাহক ${tx} এর জন্য ফেরতের অনুরোধ করেছেন। প্রমাণ: ${verdictWord(verdict, "bn")}।`,
        recommended_next_action: `${tx} এর এলিজিবিলিটি যাচাই করুন এবং প্রযোজ্য হলে dispute_resolution-এ রুট করুন।`,
        customer_reply: `আমরা ${tx} সম্পর্কে আপনার ফেরতের অনুরোধ পেয়েছি। এলিজিবল পরিমাণ অফিসিয়াল চ্যানেলের মাধ্যমে প্রক্রিয়া করা হবে। আমাদের দল পর্যালোচনা করছে। অনুগ্রহ করে কারো সাথে আপনার পিন, ওটিপি বা পাসওয়ার্ড শেয়ার করবেন না।`,
      };
    }
    return {
      agent_summary: `Customer is requesting a refund for ${tx}. Evidence verdict: ${verdictWord(verdict, "en")}.`,
      recommended_next_action: `Verify ${tx} eligibility and route to dispute_resolution if contested, or to payments_ops if already completed and reversible.`,
      customer_reply: `We have noted your refund request for ${tx}. Any eligible amount will be returned through official channels after review. Our team is looking into it. For your safety, please do not share your PIN, OTP, or password with anyone.`,
    };
  },

  duplicate_payment: (ctx) => {
    const { lang, txn } = ctx;
    const tx = fmtTxn(txn);
    if (lang === "bn") {
      return {
        agent_summary: `গ্রাহক একই পেমেন্ট একাধিকবার চার্জ হয়েছে বলে জানিয়েছেন (${tx})।`,
        recommended_next_action: `${tx} এর ডুপ্লিকেট এন্ট্রি যাচাই করুন এবং payments_ops-এ রুট করুন।`,
        customer_reply: `আমরা ${tx} সম্পর্কে আপনার উদ্বেগ পেয়েছি। পেমেন্ট দল এটি পর্যালোচনা করছে। যেকোনো যোগ্য পরিমাণ অফিসিয়াল চ্যানেলের মাধ্যমে ফেরত দেওয়া হবে। অনুগ্রহ করে কারো সাথে আপনার পিন, ওটিপি বা পাসওয়ার্ড শেয়ার করবেন না।`,
      };
    }
    return {
      agent_summary: `Customer reports duplicate charge for ${tx}.`,
      recommended_next_action: `Verify duplicate entries in payments log for ${tx} and route to payments_ops for reconciliation.`,
      customer_reply: `We have noted your concern about a duplicate charge on ${tx}. Our payments team is reviewing it. Any eligible amount will be returned through official channels. For your safety, please do not share your PIN, OTP, or password with anyone.`,
    };
  },

  merchant_settlement_delay: (ctx) => {
    const { lang, txn } = ctx;
    const tx = fmtTxn(txn);
    if (lang === "bn") {
      return {
        agent_summary: `মার্চেন্ট গ্রাহক ${tx} এর সেটেলমেন্ট পাননি বলে জানিয়েছেন।`,
        recommended_next_action: `${tx} এর সেটেলমেন্ট স্ট্যাটাস merchant_operations-এ যাচাই করুন।`,
        customer_reply: `আমরা ${tx} সম্পর্কে আপনার সেটেলমেন্ট বিলম্বের অভিযোগ পেয়েছি। মার্চেন্ট অপারেশন দল এটি পর্যালোচনা করছে। আপডেট পাওয়া গেলে আমরা আপনাকে জানাব। অনুগ্রহ করে কারো সাথে আপনার পিন, ওটিপি বা পাসওয়ার্ড শেয়ার করবেন না।`,
      };
    }
    return {
      agent_summary: `Merchant reports not receiving settlement for ${tx}.`,
      recommended_next_action: `Verify settlement status of ${tx} with merchant_operations and check pending settlement queue.`,
      customer_reply: `We have received your concern about the settlement delay for ${tx}. Our merchant operations team is reviewing it. We will update you once the review is complete. For your safety, please do not share your PIN, OTP, or password with anyone.`,
    };
  },

  agent_cash_in_issue: (ctx) => {
    const { lang, txn } = ctx;
    const tx = fmtTxn(txn);
    if (lang === "bn") {
      return {
        agent_summary: `গ্রাহক এজেন্টের মাধ্যমে ক্যাশ ইন করেছেন বলে জানিয়েছেন কিন্তু ব্যালেন্স বাড়েনি (${tx})।`,
        recommended_next_action: `${tx} ক্যাশ-ইন এন্ট্রি যাচাই করুন এবং agent_operations-এ রুট করুন।`,
        customer_reply: `আমরা ${tx} সম্পর্কে আপনার ক্যাশ ইন সমস্যা পেয়েছি। এজেন্ট অপারেশন দল এটি পর্যালোচনা করছে। যেকোনো যোগ্য পরিমাণ অফিসিয়াল চ্যানেলের মাধ্যমে ফেরত দেওয়া হবে। অনুগ্রহ করে কারো সাথে আপনার পিন, ওটিপি বা পাসওয়ার্ড শেয়ার করবেন না।`,
      };
    }
    return {
      agent_summary: `Customer reports cash-in via agent not reflected in balance (${tx}).`,
      recommended_next_action: `Verify ${tx} cash-in entry with the agent and route to agent_operations for reconciliation.`,
      customer_reply: `We have noted your concern about the agent cash-in issue with ${tx}. Our agent operations team is reviewing it. Any eligible amount will be returned through official channels after review. For your safety, please do not share your PIN, OTP, or password with anyone.`,
    };
  },

  phishing_or_social_engineering: (ctx) => {
    const { lang } = ctx;
    if (lang === "bn") {
      return {
        agent_summary: `গ্রাহক একটি সন্দেহজনক কল বা বার্তার কথা জানিয়েছেন যেখানে তার কাছ থেকে সংবেদনশীল তথ্য চাওয়া হয়েছে। fraud_risk দল অবিলম্বে পর্যালোচনা করবে।`,
        recommended_next_action: `অবিলম্বে fraud_risk দলে এসকেলেট করুন। গ্রাহকের অ্যাকাউন্টে কোনো অস্বাভাবিক লেনদেন আছে কিনা তা পরীক্ষা করুন।`,
        customer_reply: `আপনার নিরাপত্তা আমাদের কাছে সবচেয়ে গুরুত্বপূর্ণ। আমাদের দল কখনোই আপনার কাছ থেকে পিন, ওটিপি বা পাসওয়ার্ড চাইবে না। এই ধরনের কল বা বার্তা সম্পর্কে আমাদের জানানোর জন্য ধন্যবাদ — আমাদের fraud risk দল এটি পর্যালোচনা করবে। অনুগ্রহ করে অফিসিয়াল চ্যানেল ছাড়া অন্য কোথাও আপনার তথ্য শেয়ার করবেন না।`,
      };
    }
    return {
      agent_summary: `Customer reports a suspicious call or message asking for sensitive credentials. fraud_risk team should review immediately.`,
      recommended_next_action: `Escalate to fraud_risk immediately. Check for any unauthorized transactions on the customer's account and flag the contact.`,
      customer_reply: `Your safety is our highest priority. Our team will never ask for your PIN, OTP, or password. Thank you for reporting this suspicious contact — our fraud risk team will review it. Please do not share any personal information outside of our official channels.`,
    };
  },

  other: (ctx) => {
    const { lang } = ctx;
    if (lang === "bn") {
      return {
        agent_summary: `গ্রাহকের অভিযোগ নির্দিষ্ট কোনো কেস টাইপে মানছে না। সাধারণ সহায়তা দল পর্যালোচনা করবে।`,
        recommended_next_action: `সাধারণ সহায়তা টিমে রুট করুন এবং প্রয়োজনে স্পেসিফিক বিভাগে এসকেলেট করুন।`,
        customer_reply: `আমরা আপনার অভিযোগ পেয়েছি। আমাদের সহায়তা দল এটি পর্যালোচনা করবে এবং আপনার সাথে যোগাযোগ করবে। অনুগ্রহ করে কারো সাথে আপনার পিন, ওটিপি বা পাসওয়ার্ড শেয়ার করবেন না।`,
      };
    }
    return {
      agent_summary: `Customer complaint does not match a specific case_type. Routing to general customer support for triage.`,
      recommended_next_action: `Route to customer_support for further triage; escalate to a specific department once the underlying issue is identified.`,
      customer_reply: `We have received your concern. Our support team will review it and contact you through official channels. For your safety, please do not share your PIN, OTP, or password with anyone — our team will never ask for these.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Public entry point.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate the three text fields for the response. All strings are run
 * through the safety filter before being returned.
 *
 * @param {object} args
 * @param {string} args.caseType
 * @param {string} args.severity
 * @param {string} args.verdict
 * @param {object|null} args.txn - the matched transaction (or null)
 * @param {string} args.language
 * @param {string} args.complaint
 * @param {string} args.userType
 * @returns {{ agent_summary: string, recommended_next_action: string, customer_reply: string }}
 */
export function buildReplies(args) {
  const lang = pickLang(args.language);
  const fn = TEMPLATES[args.caseType] || TEMPLATES.other;
  const ctx = {
    lang,
    severity: args.severity,
    verdict: args.verdict,
    txn: args.txn,
    complaint: args.complaint,
    userType: args.userType,
    claimedAmount: args.claimedAmount ?? null,
    txnAmount: args.txnAmount ?? null,
    amountMismatch: args.amountMismatch ?? false,
  };
  const raw = fn(ctx);

  // Pass every output through the safety filter as a final guarantee.
  // agent_summary is internal (for the support agent), but we still run the
  // full checkAll() over it — defense in depth in case a future template
  // change introduces a forbidden phrase.
  const agent_summary = safeRecommendedAction(raw.agent_summary, {
    language: lang,
  });
  const recommended_next_action = safeRecommendedAction(
    raw.recommended_next_action,
    { language: lang }
  );
  const customer_reply = safeCustomerReply(raw.customer_reply, {
    language: lang,
  });

  return { agent_summary, recommended_next_action, customer_reply };
}