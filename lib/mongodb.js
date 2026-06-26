import mongoose from "mongoose";
import { getResolvedMongoUri } from "@/lib/dns-fix";

/**
 * Cached Mongoose connection. Next.js dev mode hot-reloads modules,
 * which would otherwise create a new connection on every reload and
 * exhaust MongoDB's connection pool. We cache the connection on the
 * global object so it survives HMR.
 */
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.warn(
    "[mongodb] MONGODB_URI is not set — DB-backed features will not work."
  );
}

/** @type {{ conn: typeof mongoose | null, promise: Promise<typeof mongoose> | null }} */
let cached = globalThis._mongoose;

if (!cached) {
  cached = globalThis._mongoose = { conn: null, promise: null };
}

/**
 * Ensure the connection URI has an `authSource` query param. MongoDB defaults
 * to authenticating against the database named in the URI path — but Atlas
 * users are normally created in the `admin` database, which fails with
 * `bad auth : Authentication failed` (code 8000) when omitted.
 *
 * If the URI already specifies `authSource=...` we leave it alone.
 */
function ensureAuthSource(uri) {
  if (!uri) return uri;
  // For mongodb:// (post-SRV-resolution), we can safely append the query.
  if (uri.startsWith("mongodb://")) {
    if (/([?&])authSource=/.test(uri)) return uri;
    return uri + (uri.includes("?") ? "&" : "?") + "authSource=admin";
  }
  // For mongodb+srv://, let the driver resolve it; we'll pass authSource via
  // mongoose options instead.
  return uri;
}

export async function connectDB() {
  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is not configured. Add it to .env.local before calling connectDB()."
    );
  }
  if (cached.conn) return cached.conn;

  // Pre-resolve the SRV URI via our custom Resolver (works around Windows
  // DoH-stub ECONNREFUSED on `dns.resolveSrv`).
  const resolvedUri = ensureAuthSource(
    (await getResolvedMongoUri()) || MONGODB_URI
  );

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(resolvedUri, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 15000,
        authSource: "admin",
      })
      .then((m) => m);
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }
  return cached.conn;
}