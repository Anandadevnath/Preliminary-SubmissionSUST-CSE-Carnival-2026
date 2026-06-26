// lib/store.js
// Persist every analyzed ticket to MongoDB. Used by the Next.js API route.
// Uses the raw MongoClient (lib/mongo-client.js) — not Mongoose — because we
// only ever write one document per request and don't need a schema layer.

import { getMongoClient } from "./mongo-client.js";

const COLLECTION = "triage_results";

let indexesEnsured = false;
async function ensureIndexes(db) {
  if (indexesEnsured) return;
  const col = db.collection(COLLECTION);
  await Promise.all([
    col.createIndex({ ticket_id: 1 }),
    col.createIndex({ ts: -1 }),
    col.createIndex({ case_type: 1 }),
  ]);
  indexesEnsured = true;
}

/**
 * Persist an analyzed ticket.
 *
 * @param {object} record
 * @param {string} record.ticket_id
 * @param {object} record.request   - the validated request body
 * @param {object} record.response   - the response object we returned
 * @param {number} record.latency_ms - request latency in ms
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export async function saveAnalysis({ ticket_id, request, response, latency_ms }) {
  // Strip metadata blob to avoid bloat; keep payload small.
  const doc = {
    ticket_id,
    request: {
      complaint: request.complaint,
      language: request.language,
      channel: request.channel,
      user_type: request.user_type,
      campaign_context: request.campaign_context,
      transaction_history: request.transaction_history,
    },
    response,
    latency_ms: Math.round(latency_ms),
    ts: new Date(),
  };

  let client;
  try {
    client = await getMongoClient();
    const db = client.db();
    await ensureIndexes(db);
    const result = await db.collection(COLLECTION).insertOne(doc);
    return { ok: true, id: result.insertedId.toString() };
  } catch (err) {
    // Persistence is best-effort — never let a DB write fail the response.
    // The caller logs and continues.
    console.error("[store] saveAnalysis failed:", err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Look up a previously-saved analysis by ticket_id (most recent first).
 * Useful for debugging and the sample-output script.
 */
export async function findAnalyses(ticketId, { limit = 5 } = {}) {
  let client;
  try {
    client = await getMongoClient();
    const db = client.db();
    await ensureIndexes(db);
    return await db
      .collection(COLLECTION)
      .find({ ticket_id: ticketId })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
  } catch (err) {
    console.error("[store] findAnalyses failed:", err?.message || err);
    return [];
  }
}

/**
 * Aggregate counts per case_type — for the /metrics endpoint (future).
 */
export async function caseTypeCounts(sinceMs = 24 * 3600 * 1000) {
  let client;
  try {
    client = await getMongoClient();
    const db = client.db();
    const since = new Date(Date.now() - sinceMs);
    return await db
      .collection(COLLECTION)
      .aggregate([
        { $match: { ts: { $gte: since } } },
        { $group: { _id: "$response.case_type", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();
  } catch (err) {
    console.error("[store] caseTypeCounts failed:", err?.message || err);
    return [];
  }
}