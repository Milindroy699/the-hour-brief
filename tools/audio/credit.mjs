// Keeps an ESTIMATE of the Sarvam credit left, because Sarvam has no way to read the balance from code (as far as we know).
// You tell it the balance once (and again after each top-up); every recording subtracts its cost (₹3 per 1,000 characters).
// When the estimate gets low, the workflow opens an alert. The alert for "Sarvam said there is no credit" does not depend on this.
//   node credit.mjs set    --file ledger.json --balance 300
//   node credit.mjs charge --file ledger.json --chars 5754 --date 2026-09-25 [--id RUN_ID]
//   node credit.mjs status --file ledger.json [--low 100] [--min-days 5]      (prints JSON; exit code 10 when low)
import fs from 'node:fs';

export const RUPEES_PER_1K = Number(process.env.RUPEES_PER_1K || 3);
const KEEP = 60;
const round = (n) => Math.round(n * 100) / 100;

export function load(file) {
  try { const o = JSON.parse(fs.readFileSync(file, 'utf8')); if (o && typeof o.balance === 'number') return { history: [], ...o }; } catch (e) { /* none yet */ }
  return null;
}
export function set(ledger, balance, now = new Date()) {
  if (!(balance >= 0) || !Number.isFinite(balance)) throw new Error('balance must be a number of rupees, zero or more');
  return { balance: round(balance), setAt: now.toISOString(), updated: now.toISOString(), history: (ledger && ledger.history || []).slice(-KEEP) };
}
export function charge(ledger, { chars, date, id }, now = new Date()) {
  if (!ledger) return null;                                         // no balance was ever set: nothing to track
  if (!(chars > 0)) throw new Error('chars must be positive');
  if (id && ledger.history.some((h) => h.id === String(id))) return ledger;          // the same workflow run reported twice
  const rupees = round(chars * RUPEES_PER_1K / 1000);
  return { ...ledger, balance: round(ledger.balance - rupees), updated: now.toISOString(),
    history: [...ledger.history, { date: date || now.toISOString().slice(0, 10), chars, rupees, ...(id ? { id: String(id) } : {}) }].slice(-KEEP) };
}
// Average recent daily spend (a day recorded twice counts once, as a day), so "days left" means something.
export function perDay(ledger) {
  const days = {};
  for (const h of ledger.history.slice(-14)) days[h.date] = (days[h.date] || 0) + h.rupees;
  const v = Object.values(days);
  return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : round(6000 * RUPEES_PER_1K / 1000);     // a normal Quick day is about 6,000 characters
}
export function status(ledger, { low = 100, minDays = 5 } = {}) {
  if (!ledger) return { tracked: false, low: false };
  const day = perDay(ledger), daysLeft = day > 0 ? Math.floor(ledger.balance / day) : 999;
  return { tracked: true, balance: ledger.balance, perDay: day, daysLeft, low: ledger.balance < low || daysLeft < minDays, updated: ledger.updated, setAt: ledger.setAt };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const [cmd] = process.argv.slice(2), file = arg('--file');
  if (!file || !['set', 'charge', 'status'].includes(cmd)) { console.error('Usage: node credit.mjs set|charge|status --file ledger.json [...]'); process.exit(2); }
  try {
    const cur = load(file);
    if (cmd === 'set') { const l = set(cur, Number(arg('--balance'))); fs.writeFileSync(file, JSON.stringify(l, null, 1)); console.log(JSON.stringify(status(l, { low: Number(arg('--low', 100)) }))); }
    else if (cmd === 'charge') {
      const l = charge(cur, { chars: Number(arg('--chars')), date: arg('--date'), id: arg('--id') });
      if (!l) console.log('No balance has been set, so nothing is tracked (run the "Sarvam credit" workflow once).');
      else { fs.writeFileSync(file, JSON.stringify(l, null, 1)); console.log(JSON.stringify(status(l, { low: Number(arg('--low', 100)) }))); }
    } else {
      const st = status(cur, { low: Number(arg('--low', 100)), minDays: Number(arg('--min-days', 5)) });
      console.log(JSON.stringify(st));
      if (st.low) process.exit(10);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
