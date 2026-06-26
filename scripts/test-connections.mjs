// scripts/test-connections.mjs
// Runs against the live credentials in .env.local and prints PASS/FAIL for
// each external integration wired into the template.
import { config } from "dotenv";
import dns from "node:dns";
import { MongoClient } from "mongodb";
import nodemailer from "nodemailer";
import { v2 as cloudinary } from "cloudinary";

config({ path: ".env.local" });

const ICONS = {
  pass: "\x1b[32m✔\x1b[0m",
  fail: "\x1b[31m✘\x1b[0m",
  info: "\x1b[36m•\x1b[0m",
};

function header(title) {
  console.log(`\n\x1b[1m── ${title} ──\x1b[0m`);
}

function line(name, ok, detail = "") {
  const icon = ok ? ICONS.pass : ICONS.fail;
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${icon} ${name.padEnd(28)} ${tag}${detail ? "  " + detail : ""}`);
}

// Resolve a `mongodb+srv://` URI to a `mongodb://` URI by pre-resolving the
// SRV record through public DNS (1.1.1.1 / 8.8.8.8). Mirrors lib/dns-fix.js
// but kept inline so the script has no Next.js alias dependency.
async function resolveMongoUri(uri) {
  if (!uri || !uri.startsWith("mongodb+srv://")) return uri;
  const m = uri.match(/^mongodb\+srv:\/\/([^@]+)@([^/?]+)(\/[^?]*)?(\?.*)?$/);
  if (!m) return uri;
  const [, auth, host, dbPart = "/", queryPart = ""] = m;
  const resolver = new dns.Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  const records = await new Promise((resolve, reject) => {
    resolver.resolveSrv(`_mongodb._tcp.${host}`, (err, addrs) => {
      if (err) return reject(err);
      resolve(addrs);
    });
  });
  const hosts = records
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => `${r.name}:${r.port}`)
    .join(",");
  const sep = queryPart ? "&" : "?";
  const extra = queryPart.includes("ssl=") ? "" : "ssl=true";
  return `mongodb://${auth}@${hosts}${dbPart}${queryPart}${extra ? sep + extra : ""}`;
}

async function testMongo() {
  header("MongoDB");
  const uri = process.env.MONGODB_URI;
  if (!uri) return line("MONGODB_URI", false, "missing");
  let client;
  try {
    let resolved = await resolveMongoUri(uri);
    // Ensure authSource=admin for Atlas (users created in admin db).
    if (resolved.startsWith("mongodb://") && !/([?&])authSource=/.test(resolved)) {
      resolved += (resolved.includes("?") ? "&" : "?") + "authSource=admin";
    }
    line("srv resolve", true, "ok");
    client = new MongoClient(resolved, {
      serverSelectionTimeoutMS: 15000,
      authSource: process.env.MONGODB_AUTH_SOURCE || "admin",
    });
    const t0 = Date.now();
    await client.connect();
    const ping = await client.db("admin").command({ ping: 1 });
    const ms = Date.now() - t0;
    const dbs = await client.db().admin().listDatabases();
    line("connect", ping.ok === 1, `${ms}ms`);
    line("databases", true, `(${dbs.databases.length}) ${dbs.databases.map((d) => d.name).slice(0, 6).join(", ")}`);
    return true;
  } catch (err) {
    line("connect", false, err.code || err.message);
    return false;
  } finally {
    if (client) try { await client.close(); } catch {}
  }
}

async function testSmtp() {
  header("SMTP (Gmail)");
  const host = process.env.MAIL_HOST;
  const port = Number(process.env.MAIL_PORT);
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;
  if (!host || !user || !pass) return line("MAIL_*", false, "missing");
  let transport;
  try {
    transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    });
    const t0 = Date.now();
    await transport.verify();
    const ms = Date.now() - t0;
    line("verify", true, `${ms}ms`);

    // Send a real test email so we exercise sendMail, not just auth.
    const from = process.env.MAIL_FROM || user;
    const info = await transport.sendMail({
      from,
      to: user, // send to self
      subject: "✅ Hackathon template SMTP test",
      text: `This is an automated connectivity test from scripts/test-connections.mjs.\n\nIf you can read this, your SMTP credentials in .env.local are working.`,
    });
    line("send", !!info.messageId, `messageId=${info.messageId}`);
    return true;
  } catch (err) {
    line("verify/send", false, err.code || err.message);
    return false;
  } finally {
    if (transport) try { transport.close(); } catch {}
  }
}

async function testCloudinary() {
  header("Cloudinary");
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) return line("CLOUDINARY_*", false, "missing");
  try {
    cloudinary.config({ cloud_name: cloud, api_key: key, api_secret: secret, secure: true });
    const t0 = Date.now();
    const res = await cloudinary.api.ping();
    const ms = Date.now() - t0;
    line("ping", res.status === "ok", `${ms}ms  status=${res.status}`);
    const usage = await cloudinary.api.usage();
    line("usage", true, `plan=${usage.plan}  used=${usage.usage?.storage ?? "?"}`);
    return true;
  } catch (err) {
    line("ping", false, err.error?.message || err.message);
    return false;
  }
}

async function testGoogleOAuth() {
  header("Google OAuth (config only)");
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) return line("GOOGLE_*", false, "missing");
  line("client_id present", true, id.slice(0, 22) + "…");
  line("client_secret present", true, "len=" + secret.length);
  try {
    const res = await fetch("https://accounts.google.com/.well-known/openid-configuration");
    const cfg = await res.json();
    line("google discovery", res.ok, `issuer=${cfg.issuer}`);
    const looksValid = id.endsWith(".apps.googleusercontent.com") && id.includes("-");
    line("client_id format", looksValid);
    return res.ok && looksValid;
  } catch (err) {
    line("google discovery", false, err.message);
    return false;
  }
}

(async () => {
  console.log("\x1b[1mHackathon template — connection smoke test\x1b[0m");
  console.log(`Node ${process.version}  ·  ${new Date().toISOString()}`);

  const results = await Promise.all([
    testMongo(),
    testSmtp(),
    testCloudinary(),
    testGoogleOAuth(),
  ]);

  header("Summary");
  const labels = ["MongoDB", "SMTP", "Cloudinary", "Google OAuth"];
  results.forEach((ok, i) => line(labels[i], ok));
  const allOk = results.every(Boolean);
  console.log(`\n${allOk ? "\x1b[32m✔ All connections OK\x1b[0m" : "\x1b[31m✘ One or more connections failed\x1b[0m"}\n`);
  process.exit(allOk ? 0 : 1);
})();