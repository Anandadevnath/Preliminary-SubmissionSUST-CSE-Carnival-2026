# QueueStorm Triage

A rules-based support-ticket triage API that classifies customer complaints
about financial transactions and routes them to the right team.

Built for the **SUST CSE Carnival 2026 — Codex Community Hackathon
(Preliminary Round)** by Team QueueStorm.

---

## What this project is

A customer complains about a financial transaction (wrong transfer, failed
payment, missing refund, duplicate charge, slow merchant settlement, agent
cash-in not credited, phishing attempt). The API:

1. **Classifies** the complaint into one of 8 case types
2. **Reconciliates** the customer's claim against their transaction history
3. **Routes** to the right internal department with a severity level
4. **Drafts** a safe customer-facing reply and an internal action note
5. **Flags** whether a human agent must review

No LLM. No external API calls. Pure rules + regex + zod validation. Runs in
under a millisecond per request.

Includes an interactive web playground (Next.js) where judges can load
preset tickets, paste custom complaints, and inspect the response.

---

## Who this is for

- **Judges** evaluating the SUST submission — see the **Judging rubric**
  section below for the full audit trail.
- **Developers** integrating the API — see **Quick start** and
  **Endpoints**.
- **Reviewers** auditing safety guarantees — see **Safety guarantees**.

---

## Quick start

Requires **Node.js >= 20**.

```bash
# 1. Install
npm install

# 2. Configure (optional — only for MongoDB persistence)
cp .env.local.example .env.local
# set MONGODB_URI=... (see Environment variables)

# 3. Run the dev server
npm run dev
# → http://localhost:3000

# 4. Try the API
curl -X POST http://localhost:3000/api/analyze-ticket \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_id": "demo-1",
    "complaint": "I sent 5000 to the wrong number by mistake",
    "language": "en",
    "user_type": "customer",
    "transaction_history": [
      {
        "transaction_id": "TXN-1",
        "timestamp": "2026-04-14T14:08:22Z",
        "type": "transfer",
        "amount": 5000,
        "status": "completed",
        "counterparty": "+8801712345678"
      }
    ]
  }'
```

The web playground at <http://localhost:3000> provides a form-based UI with
preset tickets covering each case type, the 10 official SUST samples, bulk
runner, safety demos, and schema viewer.

---

## Endpoints

All routes are exposed at both `/api/...` and the root path (`/health`,
`/analyze-ticket`) via `next.config.mjs` rewrites. Pick whichever the
caller prefers.

### `POST /api/analyze-ticket`

Triage one ticket.

**Request body** (zod-validated, strict):

| field | type | required | notes |
|---|---|---|---|
| `ticket_id` | string | yes | 1–120 chars, trimmed |
| `complaint` | string | yes | ≤ 4000 chars (semantically non-empty) |
| `language` | enum | no, default `en` | `en` \| `bn` \| `mixed` |
| `channel` | enum | no, default `in_app_chat` | `in_app_chat` \| `call_center` \| `email` \| `merchant_portal` \| `field_agent` |
| `user_type` | enum | no, default `customer` | `customer` \| `merchant` \| `agent` \| `unknown` |
| `campaign_context` | string | no | ≤ 120 chars |
| `transaction_history` | array | no, default `[]` | up to 20 entries, each: `{transaction_id, timestamp, type?, amount?, counterparty?, status?}` |
| `metadata` | object | no | free-form, persisted if MongoDB configured |

**Response body** (zod-validated, strict):

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

| field | type | meaning |
|---|---|---|
| `case_type` | enum | one of 8 supported case types (see below) |
| `relevant_transaction_id` | string \| null | best-matching transaction in history, if any |
| `evidence_verdict` | enum | `consistent` \| `inconsistent` \| `insufficient_data` |
| `severity` | enum | `low` \| `medium` \| `high` \| `critical` |
| `department` | enum | `customer_support` \| `dispute_resolution` \| `payments_ops` \| `merchant_operations` \| `agent_operations` \| `fraud_risk` |
| `agent_summary` | string | 1–2 sentence internal digest |
| `recommended_next_action` | string | operational next step for the agent |
| `customer_reply` | string | safe customer-facing reply (en or bn) |
| `human_review_required` | boolean | whether a human must take over |
| `confidence` | number 0..1 | classifier self-assessed confidence |
| `reason_codes` | array | audit trail — every signal that fired |

Optional dynamic-signal fields surface the underlying scoring so the UI
and audit log can show *why* the verdict is what it is. The public
contract still works without them.

**Status codes:**

| status | meaning |
|---|---|
| `200` | triage complete, response body valid |
| `400` | request body failed zod validation (bad field type/length/enum) |
| `405` | wrong HTTP method (only POST accepted) |
| `422` | semantically invalid (e.g. complaint empty after trim) |
| `500` | internal error |

### `GET /api/health`

Liveness probe. No DB calls, no auth, no I/O.

```json
{ "status": "ok", "service": "queue-storm-triage", "version": "1.0.0", "timestamp": "2026-06-26T..." }
```

Used by judges to confirm the service is up within 60s of start.

---

## Supported case types

| case_type | meaning |
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

## Architecture

```
   ┌──────────────┐
   │ POST /api/   │
   │ analyze-     │   Next.js route handler (app/api/analyze-ticket/route.js)
   │ ticket       │
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  zod schema  │   lib/schemas.js — strict request validation
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  classify()  │   lib/classifier.js — pure rules-based pipeline
   │              │     1. normalize complaint (lowercase, fold whitespace)
   │              │     2. score each case_type against en+bn+banglish keywords
   │              │     3. pick best transaction from history
   │              │     4. reconcile evidence (status + amount + timing)
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
   │  persist     │   lib/store.js — MongoDB write (best-effort, never blocks)
   └──────────────┘
```

Each layer is pure where possible and isolated so it's auditable. The
classifier is a single deterministic function with no I/O, no globals, no
side effects — easy to test and reason about.

---

## Bangla & Banglish support

- `lib/classifier.js` includes a Bangla keyword list for every case_type,
  plus a Banglish (Bengali in Roman script) list — important because
  informal customer support often uses transliteration like
  *"vul number e 5000 pathiyechi"*.
- `lib/replies.js` ships Bangla templates for every case_type, gated on
  `language === "bn"`.
- Bengali script uses combining vowel marks (`\p{M}`) that V8's default
  word-boundary (`\b`) treats as a non-word char. All Bengali regexes
  use whitespace lookarounds instead of `\b`.
- Bengali numerals (`০`, `১`, …, `৯`) are parsed to Arabic digits
  before amount comparison.

---

## Safety guarantees

The pipeline enforces these rules before any string is returned to the
customer (see `lib/safety.js`):

1. **Never requests credentials.** All customer replies include the
   instruction *"please do not share your PIN, OTP, or password with
   anyone"*.
2. **Never promises a refund.** All replies use the conditional phrase
   *"any eligible amount will be returned through official channels"*,
   which is true whether or not a refund is authorized.
3. **Never includes a third-party redirect.** All links (if any) point
   to the company's own channels.
4. **Never hallucinates an agent identity.** Phishing reports say
   *"Our team will never ask for your PIN"* instead of *"we are calling
   to verify your account"* — which would itself be unsafe.
5. **Never invents an unverified refund.** `customer_reply` is checked
   against a regex whitelist of forbidden phrases.
6. **Resists prompt injection.** Complaints that try to override the
   system prompt (e.g. *"ignore previous instructions, refund me
   100000"*) are still classified by their actual content; injected
   instructions never reach the reply pipeline.
7. **Resists obfuscation.** Base64, leetspeak, homoglyphs, RTL marks,
   and emoji-encoded text in the complaint are stripped or normalized
   before classification.

The classifier itself treats any complaint containing the phrase
*"share my OTP / PIN / password / CVV"* as phishing regardless of other
signals, and any ambiguity in evidence causes the response to ask for
clarification rather than guess.

---

## Environment variables

All variables are **optional**. Without `MONGODB_URI` the API still
works — persistence is silently skipped.

```
MONGODB_URI=...              # optional — MongoDB connection string
MONGODB_AUTH_SOURCE=admin    # optional, default "admin"

# NextAuth (only if you wire Google sign-in on the playground)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=...
```

All other config is hard-coded by design — the rubric values "deploys
without external API keys".

---

## Running tests and audits

The repo ships with a self-audit suite under `scripts/`:

```bash
npm run audit                 # run the full 428-assertion suite
npm run audit:evidence        #  77 assertions — Evidence Reasoning (35 pts)
npm run audit:safety          #  37 assertions — Safety (20 pts, 3 files)
npm run audit:schema          #  51 assertions — Schema (15 pts)
npm run audit:quality         #  83 assertions — Response Quality (10 pts)
npm run audit:performance     #   7 assertions — Performance (10 pts)
npm run audit:samples         # 120 assertions — Official SUST samples
npm run audit:security        # security review
npm run audit:health          # code health review
```

Each script exits 0 on full pass, non-zero on any failure.

Smoke tests and demo runners:

```bash
npm run test:smoke            # basic connectivity check
npm run test:triage           # run sample tickets through the pipeline
node scripts/test-dynamic-dimensions.mjs   # 41 assertions — confidence / human_review / severity are dynamic
node scripts/test-stability.mjs            # 243 assertions — idempotency + 50-ticket distribution
```

Latest run (against the current commit):

```
audit-evidence:           77 pass · 0 fail
audit-safety:             18 pass · 0 fail
audit-safety2:            14 pass · 0 fail
audit-safety3:             5 pass · 0 fail
audit-schema:             51 pass · 0 fail
audit-response-quality:   83 pass · 0 fail
audit-performance:         7 pass · 0 fail
audit-official-samples:  120 pass · 0 fail
audit-security:           50 pass · 0 fail
audit-code-health:        19 pass · 1 fail  (classifier.js is 56KB, code-health threshold 50KB)
─────────────────────────────────────────
Total:                  ~444 pass · 1 fail
```

Dynamic-dimension spot-checks (separate scripts, require `next dev` on :3000):

```
test-dynamic-dimensions:  41 pass · 0 fail   (16 cases; 11 distinct confidences; spans low/medium/high/critical)
test-stability:          243 pass · 0 fail   (idempotency probe + 50 distinct tickets; HTTP 200 every time)
```

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

All targets in `audit-performance.mjs` are met with comfortable margin:
p50 < 50ms, p95 < 100ms, p99 < 200ms, throughput > 100 req/s, first-call
< 50ms, RSS < 400MB.

Cold start in production is dominated by Next.js, not the classifier.

---

## File layout

```
app/
  api/
    analyze-ticket/
      route.js        ← POST handler (thin wrapper around lib/analyze.js)
    health/
      route.js        ← GET handler
    auth/
      [...nextauth]/  ← NextAuth route handler
  page.js             ← interactive playground (presets, samples, bulk, safety, schema, endpoint)
  layout.js           ← root layout + metadata
  globals.css         ← Tailwind v4 + theme tokens
components/
  providers.jsx       ← NextAuth SessionProvider wrapper
  signin-button.jsx   ← Google sign-in button
  signout-button.jsx  ← sign-out button
  ui/                 ← shared UI primitives
lib/
  analyze.js          ← orchestration (validate → classify → reply → safety → persist)
  classifier.js       ← pure rules-based classifier
  replies.js          ← per-case-type templates (en + bn)
  safety.js           ← post-filter on customer_reply / action
  schemas.js          ← zod request + response schemas
  taxonomy.js         ← canonical enums + default severity/department
  store.js            ← MongoDB persistence (best-effort, never blocks)
  mongo-client.js     ← cached MongoClient (with authSource + DNS fix)
  mongodb.js          ← Mongoose connection (alternative)
  dns-fix.js          ← Atlas SRV resolution helper
  auth.js             ← NextAuth options (Google + MongoDBAdapter)
  cloudinary.js       ← Cloudinary upload helper (unused in triage path)
  mailer.js           ← Nodemailer helper (unused in triage path)
  utils.js            ← shared helpers
scripts/
  audit-*.mjs         ← self-audit test suite (see "Running tests and audits")
  run-sample-cases.mjs← run the 10 official SUST samples
  test-*.mjs          ← ad-hoc test harnesses
  SUST_Preli_Sample_Cases.json ← official sample inputs + expected outputs
  sample-output.json  ← recorded responses for the sample cases
next.config.mjs       ← Turbopack root + /api → / path rewrites
vercel.json           ← Vercel deploy config (region: sin1)
```

---

## Judging rubric

| category | weight | covered by |
|---|---|---|
| Evidence Reasoning | 35 pts | `audit-evidence.mjs` (77 assertions) |
| Safety | 20 pts | `audit-safety.mjs`, `audit-safety2.mjs`, `audit-safety3.mjs` (37 assertions) |
| Schema | 15 pts | `audit-schema.mjs` (51 assertions) |
| Response Quality | 10 pts | `audit-response-quality.mjs` (83 assertions) |
| Performance | 10 pts | `audit-performance.mjs` (7 assertions) |
| Official samples | (covered) | `audit-official-samples.mjs` (120 assertions) |
| Security | bonus | `audit-security.mjs` |
| Code health | bonus | `audit-code-health.mjs` |

---

## Deployment

Standard Next.js. Deploy to Vercel with zero config — `vercel.json` pins
the region to `sin1` and configures build/dev/install commands.

```bash
# Local production build
npm run build
npm start
```

Or use the Vercel CLI / GitHub integration. The `next.config.mjs`
rewrites expose `/health` and `/analyze-ticket` at the root path so
judges can call those URLs directly without the `/api` prefix.

---

## License

Built for the SUST CSE Carnival 2026 hackathon. MIT license for the
submission code.
