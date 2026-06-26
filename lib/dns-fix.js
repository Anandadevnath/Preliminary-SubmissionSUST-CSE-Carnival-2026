import dns from "node:dns";

/**
 * On some Windows setups Node inherits a DNS resolver bound to 127.0.0.1
 * (a local DoH stub like dnscrypt-proxy / NextDNS stub). That stub will
 * refuse SRV/A lookups it can't resolve upstream, producing:
 *
 *   querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
 *
 * What DOES work: creating a new `Resolver` instance with custom servers
 * (1.1.1.1 / 8.8.8.8), pre-resolving the SRV record, and returning a
 * `mongodb://` connection string with the shard hostnames inlined.
 *
 * Falls back to the original `mongodb+srv://` URI on any error — the
 * connect attempt will then fail loudly with a clear message.
 */

let resolvedUriCache = null;
let resolvePromise = null;

const MONGODB_URI = process.env.MONGODB_URI;

export async function getResolvedMongoUri() {
  if (resolvedUriCache) return resolvedUriCache;
  if (!MONGODB_URI) return null;
  if (!MONGODB_URI.startsWith("mongodb+srv://")) {
    resolvedUriCache = MONGODB_URI;
    return resolvedUriCache;
  }

  if (resolvePromise) return resolvePromise;
  resolvePromise = (async () => {
    const match = MONGODB_URI.match(
      /^mongodb\+srv:\/\/([^@]+)@([^/?]+)(\/[^?]*)?(\?.*)?$/
    );
    if (!match) {
      resolvedUriCache = MONGODB_URI;
      return resolvedUriCache;
    }
    const [, auth, host, dbPart = "/", queryPart = ""] = match;

    const resolver = new dns.Resolver();
    resolver.setServers(["1.1.1.1", "8.8.8.8"]);

    let records;
    try {
      records = await new Promise((resolve, reject) => {
        resolver.resolveSrv(`_mongodb._tcp.${host}`, (err, addrs) => {
          if (err) return reject(err);
          resolve(addrs);
        });
      });
    } catch (err) {
      console.warn(
        "[dns-fix] SRV lookup failed:",
        err.code || err.message
      );
      resolvedUriCache = MONGODB_URI;
      return resolvedUriCache;
    }

    const hosts = records
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => `${r.name}:${r.port}`)
      .join(",");
    const sep = queryPart ? "&" : "?";
    const extra = queryPart.includes("ssl=") ? "" : "ssl=true";
    resolvedUriCache = `mongodb://${auth}@${hosts}${dbPart}${
      queryPart
    }${extra ? sep + extra : ""}`;
    console.log(
      `[dns-fix] Resolved ${host} → ${records.length} host(s).`
    );
    return resolvedUriCache;
  })();

  return resolvePromise;
}