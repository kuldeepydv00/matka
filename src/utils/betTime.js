// Helpers for reading the REAL placement time of a bet and repairing bets whose
// created_at was overwritten with a later "now" timestamp.
const { getMarketCycleDate } = require('./dateCycle');

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;
const TEN_MINUTES = 10 * 60 * 1000;

// Time encoded in a MongoDB ObjectId (first 4 bytes = seconds since epoch)
function objectIdTime(id) {
  if (!id) return null;
  try {
    if (typeof id === 'object' && typeof id.getTimestamp === 'function') return id.getTimestamp();
  } catch (e) {}
  const hex = String(id);
  if (!OBJECT_ID_RE.test(hex)) return null;
  const d = new Date(parseInt(hex.slice(0, 8), 16) * 1000);
  return isNaN(d.getTime()) ? null : d;
}

// Real time of a Mongo bet document. Never falls back to "now".
function getMongoBetTime(doc) {
  if (!doc) return null;
  const raw = doc.created_at || doc.createdAt;
  if (raw) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return objectIdTime(doc._id);
}

function findSchedule(schedulesStore, gameName) {
  if (!schedulesStore) return null;
  return schedulesStore[gameName] ||
    (gameName === 'Desawar' ? schedulesStore['Disawer'] :
    (gameName === 'Disawer' ? schedulesStore['Desawar'] :
    (gameName === 'Shree Ganesh' ? schedulesStore['Shri Ganesh'] :
    (gameName === 'Shri Ganesh' ? schedulesStore['Shree Ganesh'] : null)))) || null;
}

// A bet can never be created AFTER its MongoDB record. If the stored created_at is
// more than 10 minutes later than the ObjectId time, it was overwritten: restore it
// and recompute the draw date (date_key) from the real time.
// Does not touch status, amounts, winnings or wallets.
function repairRestampedBets(bets, schedulesStore) {
  const summary = { checked: 0, fixed: 0, byGame: {} };
  if (!Array.isArray(bets)) return summary;
  bets.forEach(b => {
    const realTime = objectIdTime(b && (b._id || b.id));
    if (!realTime || !b.created_at) return;
    summary.checked++;
    const shown = new Date(b.created_at);
    if (isNaN(shown.getTime())) return;
    if (shown.getTime() - realTime.getTime() <= TEN_MINUTES) return;

    const oldKey = b.date_key || b.createdDateKey || '-';
    const realIso = realTime.toISOString();
    if (b.date && String(b.date) === String(b.created_at)) b.date = realIso;
    b.created_at = realIso;
    const newKey = getMarketCycleDate(b.game_name, findSchedule(schedulesStore, b.game_name), realTime);
    b.date_key = newKey;
    b.createdDateKey = newKey;

    summary.fixed++;
    const k = `${b.game_name}: ${oldKey} -> ${newKey}`;
    summary.byGame[k] = (summary.byGame[k] || 0) + 1;
  });
  return summary;
}

module.exports = { objectIdTime, getMongoBetTime, repairRestampedBets, findSchedule };
