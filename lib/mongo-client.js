import { MongoClient } from "mongodb";
import { getResolvedMongoUri } from "@/lib/dns-fix";

/**
 * Returns a cached MongoClient. The NextAuth MongoDBAdapter wants a raw
 * `MongoClient` (not Mongoose), so we keep this parallel connection layer.
 *
 * On Windows the default DNS resolver can refuse SRV lookups for Atlas
 * clusters. We pre-resolve via @/lib/dns-fix to work around that.
 *
 * Atlas users are normally created in the `admin` database, but the
 * connection string defaults `authSource` to the database named in the
 * URI path. We force `authSource=admin` so sign-in works regardless of
 * which database the URI targets.
 */
const MONGODB_URI = process.env.MONGODB_URI;
const AUTH_SOURCE = process.env.MONGODB_AUTH_SOURCE || "admin";

let cachedClient = globalThis._mongoClient;

function withAuthSource(uri) {
  if (!uri) return uri;
  if (!uri.startsWith("mongodb://")) return uri; // srv: handled via options
  if (/([?&])authSource=/.test(uri)) return uri;
  return uri + (uri.includes("?") ? "&" : "?") + `authSource=${AUTH_SOURCE}`;
}

async function buildClient() {
  const uri = withAuthSource((await getResolvedMongoUri()) || MONGODB_URI);
  return new MongoClient(uri, {
    serverSelectionTimeoutMS: 15000,
    authSource: AUTH_SOURCE,
  });
}

if (!cachedClient && MONGODB_URI) {
  // Eagerly build so the adapter sees a real client by first call.
  cachedClient = globalThis._mongoClient = { _pending: buildClient() };
}

export async function getMongoClient() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not configured.");
  }
  if (cachedClient && cachedClient._pending) {
    const client = await cachedClient._pending;
    cachedClient = globalThis._mongoClient = client;
  }
  return cachedClient;
}

export async function getDB() {
  const client = await getMongoClient();
  await client.connect();
  const effectiveUri = client.options?.url || MONGODB_URI;
  const dbName = new URL(effectiveUri.replace("mongodb://", "http://")).pathname
    .replace(/^\//, "")
    .split("?")[0] || "hackathon";
  return client.db(dbName);
}