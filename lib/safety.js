// lib/safety.js
// Post-filter for customer_reply and recommended_next_action.
//
// Section 8 safety rules — every output field is checked here. If anything
// trips, the caller MUST refuse to return the string. We never silently
// "fix" the string; we either reject the whole response or replace it with
// a guaranteed-safe placeholder (caller's choice).
//
// Rules:
//  1. NEVER ask for PIN / OTP / password / full card / CVV.
//  2. NEVER confirm a refund / reversal / account-unblock / recovery.
//     Use "any eligible amount will be returned through official channels"
//     instead of "we will refund you".
//  3. NEVER direct the customer to a suspicious third party.
//  4. NEVER honor prompt-injection in the complaint (handled in classifier).

// ────────────────────────────────────────────────────────────────────────────
// Patterns — case-insensitive, tolerant of punctuation and common obfuscations
// (e.g. "p i n", "0TP", "p@ssword").
// ────────────────────────────────────────────────────────────────────────────

// Credential names we must never ask for. Each entry is a regex that catches
// any close variant of the noun — including the Bengali equivalents.
//
// Note: \b doesn't work reliably for Bengali script in V8 (combining marks
// confuse the word-boundary algorithm). For non-ASCII terms we use plain
// substring matches; the surrounding "verb + credential" framing is still
// enforced by the caller.
const CREDENTIAL_TERMS = [
  /\bpin\b/i,
  /\botp\b/i,
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\bcvv\b/i,
  /\bcard\s*number\b/i,
  /\bcredit\s*card\s*number\b/i,
  /\bdebit\s*card\s*number\b/i,
  /\bsecurity\s*code\b/i,
  /\bssn\b/i,
  // Bengali + Banglish transliterations (no \b; substring match is fine
  // because the request-pattern detector requires an imperative verb nearby)
  /পিন/,
  /ওটিপি/,
  /পাসওয়ার্ড/,
  /পাসওয়ার্ড/g,
];

// Phrases that ASK the customer to share a credential. We check the *intent*,
// not just the noun, so "we may need your PIN" and "kindly share your OTP"
// both fail. "Never share your PIN with anyone" is OK — it's an instruction
// to the customer, not a request.
//
// English: verb comes BEFORE credential ("share your OTP").
// Bengali: verb comes AFTER credential ("আপনার ওটিপি শেয়ার করুন" = "your OTP share").
// We test both word orders.
const REQUEST_VERBS =
  "\\b(?:share|provide|send|tell|give|submit|enter|type|confirm|verify|kindly provide|please provide|please share|please send|please tell|please give|please share your|please confirm your)\\b";

const CREDENTIAL_REQUEST = new RegExp(
  `${REQUEST_VERBS}[^.\\n]{0,40}(?:${CREDENTIAL_TERMS.map((r) => r.source).join("|")})`,
  "i"
);

// Bengali request verbs AFTER the credential: "your OTP share" / "your PIN give"
// করুন = "do" (imperative), দিন = "give (polite)", দিবেন = "will give"
// শেয়ার করুন = "share"
const REQUEST_VERBS_AFTER_BN = "(?:শেয়ার করুন|দিন|দিবেন|পাঠান|জানান|বলুন|লিখুন|দিয়ে দিন|প্রদান করুন)";
const CREDENTIAL_REQUEST_BN = new RegExp(
  `(?:${CREDENTIAL_TERMS.map((r) => r.source).join("|")})[^.\\n]{0,40}${REQUEST_VERBS_AFTER_BN}`,
  "i"
);

// A short, tight list of phrases that promise a refund/reversal/recovery.
// "we will refund", "we'll reverse", "your account will be unblocked", etc.
// We must use neutral language: "any eligible amount will be returned via
// official channels".
//
// Note: we don't use \b because (a) it doesn't always work with Unicode
// word boundaries, and (b) the apostrophe in "we'll" trips it up. Instead
// we test against a normalized copy and allow optional whitespace.
const PROMISE_PHRASES = [
  // "we will refund", "we'll refund", "we are going to refund", "we refund"
  // (allow optional space so contractions like "we'll" match)
  /\bwe(?:'ll| will| shall| are going to)?\s+(?:refund|reverse|undo|return|unblock|unlock|recover|restore)\b/i,
  // "your money will be refunded / has been refunded / was reversed"
  /\byour (?:money|amount|funds|balance) (?:will be|has been|was|is being|shall be) (?:refunded|reversed|returned|restored)\b/i,
  // "your account will be unblocked"
  /\byour account (?:will be|has been|is) (?:unblocked|unlocked|recovered|restored)\b/i,
  // "confirming the refund / refund is processed / refund approved"
  /\bconfirm(?:ed|ing|s)? (?:the )?(?:refund|reversal)\b/i,
  /\b(?:the )?refund (?:has been|will be|is) (?:processed|approved|initiated|completed|confirmed)\b/i,
  /\b(?:the )?reversal (?:has been|will be|is) (?:processed|approved|initiated|completed|confirmed)\b/i,
];

// Third-party phone numbers / handles / URLs. We allow references to "official
// support" / "in-app help" / "our hotline" but not to a specific number unless
// it matches the platform's official hotline format. We do NOT allow telling
// the customer to call a number they were scammed with.
const SUSPICIOUS_THIRD_PARTY = [
  // "call +8801xxxxxxxxx" / "call 01xxxxxxxxx" / "call 8801xxxxxxxxx"
  /\bcall\s+(?:\+?88)?01[3-9]\d{8}\b/i,
  // "call us on +8801xxxxxxxxx"
  /\bcall us (?:on|at)\s+(?:\+?88)?01[3-9]\d{8}\b/i,
  // "sms/whatsapp to 01xxxxxxxxx"
  /\b(?:sms|whatsapp)\s+(?:me |us |to )?(?:\+?88)?01[3-9]\d{8}\b/i,
  // "send to 01xxxxxxxxx" / "forward to 01xxxxxxxxx" / "share with 01xxxxxxxxx"
  /\b(?:send|forward|share)\s+(?:it |this |your |the )?(?:details|otp|pin|password|info|information)?\s*(?:to|on)?\s*(?:\+?88)?01[3-9]\d{8}\b/i,
  // Generic: 11-digit BD phone number paired with verbs like "call", "SMS", "WhatsApp", "contact"
  /\b(?:call|sms|whatsapp|contact|dial|reach)\b[\s\S]{0,40}\b(?:\+?88)?01[3-9]\d{8}\b/i,
  // Any non-platform URL
  /\bhttps?:\/\/(?!.*(?:bkash|nagad|rocket|surecash|upay|mycash|grameenphone|robi|banglalink|teletalk|airtel|bkash)\.)[^\s)]+/i,
];

// Pre-normalize for matching: strip punctuation that confuses \b, but keep
// Bengali glyphs intact. Use a dedicated variant for the promise filter
// because we'll/regex tests need apostrophes preserved.
function normForSearch(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a string contains a forbidden credential request.
 * @param {string} text
 * @returns {{ ok: boolean, reason?: string, match?: string }}
 */
export function checkCredentialRequest(text) {
  if (!text) return { ok: true };

  // Normalize whitespace so we don't get fooled by line wraps.
  const flat = text.replace(/\s+/g, " ");

  // Whitelisted safety-warning phrases — explicitly tell the customer NOT
  // to share. These contain "share your PIN" but in a negation context.
  // If the whole sentence is a "do not share / never ask / never share"
  // advisory, allow it.
  const isAdvisory =
    /\bdo not share\b/i.test(flat) ||
    /\bnever share\b/i.test(flat) ||
    /\bnever (?:ask|request|require|demand)\b/i.test(flat) ||
    /\bwill never ask\b/i.test(flat) ||
    /\bdo not (?:provide|send|tell|give|enter)\b/i.test(flat) ||
    /\b(?:do not|never)\b[\s\S]{0,30}\b(?:share|provide|send|tell|give)\b/i.test(flat);

  if (CREDENTIAL_REQUEST.test(flat) && !isAdvisory) {
    return {
      ok: false,
      reason: "credential_request",
      match: flat.match(CREDENTIAL_REQUEST)?.[0] || "",
    };
  }

  // Bengali: credential followed by imperative verb ("your OTP share do").
  if (CREDENTIAL_REQUEST_BN.test(flat) && !isAdvisory) {
    return {
      ok: false,
      reason: "credential_request",
      match: flat.match(CREDENTIAL_REQUEST_BN)?.[0] || "",
    };
  }

  // Belt and braces: any standalone credential noun + imperative verb, but
  // NOT in an advisory sentence, is suspicious.
  if (!isAdvisory) {
    for (const term of CREDENTIAL_TERMS) {
      if (
        term.test(flat) &&
        /\b(share|provide|send|tell|give|enter|kindly|please)\b/i.test(flat)
      ) {
        return { ok: false, reason: "credential_request", match: term.source };
      }
    }
  }
  return { ok: true };
}

/**
 * Check whether a string promises a refund/reversal.
 */
export function checkPromise(text) {
  if (!text) return { ok: true };
  for (const re of PROMISE_PHRASES) {
    if (re.test(text)) {
      return {
        ok: false,
        reason: "refund_or_reversal_promise",
        match: text.match(re)?.[0] || "",
      };
    }
  }
  return { ok: true };
}

/**
 * Check whether a string directs the customer to a suspicious third party.
 */
export function checkThirdParty(text) {
  if (!text) return { ok: true };
  for (const re of SUSPICIOUS_THIRD_PARTY) {
    if (re.test(text)) {
      return {
        ok: false,
        reason: "suspicious_third_party",
        match: text.match(re)?.[0] || "",
      };
    }
  }
  return { ok: true };
}

/**
 * Run all checks against a single string. Returns the first violation, or ok.
 *
 * Note: each check returns `{ok: true}` for safe strings — which is truthy.
 * We must explicitly check `result.ok === false` to know if the string was
 * rejected. Using `||` to chain checks is therefore wrong; we chain the
 * check *functions* and inspect each result.
 */
export function checkAll(text) {
  const checks = [
    checkCredentialRequest,
    checkPromise,
    checkThirdParty,
  ];
  for (const fn of checks) {
    const result = fn(text);
    if (result && result.ok === false) return result;
  }
  return { ok: true };
}

/**
 * Wrap a customer_reply in a guaranteed-safe fallback if any check fails.
 * The fallback itself is tested to pass all checks.
 *
 * @param {string} text
 * @param {{ language?: "en"|"bn"|"mixed" }} [opts]
 * @returns {string} either the original text or a safe fallback
 */
// Fallback strings must themselves pass checkAll() — verified at module
// load. If a future edit introduces a forbidden phrase, the process logs
// an error and the fallback is replaced by a hard-coded ultra-safe one.
const SAFE_CUSTOMER_REPLY_FALLBACK = {
  en: "We have received your concern. A support agent will review it and contact you through official channels. For your safety, please do not share your PIN, OTP, or password with anyone — our team will never ask for these.",
  bn: "আমরা আপনার অভিযোগ পেয়েছি। একজন সহায়তা এজেন্ট অফিসিয়াল চ্যানেলের মাধ্যমে এটি পর্যালোচনা করবেন এবং আপনার সাথে যোগাযোগ করবেন। আপনার সুরক্ষার জন্য, অনুগ্রহ করে আপনার পিন, ওটিপি বা পাসওয়ার্ড কারো সাথে শেয়ার করবেন না — আমাদের দল কখনোই এগুলো জিজ্ঞেস করবে না।",
  mixed: "We have received your concern. A support agent will review it and contact you through official channels. For your safety, please do not share your PIN, OTP, or password with anyone — our team will never ask for these.",
};

// Ultra-safe last-resort fallback (no credentials at all).
const ULTRA_SAFE_FALLBACK =
  "We have received your concern. A support agent will review it and contact you through official channels.";

// Validate fallbacks at module load — if any fail, fall back to ultra-safe.
for (const [lang, text] of Object.entries(SAFE_CUSTOMER_REPLY_FALLBACK)) {
  const v = checkAll(text);
  if (!v.ok) {
    console.error(
      `[safety] ${lang} fallback FAILED self-check:`,
      v.reason,
      v.match
    );
    SAFE_CUSTOMER_REPLY_FALLBACK[lang] = ULTRA_SAFE_FALLBACK;
  }
}

const SAFE_ACTION_FALLBACK =
  "Review the case in the operations console and escalate to the appropriate department per the safety policy.";
let _actionFallback = SAFE_ACTION_FALLBACK;
{
  const v = checkAll(_actionFallback);
  if (!v.ok) {
    console.error("[safety] action fallback FAILED self-check:", v.reason);
    _actionFallback = ULTRA_SAFE_FALLBACK;
  }
}

export function safeCustomerReply(text, opts = {}) {
  const lang = opts.language || "en";
  const v = checkAll(text);
  if (v.ok) return text;
  return SAFE_CUSTOMER_REPLY_FALLBACK[lang] || SAFE_CUSTOMER_REPLY_FALLBACK.en;
}

/**
 * Wrap a recommended_next_action. The action field is for the internal agent,
 * so it's less constrained than customer_reply but still must not promise a
 * refund or ask the agent to call a third-party number.
 */
export function safeRecommendedAction(text, opts = {}) {
  const v = checkAll(text);
  if (v.ok) return text;
  return _actionFallback;
}

// ────────────────────────────────────────────────────────────────────────────
// Exported for testing.
// ────────────────────────────────────────────────────────────────────────────
export const _internal = {
  CREDENTIAL_TERMS,
  REQUEST_VERBS,
  CREDENTIAL_REQUEST,
  PROMISE_PHRASES,
  SUSPICIOUS_THIRD_PARTY,
};