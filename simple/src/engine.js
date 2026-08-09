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
export function monthBounds(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${y}-${pad2(m)}-01`, `${y}-${pad2(m)}-${pad2(last)}`];
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Aug 5" style short label for grouping/display -- Transactions rows are
// grouped by the full ISO date underneath, so same-label entries a year
// apart still land in separate groups even though this label drops the year.
export function shortDateLabel(dateStr) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}`;
}
// Matches the approved design handoff's own period-navigation model
// exactly: a period *type* (month/quarter/financial year) plus an integer
// *offset* from today's period (0 = current, 1 = one period back, ...),
// rather than a raw date-range picker. Quarters follow the Apr-Mar
// financial year (Q1 = Apr-Jun, ... Q4 = Jan-Mar), matching fyOf/fyRange.
export function periodByOffset(type, offset, t) {
  t = t || today();
  const [ty, tm] = t.split("-").map(Number);
  if (type === "month") {
    const total = ty * 12 + (tm - 1) - offset;
    const y = Math.floor(total / 12), m = total % 12;
    const [from, to] = monthBounds(`${y}-${pad2(m + 1)}-01`);
    return { from, to, label: `${MONTH_SHORT[m]} ${y}` };
  }
  if (type === "quarter") {
    let fy = tm >= 4 ? ty : ty - 1;
    let qIndex = Math.floor(((tm - 4 + 12) % 12) / 3); // 0=Apr-Jun .. 3=Jan-Mar
    let totalQ = fy * 4 + qIndex - offset;
    fy = Math.floor(totalQ / 4);
    qIndex = ((totalQ % 4) + 4) % 4;
    const startMonth = 3 + qIndex * 3; // 0-indexed, Apr = 3
    const y = fy + Math.floor(startMonth / 12), m = startMonth % 12;
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 3, 0);
    const from = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-01`;
    const to = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
    const fyLabel = `${String(fy).slice(2)}–${String(fy + 1).slice(2)}`;
    return { from, to, label: `Q${qIndex + 1} FY${fyLabel} (${MONTH_SHORT[start.getMonth()]}–${MONTH_SHORT[end.getMonth()]})` };
  }
  if (type === "fy") {
    const fy = (tm >= 4 ? ty : ty - 1) - offset;
    const [from, to] = fyRange(fy);
    return { from, to, label: `FY ${fy}–${String(fy + 1).slice(2)}` };
  }
  return null;
}
// The "vs previous period" range for Reports' Compare toggle: month/
// quarter/fy compare to the whole prior period (offset+1); a custom range
// compares to the same number of days immediately before it.
export function previousPeriod(type, offset, customFrom, customTo, t) {
  if (type === "custom") {
    const days = Math.round((new Date(customTo) - new Date(customFrom)) / 86400000) + 1;
    const to = addDays(customFrom, -1);
    const from = addDays(to, -(days - 1));
    return { from, to, label: `${from} – ${to}` };
  }
  return periodByOffset(type, offset + 1, t);
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

// The combined cash position across every account at a point in time --
// bank balances are an asset (add), a card's balance is outstanding debt
// (subtract) -- same convention the Home hero "Detailed breakdown" net
// figure uses.
function combinedCashPosition(accountsWithBal) {
  return accountsWithBal.reduce((s, a) => s + (a.kind === "card" ? -a.balance : a.balance), 0);
}

/* ────────────────────────── Cash Flow (matches the approved design
   handoff's own shape: a literal running ledger, not a P&L/Balance-Sheet
   bifurcation) ──────────────────────────
   Opening Balance -> Money In (by income category) -> Money Out (by
   expense category, refunds netted in exactly like computePL does, so
   the two reports always reconcile on the same numbers) -> Other
   Movement (Balance Sheet categories + a period-scoped party net-flow
   pass, grouped into one "Lent to ..." row and one "Borrowed from ..."
   row) -> Net Cash Flow -> Closing Balance. Transfers between the
   user's own accounts are excluded entirely -- they net to zero across
   the book and aren't a category a user would look to categorize. */
export function computeCashFlow(db, from, to) {
  const pl = computePL(db, from, to);
  const moneyIn = Object.entries(pl.income).map(([category, amount]) => ({ category, amount }));
  const moneyOut = Object.entries(pl.expense).map(([category, amount]) => ({ category, amount }));

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
  const lentNames = [], borrowedNames = [], lentIds = [], borrowedIds = [];
  let lentTotal = 0, borrowedTotal = 0;
  for (const [partyId, net] of Object.entries(partyNet)) {
    if (net === 0) continue;
    const party = (db.parties || []).find((p) => p.id === partyId);
    const name = party ? party.name : "Unknown";
    if (net < 0) { lentNames.push(name); lentIds.push(partyId); lentTotal += net; }
    else { borrowedNames.push(name); borrowedIds.push(partyId); borrowedTotal += net; }
  }
  // partyIds lets a UI drill into exactly which party entries made up a
  // grouped "Lent to X, Y"/"Borrowed from Z" row, without re-deriving the
  // net-lent/net-borrowed classification itself.
  const otherRows = [...bsRows];
  if (lentNames.length) otherRows.push({ label: `Lent to ${lentNames.join(", ")}`, amount: lentTotal, partyIds: lentIds });
  if (borrowedNames.length) otherRows.push({ label: `Borrowed from ${borrowedNames.join(", ")}`, amount: borrowedTotal, partyIds: borrowedIds });

  const totalIn = pl.totalIncome, totalOut = pl.totalExpense;
  const totalOther = otherRows.reduce((s, r) => s + r.amount, 0);
  const net = totalIn - totalOut + totalOther;
  const opening = combinedCashPosition(accountsWithBalances(db, addDays(from, -1)));
  const closing = combinedCashPosition(accountsWithBalances(db, to));

  return { opening, moneyIn, totalIn, moneyOut, totalOut, other: otherRows, totalOther, net, closing };
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
