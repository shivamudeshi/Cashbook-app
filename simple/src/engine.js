/* ────────────────────────── engine ──────────────────────────
   Cash basis, symmetric N-account model: every account (bank or credit
   card) is an explicit array entry, so every entry leg names the account
   it actually moved through — there's no implicit "Bank" the way the main
   app has. Functions below are either ported near-verbatim from
   src/CashBook.jsx (noted per-function) or new, small, and specific to
   this app's simpler shape (no investments, no net-worth page). */

const toPaise = (n) => Math.round(n * 100) / 100;
const rupeeDigits = (v) => (Math.abs(v % 1) > 1e-9 ? 2 : 0);

export function inr(n) {
  const v = toPaise(n);
  const d = rupeeDigits(v);
  const shown = Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  return (v < 0 ? "−" : "") + "₹" + shown;
}

// Ported verbatim from CashBook.jsx:311-323.
export function parseAmount(s) {
  if (typeof s === "number") return toPaise(s);
  if (!s) return NaN;
  const t = String(s).replace(/[₹,\s]/g, "").toLowerCase();
  const m = t.match(/^(\d+(?:\.\d+)?)(k|l|lac|lakh|lakhs|cr|crore)?$/);
  if (!m) return NaN;
  const mult = { k: 1e3, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7 }[m[2]] || 1;
  return toPaise(parseFloat(m[1]) * mult);
}

/* ─────────────────── calendar helpers (ported verbatim) ─────────────────── */
export const pad2 = (n) => String(n).padStart(2, "0");
export function fyOf(date) {
  const y = +date.slice(0, 4);
  return +date.slice(5, 7) >= 4 ? y : y - 1;
}
export function fyRange(fy) {
  return [`${fy}-04-01`, `${fy + 1}-03-31`];
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function shiftYear(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y + n, m - 1, d);
  if (dt.getMonth() !== m - 1) dt.setDate(0);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
export function monthBounds(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${y}-${pad2(m)}-01`, `${y}-${pad2(m)}-${pad2(last)}`];
}
// Matches the approved mockup's period picker options exactly: This
// Month (period-to-date), Last Month (a full closed month), Full Year
// (the selected FY), Custom range.
export function periodRange(span, fy, customFrom, customTo) {
  const t = today();
  if (span === "thisMonth") return [t.slice(0, 8) + "01", t];
  if (span === "lastMonth") {
    const [y, m] = t.split("-").map(Number);
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    return monthBounds(`${py}-${pad2(pm)}-01`);
  }
  if (span === "year") return fyRange(fy);
  return [customFrom, customTo];
}
// "vs previous": an equal-length window immediately before `from`.
// "vs last year": the same window, shifted back exactly one year.
export function comparePeriod(from, to, mode) {
  if (mode === "lastyear") return [shiftYear(from, -1), shiftYear(to, -1)];
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const pTo = addDays(from, -1);
  return [addDays(pTo, -(days - 1)), pTo];
}
export function periodVariance(cur, prev) {
  if (cur === prev) return { pct: 0, dir: "flat" };
  const pct = prev ? Math.round(Math.abs((cur - prev) / prev) * 100) : 100;
  return { pct, dir: cur > prev ? "up" : "down" };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ────────────────────────── entry predicates ──────────────────────────
   A freshly-imported (or manually parked) entry sits in the reserved
   "Suspense" category until the user confirms a real one for it — until
   then it's "unexplained" and stays out of every balance/report. Transfer
   and party entries never carry a category, so they're always explained.
   Ported from CashBook.jsx:365-368,373-375 with e.head -> e.category. */
export function isExplained(e) {
  if (e.type === "in" || e.type === "out") return e.category !== "Suspense";
  return true;
}

// A refund is tagged with an EXPENSE category instead of an income one —
// computePL nets it against that category's spend rather than counting it
// as unrelated income.
export function isRefund(db, e) {
  return isExplained(e) && e.type === "in" && ((db.categories && db.categories.expense) || []).includes(e.category);
}

/* ────────────────────────── P&L ──────────────────────────
   Ported from CashBook.jsx:427-460, minus the two holdings-only blocks
   (no investments in this app) and db.headClass[e.head] -> the flat
   db.bsCategories membership check (see storage.js's defaultBook). */
export function computePL(db, from, to) {
  const income = {}, expense = {};
  for (const e of db.entries) {
    if (e.type !== "in" && e.type !== "out") continue;
    if (!isExplained(e)) continue;
    if (e.date < from || e.date > to) continue;
    if (db.bsCategories.includes(e.category)) continue; // Balance Sheet only -- never P&L
    if (isRefund(db, e)) {
      expense[e.category] = (expense[e.category] || 0) - e.amount;
    } else {
      const bag = e.type === "in" ? income : expense;
      bag[e.category] = (bag[e.category] || 0) + e.amount;
    }
  }
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const totalIncome = sum(income), totalExpense = sum(expense);
  return { income, expense, totalIncome, totalExpense, net: totalIncome - totalExpense };
}

/* ────────────────────────── Cash Flow (new — no equivalent in the main
   app, which only has a flat 6-month chart) ──────────────────────────
   Bifurcates every explained in/out/party entry in the period into "From
   P&L Activities" (identical to computePL's own totals, so the two
   reports always reconcile) and "From Balance Sheet Items" (BS-flagged
   categories, netted per category, plus a period-scoped party net-flow
   pass grouped into one "Lent to ..." row and one "Borrowed from ..."
   row -- matching the approved mockup's own worked example exactly).
   Transfers between the user's own accounts are excluded entirely, same
   as the mockup's stated behaviour ("excludes transfers between your own
   accounts"). */
export function computeCashFlow(db, from, to) {
  const pl = computePL(db, from, to);

  const bsBag = {};
  for (const e of db.entries) {
    if (e.type !== "in" && e.type !== "out") continue;
    if (!isExplained(e)) continue;
    if (e.date < from || e.date > to) continue;
    if (!db.bsCategories.includes(e.category)) continue;
    const signed = e.type === "in" ? e.amount : -e.amount;
    bsBag[e.category] = (bsBag[e.category] || 0) + signed;
  }
  const bsRows = Object.entries(bsBag).map(([label, amount]) => ({ label, amount, bs: true }));

  const partyNet = {};
  for (const e of db.entries) {
    if (e.type !== "party") continue;
    if (!isExplained(e)) continue;
    if (e.date < from || e.date > to) continue;
    const signed = e.dir === "in" ? e.amount : -e.amount;
    partyNet[e.partyId] = (partyNet[e.partyId] || 0) + signed;
  }
  const lentNames = [], borrowedNames = [];
  let lentTotal = 0, borrowedTotal = 0;
  for (const [partyId, net] of Object.entries(partyNet)) {
    if (net === 0) continue;
    const party = (db.parties || []).find((p) => p.id === partyId);
    const name = party ? party.name : "Unknown";
    if (net < 0) { lentNames.push(name); lentTotal += net; }
    else { borrowedNames.push(name); borrowedTotal += net; }
  }
  const partyRows = [];
  if (lentNames.length) partyRows.push({ label: `Lent to ${lentNames.join(", ")}`, amount: lentTotal });
  if (borrowedNames.length) partyRows.push({ label: `Borrowed from ${borrowedNames.join(", ")}`, amount: borrowedTotal });

  const rows = [...bsRows, ...partyRows];
  const bsNet = rows.reduce((s, r) => s + r.amount, 0);

  return {
    pl: { income: pl.totalIncome, expense: pl.totalExpense, net: pl.net },
    bs: { rows, net: bsNet },
    net: pl.net + bsNet,
  };
}

/* ────────────────────────── accounts ──────────────────────────
   New — replaces the main app's balancesAsOf/accountModels, which both
   assume one implicit "Bank" plus named liability accounts. Every
   account here is explicit and symmetric, so one small helper posts a
   signed leg to whichever account it names, using the same
   liability-inversion trick balancesAsOf's post() already uses for
   named accounts (CashBook.jsx:470-474), generalized to every account:
   an "arriving" leg raises a bank's balance and *lowers* a card's
   outstanding; a "leaving" leg does the opposite. */
function applyLeg(balances, accounts, accountId, arriving, amount) {
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return; // account was deleted; the leg simply doesn't post anywhere
  const assetDelta = arriving ? amount : -amount;
  balances[accountId] = (balances[accountId] || 0) + (acc.kind === "card" ? -assetDelta : assetDelta);
}

export function accountsWithBalances(db, asOf) {
  const balances = {};
  for (const a of db.accounts) balances[a.id] = a.opening || 0;
  for (const e of db.entries) {
    if (e.date > asOf) continue;
    if (!isExplained(e)) continue;
    if (e.type === "transfer") {
      applyLeg(balances, db.accounts, e.fromAccountId, false, e.amount);
      applyLeg(balances, db.accounts, e.toAccountId, true, e.amount);
    } else if (e.type === "party") {
      applyLeg(balances, db.accounts, e.accountId, e.dir === "in", e.amount);
    } else {
      applyLeg(balances, db.accounts, e.accountId, e.type === "in", e.amount);
    }
  }
  return db.accounts.map((a) => ({ ...a, balance: balances[a.id] || 0 }));
}

/* ────────────────────────── Owed ──────────────────────────
   Ported verbatim from CashBook.jsx:497-515 -- zero coupling to book
   shape beyond parties/entries/owedMemos, which are unchanged here.
   Positive balance = debtor (they owe you), negative = creditor. */
export function owedAsOf(db, asOf) {
  let memoNet = 0;
  const perParty = (db.parties || []).map((p) => {
    let cash = 0, memo = 0;
    for (const e of db.entries) {
      if (e.type === "party" && e.partyId === p.id && e.date <= asOf && isExplained(e)) {
        cash += e.dir === "out" ? e.amount : -e.amount;
      }
    }
    for (const m of db.owedMemos || []) {
      if (m.partyId === p.id && m.date <= asOf) memo += m.amount;
    }
    memoNet += memo;
    return { ...p, cash, memo, balance: cash + memo };
  });
  const debtors = perParty.reduce((s, p) => s + Math.max(p.balance, 0), 0);
  const creditors = perParty.reduce((s, p) => s + Math.max(-p.balance, 0), 0);
  return { perParty, debtors, creditors, memoNet };
}

/* ────────────────────────── Trips ──────────────────────────
   Ported verbatim from CashBook.jsx:519-534. */
export function tripSpendAsOf(db, asOf) {
  return (db.trips || []).map((t) => {
    let spent = 0, count = 0;
    for (const e of db.entries) {
      // A split expense's participant shares carry the same tripId as the
      // "your share" entry, but those are type "party" -- pure
      // owed-tracking, never real spend -- so they must never be summed
      // here.
      if (e.tripId === t.id && (e.type === "out" || e.type === "in") && e.date <= asOf && isExplained(e)) {
        spent += e.type === "out" ? e.amount : -e.amount;
        count++;
      }
    }
    return { ...t, spent, count };
  });
}

/* ────────────────────────── auto-coding ──────────────────────────
   Ported verbatim from CashBook.jsx:727-741. Still reads codingRules[].
   head -- the caller assigns the return value to entry.category. */
// Whitespace is stripped from both sides before matching, not just
// lowercased -- some bank statement PDFs extract a merchant's letters as
// separate text runs that get rejoined with stray spaces (e.g. "Z EPTO
// MARKETPLACE"), which would otherwise never contain a plain "zepto"
// substring even though it's obviously the same merchant.
export function suggestHead(db, note) {
  const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, "");
  const low = norm(note);
  for (const r of db.codingRules || []) {
    if (r.match && low.includes(norm(r.match))) return r.head;
  }
  return "Suspense";
}
export function keywordOf(note) {
  const words = (note || "").toLowerCase().match(/[a-z]{4,}/g) || [];
  const skip = new Set(["upi", "neft", "imps", "rtgs", "bank", "transfer", "payment", "toward", "from"]);
  return words.find((w) => !skip.has(w)) || words[0] || "";
}
