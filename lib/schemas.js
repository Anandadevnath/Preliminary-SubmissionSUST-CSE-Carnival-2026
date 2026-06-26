import { z } from "zod";
import {
  CASE_TYPES,
  CHANNELS,
  DEPARTMENTS,
  EVIDENCE_VERDICTS,
  LANGUAGES,
  SEVERITIES,
  TXN_STATUSES,
  TXN_TYPES,
  USER_TYPES,
} from "./taxonomy.js";

/**
 * Request body for POST /api/analyze-ticket (problem §5).
 *
 * Required: ticket_id, complaint.
 * Everything else has sane defaults so a malformed harness payload still
 * produces a structured 400/422 instead of a 500.
 */
export const AnalyzeRequest = z.object({
  ticket_id: z.string().trim().min(1).max(120),
  // complaint: shape only at the schema layer. The "must not be empty"
  // semantic check lives in analyze.js so it returns 422 (semantic error)
  // rather than 400 (schema error).
  complaint: z.string().max(4000),
  language: z.enum(LANGUAGES).optional().default("en"),
  channel: z.enum(CHANNELS).optional().default("in_app_chat"),
  user_type: z.enum(USER_TYPES).optional().default("customer"),
  campaign_context: z.string().max(120).optional(),
  transaction_history: z
    .array(
      z.object({
        transaction_id: z.string().min(1).max(120),
        timestamp: z.string().min(1).max(40),
        type: z.enum(TXN_TYPES).optional(),
        amount: z.number().nonnegative().optional(),
        counterparty: z.string().max(120).optional(),
        status: z.enum(TXN_STATUSES).optional(),
      })
    )
    .max(20)
    .optional()
    .default([]),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Response body shape (problem §6). We use z.enum to enforce exact strings
 * so a typo in a template can never reach the wire.
 */
export const AnalyzeResponse = z.object({
  ticket_id: z.string(),
  relevant_transaction_id: z.string().nullable(),
  evidence_verdict: z.enum(EVIDENCE_VERDICTS),
  case_type: z.enum(CASE_TYPES),
  severity: z.enum(SEVERITIES),
  department: z.enum(DEPARTMENTS),
  agent_summary: z.string().min(1).max(800),
  recommended_next_action: z.string().min(1).max(400),
  customer_reply: z.string().min(1).max(800),
  human_review_required: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  reason_codes: z.array(z.string().min(1).max(60)).max(20).optional(),
});