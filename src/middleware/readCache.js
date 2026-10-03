// Short-lived response cache for heavy read-only endpoints.
//
// Why: the admin panel polls ~18 endpoints, several of which load whole MongoDB
// collections (bets, users, deposits, withdrawals, transactions) and do heavy work on
// the single Node.js thread. Repeated every few seconds, that slows every other request
// (app + website). This cache serves the same JSON for a few seconds instead of
// recomputing it.
//
// Freshness rules:
//   - Any write request (POST/PUT/PATCH/DELETE anywhere in the API) marks cached data
//     as outdated, so the next read after an approval, bet, deposit etc. is recomputed.
//   - Even without writes, nothing is served older than SOFT_TTL_MS.
//   - HARD_TTL_MS only absorbs bursts of identical requests (several admin tabs/phones).
const HARD_TTL_MS = 2000;
const SOFT_TTL_MS = 15000;
const MAX_ENTRIES = 300;

let generation = 0;
const cache = new Map(); // key -> { gen, at, body }

function bumpOnWrite(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') generation++;
  next();
}

function cacheReads(paths) {
  const allowed = new Set(paths);
  return function readCache(req, res, next) {
    if (req.method !== 'GET') return next();
    const p = (req.path || '/').replace(/\/+$/, '') || '/';
    if (!allowed.has(p)) return next();

    const key = req.originalUrl;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && (now - hit.at < HARD_TTL_MS || (hit.gen === generation && now - hit.at < SOFT_TTL_MS))) {
      res.set('X-Cache', 'HIT');
      res.type('application/json');
      return res.status(200).send(hit.body);
    }

    const startGen = generation;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) {
        try {
          const str = JSON.stringify(body);
          cache.set(key, { gen: startGen, at: Date.now(), body: str });
          if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
          res.set('X-Cache', 'MISS');
          res.type('application/json');
          return res.send(str);
        } catch (e) { /* fall through */ }
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = { bumpOnWrite, cacheReads };
