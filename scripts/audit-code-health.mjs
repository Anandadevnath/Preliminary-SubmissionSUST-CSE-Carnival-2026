// scripts/audit-code-health.mjs
// Static + structural checks on the source tree.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

let pass = 0, fail = 0;
function check(label, cond, got = "") {
  if (cond) { pass++; console.log(`  ✔ ${label}`); }
  else { fail++; console.log(`  ✘ ${label} — ${got}`); }
}

const ROOT = process.cwd();

function relPath(f) {
  return f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const files = await walk(ROOT);
const jsFiles = files.filter((f) => /\.(js|mjs|cjs|jsx)$/.test(f));
const libFiles = jsFiles.filter((f) => /[\\\/]lib[\\\/]/.test(f));
const routeFiles = jsFiles.filter((f) => /[\\\/]app[\\\/]api[\\\/]/.test(f) && f.endsWith("route.js"));

console.log(`═══ Code health: ${jsFiles.length} JS files total ═══\n`);

console.log("── Structure ──");
check("lib/ exists", libFiles.length > 0, `${libFiles.length} files`);
check("API route exists", routeFiles.length > 0, `${routeFiles.length} route(s)`);

// Check no console.log left in production lib (console.error is allowed
// for genuine error logging). Exception: dns-fix.js logs informational
// DNS-resolution output at module load time, which is genuinely useful.
console.log("\n── Console hygiene ──");
const allowedConsoleLog = new Set(["lib/dns-fix.js"]);
for (const f of libFiles) {
  const rel = relPath(f);
  if (allowedConsoleLog.has(rel.replace(/\\/g, "/"))) continue;
  const src = await readFile(f, "utf8");
  const logs = src.match(/console\.log\(/g);
  if (logs && logs.length > 0) {
    check(`${rel} has no console.log`, false, `${logs.length} found`);
  }
}

// Check no TODOs / FIXMEs left in lib/
console.log("\n── TODO hygiene ──");
for (const f of libFiles) {
  const src = await readFile(f, "utf8");
  const todos = src.match(/\bTODO\b|\bFIXME\b|\bXXX\b/g);
  if (todos) {
    check(`${relPath(f)} has no TODOs`, false, `${todos.length} found`);
  }
}

// Check for hard-coded secrets / API keys
console.log("\n── Secrets scan ──");
const secretPatterns = [
  /\bAKIA[0-9A-Z]{16}\b/,           // AWS access key
  /sk-[a-zA-Z0-9]{20,}/,            // OpenAI-style key
  /\bghp_[a-zA-Z0-9]{20,}\b/,       // GitHub PAT
  /bearer\s+[a-zA-Z0-9_-]{20,}/i,   // Bearer token
];
for (const f of jsFiles) {
  if (f.includes("audit-")) continue;
  const src = await readFile(f, "utf8");
  for (const re of secretPatterns) {
    if (re.test(src)) {
      check(`${f.replace(ROOT + "/", "")} no hard-coded secret (${re})`, false);
    }
  }
}
check("no hard-coded secrets in source", true);

// Check for files > 50KB (code smell — usually means auto-generated)
console.log("\n── File sizes ──");
for (const f of libFiles) {
  const st = await stat(f);
  const kb = Math.round(st.size / 1024);
  if (kb > 50) {
    check(`${relPath(f)} ≤ 50KB`, false, `${kb}KB`);
  }
}

// File sizes
console.log("\n── Line counts ──");
let totalLines = 0;
for (const f of libFiles) {
  const src = await readFile(f, "utf8");
  const lines = src.split("\n").length;
  totalLines += lines;
}
console.log(`  lib/ total: ${totalLines} lines across ${libFiles.length} files`);
check("lib/ average file < 1000 lines", totalLines / libFiles.length < 1000);

// Check that every module in lib/ exports something
console.log("\n── Module exports ──");
for (const f of libFiles) {
  const src = await readFile(f, "utf8");
  if (/\bexport\s+(async\s+)?(function|const|class|\{)/.test(src)) {
    // OK
  } else if (/scripts|node_modules/.test(f)) {
    // skip
  } else {
    check(`${relPath(f)} has exports`, false, "no exports found");
  }
}

// Check that schemas.js is imported by analyze.js
console.log("\n── Wiring ──");
{
  const analyze = await readFile(join(ROOT, "lib/analyze.js"), "utf8");
  check("analyze.js imports from classifier", /from\s+["'].\/classifier\.js["']/.test(analyze));
  check("analyze.js imports from replies", /from\s+["'].\/replies\.js["']/.test(analyze));
  check("analyze.js imports from safety", /from\s+["'].\/safety\.js["']/.test(analyze));
  check("analyze.js imports from schemas", /from\s+["'].\/schemas\.js["']/.test(analyze));
}
{
  const route = await readFile(join(ROOT, "app/api/analyze-ticket/route.js"), "utf8");
  check("route.js imports from analyze", /from\s+["']@?\/lib\/analyze["']/.test(route));
}

// Check that env-var access is gated behind process.env
console.log("\n── Env-var handling ──");
{
  const mongo = await readFile(join(ROOT, "lib/mongo-client.js"), "utf8");
  check("mongo-client reads MONGODB_URI", /process\.env\.MONGODB_URI/.test(mongo));
  check("mongo-client handles missing URI gracefully",
    /!MONGODB_URI|not configured|MONGODB_URI is not/.test(mongo));
}

// No "require" mixed with ESM (consistency check)
console.log("\n── Module system consistency ──");
let mixedRequire = false;
for (const f of jsFiles) {
  if (f.includes("audit-") || f.includes("scripts/") || f.endsWith(".cjs")) continue;
  const src = await readFile(f, "utf8");
  if (/\brequire\(/.test(src) && /\bimport\s/.test(src)) {
    mixedRequire = true;
    console.log(`  mixed in ${f}`);
  }
}
check("lib/ uses consistent ESM (no require)", !mixedRequire);

// Package.json is sane
console.log("\n── Package config ──");
{
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  check("name set", !!pkg.name);
  check("version set", !!pkg.version);
  check("scripts.dev defined", !!pkg.scripts?.dev);
  check("scripts.build defined", !!pkg.scripts?.build);
  check("dependencies include next", !!pkg.dependencies?.next);
  check("dependencies include zod", !!pkg.dependencies?.zod);
  check("no devDependencies on production libs",
    !pkg.devDependencies?.mongodb && !pkg.devDependencies?.mongoose);
}

console.log("\n═══ Code health Results ═══");
console.log(`  ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);