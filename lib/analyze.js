// lib/analyze.js
// Pure orchestration: classify + reply + safety + schema-validate.
// Called by both the Next.js route (app/api/analyze-ticket/route.js) and
// the local test harness (scripts/test-api-route.mjs).

import { classify } from "./classifier.js";
import { buildReplies } from "./replies.js";
import { safeCustomerReply, safeRecommendedAction } from "./safety.js";
import { AnalyzeRequest, AnalyzeResponse } from "./schemas.js";
import { saveAnalysis } from "./store.js";

/**
 * Run the full analyze-ticket pipeline on a parsed object. Returns:
 *   { ok: true, status: 200, body: {...} }
 *   { ok: false, status: 400|422|500, body: { error, field? } }
 *
 * Never throws. All errors are caught and translated to a status + body.
 *
 * @param {object} rawBody - the request body (already parsed JSON)
 * @returns {Promise<{ ok: boolean, status: number, body: object }>}
 */
export async function analyzeTicket(rawBody) {
  const t0 = performance.now();

  // 1. Validate against request schema.
  const parsed = AnalyzeRequest.safeParse(rawBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path?.[0] ?? null;
    return {
      ok: false,
      status: 400,
      body: {
        error: field
          ? `Invalid input: ${field} ${issue?.message ?? "is invalid"}.`
          : (issue?.message ?? "Invalid input."),
        field,
      },
    };
  }
  const input = parsed.data;

  // 2. Semantic check — empty complaint after trim.
  if (!input.complaint.trim()) {
    return {
      ok: false,
      status: 422,
      body: { error: "complaint must not be empty." },
    };
  }

  try {
    // 3. Classify.
    const c = classify({
      complaint: input.complaint,
      user_type: input.user_type,
      transaction_history: input.transaction_history,
    });

    // 4. Find matched transaction (for reply formatting).
    const txn =
      (input.transaction_history || []).find(
        (t) => t.transaction_id === c.relevant_transaction_id
      ) || null;

    // 5. Build replies.
    const replies = buildReplies({
      caseType: c.case_type,
      severity: c.severity,
      verdict: c.evidence_verdict,
      txn,
      language: input.language,
      complaint: input.complaint,
      userType: input.user_type,
      claimedAmount: c.claimed_amount,
      txnAmount: c.txn_amount,
      amountMismatch: c.amount_mismatch,
    });

    // 6. Final safety sweep (belt + braces; templates already pass through).
    const customer_reply = safeCustomerReply(replies.customer_reply, {
      language: input.language,
    });
    const recommended_next_action = safeRecommendedAction(
      replies.recommended_next_action,
      { language: input.language }
    );
    const agent_summary = replies.agent_summary;

    // 7. Assemble.
    const response = {
      ticket_id: input.ticket_id,
      relevant_transaction_id: c.relevant_transaction_id,
      evidence_verdict: c.evidence_verdict,
      case_type: c.case_type,
      severity: c.severity,
      department: c.department,
      agent_summary,
      recommended_next_action,
      customer_reply,
      human_review_required: c.human_review_required,
      confidence: c.confidence,
      reason_codes: c.reason_codes,
      // Optional, dynamic signals — surface the underlying evidence so the
      // UI / audit log can show *why* the score is what it is. The public
      // contract still works without these.
      human_review_score: c.human_review_score,
      human_review_reasons: c.human_review_reasons,
      signal_breakdown: c.signal_breakdown,
      match_quality: c.match_quality,
    };

    // 8. Validate against the strict response schema.
    const resp = AnalyzeResponse.safeParse(response);
    if (!resp.success) {
      console.error(
        "[analyze] response schema violation:",
        resp.error.issues
      );
      return {
        ok: false,
        status: 500,
        body: { error: "Internal: response failed schema validation." },
      };
    }

    // 9. Persist (best-effort; never throw).
    const latency = performance.now() - t0;
    saveAnalysis({
      ticket_id: input.ticket_id,
      request: input,
      response: resp.data,
      latency_ms: latency,
    }).catch((e) =>
      console.error("[analyze] persistence failed:", e?.message || e)
    );

    return { ok: true, status: 200, body: resp.data };
  } catch (err) {
    console.error("[analyze] handler failed:", err);
    return {
      ok: false,
      status: 500,
      body: { error: "Internal error." },
    };
  }
}