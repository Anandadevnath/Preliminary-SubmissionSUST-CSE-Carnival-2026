# QueueStorm Triage

A rules-based support-ticket triage API for financial-services support
queues. QueueStorm Triage takes a customer complaint plus the customer's
recent transaction history and produces a structured routing decision:
which case type it falls into, how severe it is, which team should
handle it, what to do next, and a safe customer-facing reply.

The system is designed for **Saturday-afternoon surge traffic** — the
kind of inbound spike that happens after a marketing campaign or a
service incident, when human triage cannot keep up with queue depth.
By giving every ticket a structured verdict the moment it lands,
QueueStorm Triage lets the human team work the queue in priority order
instead of reading every message from scratch.

---

## Why rules-based?

The whole pipeline is keyword + heuristic matching plus a deterministic
evidence reconciler. There is no LLM call, no embedding lookup, no
external API in the request path. That choice is deliberate:

| concern | LLM-based | rules-based |
|---|---|---|
| p99 latency | 500–3000 ms | **0.6 ms** |
| throughput (single core) | 5–50 req/s | **~11 000 req/s** |
| cost at 1 M req/day | $50–500 | **$0** |
| offline / air-gapped | needs API key | **runs anywhere** |
| deterministic output | probabilistic | **byte-for-byte reproducible** |
| safety surface | prompt injection, jailbreaks | **regex-guarded, well-audited** |
| Bangla support | model-dependent | **explicit keyword lists + transliteration** |

For high-volume, safety-critical, customer-facing routing in a domain
where the answer space is finite (8 case types), rules win on every
operational dimension.

---

## What it does

POST a customer complaint + transaction history to `/api/analyze-ticket`,
and the service returns a structured triage verdict:

```json
{
  "ticket_id": "TKT-001",
  "case_type": "wrong_transfer",
  "relevant_transaction_id": "TXN-9202",
  "evidence_verdict": "inconsistent",
  "severity": "medium",
  "department": "dispute_resolution",
  "agent_summary": "Customer reports...",
  "recommended_next_action": "Verify...",
  "customer_reply": "We have received...",
  "human_review_required": true,
  "confidence": 0.75,
  "reason_codes": ["case:wrong_transfer", "transaction_match", "verdict:inconsistent", "severity:medium", "human_review"]
}
```

Case types recognized:

| case_type | What it means |
|---|---|
| `wrong_transfer` | Sent money to a wrong recipient |
| `payment_failed` | Failed transaction but money was deducted |
| `refund_request` | Asking for money back |
| `duplicate_payment` | Charged twice for the same thing |
| `merchant_settlement_delay` | Merchant hasn't received settlement |
| `agent_cash_in_issue` | Cash-in via agent didn't reflect |
| `phishing_or_social_engineering` | Someone asking for credentials |
| `other` | Doesn't fit any of the above |

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure (optional — analyze works without it)
cp .env.local.example .env.local
# fill in MONGODB_URI if you want every analyzed ticket persisted

# 3. Run
npm run dev

# 4. Try it
curl -X POST http://localhost:3000/api/analyze-ticket \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_id": "demo-1",
    "complaint": "I sent 5000 to the wrong number by mistake",
    "language": "en",
    "user_type": "customer",
    "transaction_history": [
      {"transaction_id":"TXN-1","timestamp":"2026-04-14T14:08:22Z","type":"transfer","amount":5000,"status":"completed","counterparty":"+8801712345678"}
    ]
  }'
```

The response is fully validated against the strict response schema
defined in `lib/schemas.js`. Open `http://localhost:3000/` for an
interactive demo with preset tickets, the 10 official sample cases,
bulk runner, safety demos, and a schema viewer.

---

## Architecture

```
   ┌──────────────┐
   │ POST /api/   │
   │ analyze-     │   Next.js route handler (app/api/analyze-ticket/route.js)
   │ ticket       │
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  zod schema  │   lib/schemas.js — request validation
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  classify()  │   lib/classifier.js — pure rules-based pipeline
   │              │     1. normalize complaint
   │              │     2. score case_type (en + bn + banglish keywords)
   │              │     3. pick best transaction from history
   │              │     4. reconcile evidence
   │              │     5. compute severity / department / review flag
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │ buildReplies │   lib/replies.js — templated per-case-type replies
   └──────┬───────┘   (English + Bangla)
          ▼
   ┌──────────────┐
   │ safety sweep │   lib/safety.js — credential-ask, refund-promise,
   │              │   third-party-redirect post-filter
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │ zod response │   re-validate before sending
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  persist     │   lib/store.js — MongoDB write (best-effort)
   └──────────────┘
```

No LLM, no external API calls, no model downloads. The whole pipeline
runs in **<1ms p99** on a warm Node process.

---

## Endpoint

### `POST /api/analyze-ticket`

**Request** (see `lib/schemas.js` for the strict zod schema):

```jsonc
{
  "ticket_id": "string, required, 1..120 chars",
  "complaint": "string, required, ≤ 4000 chars",
  "language": "en | bn | mixed  (default: en)",
  "channel": "in_app_chat | call_center | email | merchant_portal | field_agent",
  "user_type": "customer | merchant | agent | unknown",
  "campaign_context": "string, optional, ≤ 120 chars",
  "transaction_history": [
    {
      "transaction_id": "string",
      "timestamp": "ISO-8601",
      "type": "transfer | payment | cash_in | cash_out | settlement | refund",
      "amount": "number, positive",
      "counterparty": "string, optional",
      "status": "completed | failed | pending | reversed"
    }
    // up to 20 entries
  ]
}
```

**Response:**

```jsonc
{
  "ticket_id": "echoed back",
  "relevant_transaction_id": "string | null",
  "evidence_verdict": "consistent | inconsistent | insufficient_data",
  "case_type": "see taxonomy in lib/taxonomy.js",
  "severity": "low | medium | high | critical",
  "department": "customer_support | dispute_resolution | payments_ops | merchant_operations | agent_operations | fraud_risk",
  "agent_summary": "1-2 sentence internal digest",
  "recommended_next_action": "operational next step",
  "customer_reply": "safe customer-facing reply (English or Bangla)",
  "human_review_required": "boolean",
  "confidence": "number 0..1 (within 0.15 of expected)",
  "reason_codes": "array of strings, audit trail"
}
```

### `GET /api/health`

```json
{ "status": "ok", "service": "queue-storm-triage", "ts": "..." }
```

---

## Auditing

The repository ships with a self-audit test suite under `scripts/`.
Each script exits 0 on full pass and non-zero on any failure.

```bash
npm run audit                  # run everything (428 assertions)
npm run audit:evidence         #  61 — case_type + evidence reasoning
npm run audit:safety           #  37 — credential/refund/3rd-party guards
npm run audit:schema           #  51 — request/response shape & boundaries
npm run audit:quality          #  83 — tone, length, specificity
npm run audit:performance      #   7 — latency, throughput, memory
npm run audit:samples          # 120 — 10 official sample cases (full match)
npm run audit:security         #  50 — prompt injection, XSS, secret leak
npm run audit:health           #  19 — file structure, no TODOs, no leaks
```

Latest run:

```
audit-evidence:           61 pass · 0 fail
audit-safety:             18 pass · 0 fail
audit-safety2:            14 pass · 0 fail
audit-safety3:             5 pass · 0 fail
audit-schema:             51 pass · 0 fail
audit-response-quality:   83 pass · 0 fail
audit-performance:         7 pass · 0 fail
audit-official-samples:  120 pass · 0 fail
audit-security:           50 pass · 0 fail
audit-code-health:        19 pass · 0 fail
─────────────────────────────────────────
Total:                   428 pass · 0 fail
```

---

## Safety guarantees

The pipeline enforces the following safety rules before any string is
returned to the customer:

1. **Never requests credentials.** All customer replies include the
   phrase *"please do not share your PIN, OTP, or password with anyone"*.
2. **Never promises a refund.** All replies use the conditional phrase
   *"any eligible amount will be returned through official channels"*,
   which is true whether or not a refund is authorized.
3. **Never includes a third-party redirect.** All links (if any) point
   to the company's own channels.
4. **Never hallucinates an agent identity.** Phishing reports say
   *"Our team will never ask for your PIN"* instead of *"we are calling
   to verify your account"* — which would itself be unsafe.
5. **Never invents an unverified refund.** `customer_reply` is checked
   against a regex whitelist of forbidden phrases by `lib/safety.js`.

The classifier itself treats any complaint containing the phrase
*"share my OTP / PIN / password / CVV"* as phishing regardless of other
signals, and any ambiguity in evidence causes the response to ask for
clarification rather than guess.

The fallback strings used when a template trips a safety rule are
self-validated at module load — if a future edit introduces a forbidden
phrase, the process logs an error and replaces the fallback with an
ultra-safe version.

---

## Bangla / Banglish support

- `lib/classifier.js` includes a Bangla keyword list for every case_type,
  plus a Banglish (Bengali in Roman script) list — important because
  informal customer support often uses transliteration like
  *"vul number e 5000 pathiyechi"*.
- `lib/replies.js` ships Bangla templates for every case_type, gated on
  `language === "bn"`.
- The Bengali script uses vowel marks (`\p{M}`) that V8's default
  word-boundary (`\b`) treats as a non-word char. All Bengali regexes
  use whitespace lookarounds instead of `\b`. See `lib/classifier.js`
  for the canonical pattern.

---

## Performance

Benchmarked on the current commit (rules-based pipeline, no LLM):

| metric | value |
|---|---|
| p50 latency | 0.13 ms |
| p95 latency | 0.33 ms |
| p99 latency | 0.58 ms |
| throughput | ~11,000 req/s single-core |
| first-call (post fresh import) | 0.29 ms |
| RSS (with Mongo driver) | ~270 MB |

Cold start in production is dominated by Next.js, not the classifier.

---

## Interactive demo

`npm run dev` and open `http://localhost:3000/`. The demo page has
five tabs:

- **Playground** — interactive JSON editor with real-time validation,
  one-click presets, copy-as-cURL, latency sparkline.
- **Official samples** — all 10 sample cases with one-click "Run all 10".
- **Bulk runner** — fires all presets concurrently and shows throughput.
- **Safety demos** — 6 pre-built scenarios with live invariant checks
  ("does not request credentials", "does not promise refund", etc.).
- **Schema** — full request/response schema viewer.

---

## File layout

```
app/
  api/
    analyze-ticket/
      route.js        ← POST handler
    health/
      route.js        ← GET handler
  page.js             ← interactive demo page (5 tabs)
  layout.js
  globals.css
lib/
  analyze.js          ← orchestration (validate → classify → reply → safety)
  classifier.js       ← pure rules-based classifier
  replies.js          ← per-case-type templates (en + bn)
  safety.js           ← post-filter on customer_reply / action
  schemas.js          ← zod request + response schemas
  taxonomy.js         ← canonical enums
  store.js            ← MongoDB persistence (best-effort, optional)
  mongo-client.js     ← cached MongoClient
  dns-fix.js          ← Windows SRV-record workaround
scripts/
  audit-*.mjs         ← self-audit test suite (see "Auditing" above)
AUDIT.md              ← per-category audit trail
```

---

## Environment variables

```
MONGODB_URI=...              # optional — without it, analyze still works
MONGODB_AUTH_SOURCE=admin    # optional, default "admin"
```

All other config is hard-coded by design.

---

## License

MIT.
