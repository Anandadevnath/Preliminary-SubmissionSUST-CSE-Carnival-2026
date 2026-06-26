// Canonical taxonomy per problem statement §7. Single source of truth —
// every other module imports from here so a typo can only happen once.

export const CASE_TYPES = Object.freeze([
  "wrong_transfer",
  "payment_failed",
  "refund_request",
  "duplicate_payment",
  "merchant_settlement_delay",
  "agent_cash_in_issue",
  "phishing_or_social_engineering",
  "other",
]);

export const DEPARTMENTS = Object.freeze([
  "customer_support",
  "dispute_resolution",
  "payments_ops",
  "merchant_operations",
  "agent_operations",
  "fraud_risk",
]);

export const SEVERITIES = Object.freeze(["low", "medium", "high", "critical"]);

export const EVIDENCE_VERDICTS = Object.freeze([
  "consistent",
  "inconsistent",
  "insufficient_data",
]);

export const LANGUAGES = Object.freeze(["en", "bn", "mixed"]);
export const CHANNELS = Object.freeze([
  "in_app_chat",
  "call_center",
  "email",
  "merchant_portal",
  "field_agent",
]);
export const USER_TYPES = Object.freeze([
  "customer",
  "merchant",
  "agent",
  "unknown",
]);
export const TXN_TYPES = Object.freeze([
  "transfer",
  "payment",
  "cash_in",
  "cash_out",
  "settlement",
  "refund",
]);
export const TXN_STATUSES = Object.freeze([
  "completed",
  "failed",
  "pending",
  "reversed",
]);

// Default department per case_type (problem §7.2). Final routing may be
// overridden by the classifier based on evidence.
export const DEFAULT_DEPARTMENT = Object.freeze({
  wrong_transfer: "dispute_resolution",
  payment_failed: "payments_ops",
  refund_request: "dispute_resolution",
  duplicate_payment: "payments_ops",
  merchant_settlement_delay: "merchant_operations",
  agent_cash_in_issue: "agent_operations",
  phishing_or_social_engineering: "fraud_risk",
  other: "customer_support",
});

// Default severity floor per case_type. Classifier raises severity based
// on amount, channel, evidence verdict, etc.
export const DEFAULT_SEVERITY = Object.freeze({
  wrong_transfer: "high",
  payment_failed: "medium",
  refund_request: "medium",
  duplicate_payment: "high",
  merchant_settlement_delay: "high",
  agent_cash_in_issue: "high",
  phishing_or_social_engineering: "critical",
  other: "low",
});

export function isCaseType(v) {
  return CASE_TYPES.includes(v);
}
export function isDepartment(v) {
  return DEPARTMENTS.includes(v);
}
export function isSeverity(v) {
  return SEVERITIES.includes(v);
}
export function isEvidence(v) {
  return EVIDENCE_VERDICTS.includes(v);
}
