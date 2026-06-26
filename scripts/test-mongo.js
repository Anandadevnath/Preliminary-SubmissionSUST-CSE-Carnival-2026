import { config } from "dotenv";
config({ path: ".env.local" });
import dns from "node:dns";
import { setTimeout as wait } from "node:timers/promises";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is missing from .env.local");
  process.exit(1);
}

// Pre-flight: probe Node's default resolver. If it refuses the SRV query
// (typical on Windows when a DoH stub is bound to 127.0.0.1), swap in a
// public resolver so Mongoose's driver can find the cluster.
await new Promise((resolve) => {
  dns.resolveSrv(
    "_mongodb._tcp.raccoon.u3e2oc4.mongodb.net",
    (err) => {
      if (err) {
        dns.setServers(["1.1.1.1", "8.8.8.8"]);
        console.warn("[test-mongo] switched to public DNS:", err.code);
      } else {
        console.log("[test-mongo] local DNS OK, using it");
      }
      resolve();
    }
  );
});

// Give the DNS server list a tick to propagate inside libuv.
await wait(50);

console.log("Connecting to MongoDB...");
const t = setTimeout(() => {
  console.error("TIMEOUT after 15s");
  process.exit(2);
}, 15000);

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  clearTimeout(t);
  console.log("OK — connected to", mongoose.connection.host);
  console.log("DB name:", mongoose.connection.name);
  const admin = mongoose.connection.db.admin();
  const ping = await admin.ping();
  console.log("Ping:", ping);
  // List collections.
  const cols = await mongoose.connection.db.listCollections().toArray();
  console.log("Collections (" + cols.length + "):", cols.map((c) => c.name).join(", "));
  await mongoose.disconnect();
  console.log("Disconnected cleanly.");
} catch (err) {
  clearTimeout(t);
  console.error("FAILED:", err.message);
  if (err.reason) console.error("Reason:", err.reason.message || err.reason);
  process.exit(3);
}