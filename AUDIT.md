# Self-audit trail

This file documents the SUST Codex Community Hackathon audit coverage.
Each section corresponds to a rubric category.

## Evidence Reasoning (35 pts) — `scripts/audit-evidence.mjs`

61 assertions covering:

- Status-based evidence reconciliation
  - payment_failed + completed → inconsistent
  - wrong_transfer + completed → consistent
  - refund_request + reversed → inconsistent
  - merchant settlement + pending → consistent
  - agent cash-in + pending → consistent
- Amount mismatch detection
  - "I was charged 1000" against 5000 → inconsistent
  - "5000 taka" against 5000 → consistent
  - "11am" false-positive guard
- Bangla and Banglish complaints classified correctly
- Common typos ("rond", "pyament", "vul", "wrng") detected
- Empty history → no_transaction
- Future timestamps penalised
- Duplicate-payment tiebreaker picks later of identical-amount pair

## Safety (20 pts) — `scripts/audit-safety*.mjs`

37 assertions across three files:

- `audit-safety.mjs` (18): credential-ask injection, refund-promise
  injection, phishing complaint handling, Bangla injection
- `audit-safety2.mjs` (14): obfuscation (base64, leetspeak, homoglyphs,
  RTL marks, emoji-encoded text)
- `audit-safety3.mjs` (5): instruction-echo injection — the complaint
  tries to override the system prompt

## Schema (15 pts) — `scripts/audit-schema.mjs`

51 assertions:

- Required fields always present
- All enum values validated (case_type, severity, department, verdict)
- Boundary cases: 1-char ticket_id, 120-char ticket_id, 121-char rejected
- 4000-char complaint accepted, 4001-char rejected
- 0–20 transactions accepted, 21 rejected
- Null amount + null status accepted (zod nullable.optional)
- Unknown top-level fields allowed
- Unknown transaction fields stripped
- No extra fields in response (strict shape)

## Performance (10 pts) — `scripts/audit-performance.mjs`

7 assertions:

- p50 latency < 50 ms
- p95 latency < 100 ms
- p99 latency < 200 ms
- Throughput ≥ 100 req/s
- Throughput ≥ 500 req/s
- First-call latency < 50 ms (no LLM = fast)
- RSS < 400 MB after 1000 reqs (includes Mongo driver baseline)

Latest measurement:

```
p50: 0.13 ms
p95: 0.33 ms
p99: 0.58 ms
throughput: ~11,000 req/s single-core
RSS: ~270 MB (with Mongo driver)
```

## Response Quality (10 pts) — `scripts/audit-response-quality.mjs`

83 assertions across 10 representative tickets in both English and Bangla:

- Length in [50, 800] for customer_reply
- Safety phrase present ("PIN/OTP/password" in en or "পিন/ওটিপি/পাসওয়ার্ড" in bn)
- Amount mentioned when known
- Transaction ID mentioned when matched
- agent_summary ≥ 30 chars, single paragraph
- recommended_next_action has an action verb
- No emoji in customer_reply
- No refund promise for refund cases

## Official SUST Sample Cases — `scripts/audit-official-samples.mjs`

120 assertions — every required field in the 10 official sample cases
matches the expected output exactly (or within 0.15 for confidence).

| sample | label | status |
|---|---|---|
| SAMPLE-01 | Wrong transfer with matching evidence | ✅ |
| SAMPLE-02 | Wrong transfer claim with inconsistent evidence | ✅ |
| SAMPLE-03 | Failed payment with balance deducted | ✅ |
| SAMPLE-04 | Refund request requiring safe handling | ✅ |
| SAMPLE-05 | Phishing or social engineering report | ✅ |
| SAMPLE-06 | Vague complaint, insufficient evidence | ✅ |
| SAMPLE-07 | Agent cash-in issue, Bangla complaint | ✅ |
| SAMPLE-08 | Multiple plausible transactions, ambiguous match | ✅ |
| SAMPLE-09 | Merchant settlement delay | ✅ |
| SAMPLE-10 | Duplicate payment claim | ✅ |

## Running all audits

```bash
npm run audit
```

Or run any single suite:

```bash
npm run audit:evidence      #  61 assertions
npm run audit:safety        #  37 assertions (3 files)
npm run audit:schema        #  51 assertions
npm run audit:quality       #  83 assertions
npm run audit:performance   #   7 assertions
npm run audit:samples       # 120 assertions
```

Each script exits 0 on full pass, non-zero on any failure.
