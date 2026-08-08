// Mounts the REAL dist-simple/app.js in jsdom and asserts it renders, then
// asserts the accounting engine (exposed as window.__simpleEngine by the
// bundle) on a worked example. Mirrors test/prod.cjs's approach for the
// main app.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { indexedDB, IDBKeyRange } = require("fake-indexeddb");

const BUNDLE = path.join(__dirname, "..", "..", "dist-simple", "app.js");

async function main() {
  assert.ok(fs.existsSync(BUNDLE), "dist-simple/app.js missing — run `npm run build:simple` first");

  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { runScripts: "dangerously", pretendToBeVisual: true, url: "https://cashbook-simple.test/" }
  );
  const { window } = dom;
  window.indexedDB = indexedDB;
  window.IDBKeyRange = IDBKeyRange;
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

  window.eval(fs.readFileSync(BUNDLE, "utf8"));

  // Let the async IndexedDB load resolve and React commit.
  await new Promise((r) => setTimeout(r, 400));

  const text = window.document.body.textContent;
  for (const expected of ["Home", "Owed", "Transactions", "Reports", "Setup"]) {
    assert.ok(text.includes(expected), `rendered app should contain "${expected}"`);
  }
  assert.ok(!text.includes("Travel"), "Travel tab has been removed");

  /* ── engine: worked example ── */
  const E = window.__simpleEngine;
  assert.ok(E, "bundle should expose window.__simpleEngine");

  const date = "2026-04-10";
  const db = {
    v: 1,
    prefs: { lock: { on: false, pin: "" } },
    accounts: [
      { id: "bank1", name: "HDFC Bank", kind: "bank", opening: 100000 },
      { id: "card1", name: "HDFC Credit Card", kind: "card", opening: 0 },
    ],
    categories: { expense: ["Rent", "Groceries", "Home Loan EMI", "Suspense"], income: ["Salary"] },
    bsCategories: ["Home Loan EMI"],
    parties: [{ id: "p1", name: "A" }],
    owedMemos: [],
    codingRules: [{ match: "zepto", head: "Groceries" }],
    entries: [
      { id: "e1", date, amount: 80000, type: "in", category: "Salary", accountId: "bank1" },
      { id: "e2", date, amount: 20000, type: "out", category: "Rent", accountId: "bank1" },
      { id: "e3", date, amount: 14000, type: "out", category: "Home Loan EMI", accountId: "bank1" }, // BS -- excluded from P&L
      { id: "e4", date, amount: 3000, type: "out", category: "Groceries", accountId: "card1" },
      { id: "e5", date, amount: 5000, type: "party", partyId: "p1", accountId: "bank1", dir: "out" }, // lent
      { id: "e6", date, amount: 2000, type: "party", partyId: "p1", accountId: "bank1", dir: "in" }, // partial repay
      { id: "e7", date, amount: 3000, type: "transfer", fromAccountId: "bank1", toAccountId: "card1" },
      { id: "e8", date, amount: 500, type: "in", category: "Groceries", accountId: "bank1" }, // a refund (isRefund: "in" against an expense category)
      { id: "e9", date, amount: 1000, type: "out", category: "Groceries", accountId: "bank1" },
      { id: "e10", date, amount: 999, type: "out", category: "Suspense", accountId: "bank1", merchant: "ZEPTO ONLINE" }, // unexplained/imported
    ],
  };
  const asOf = "2026-04-30";

  // isExplained / isRefund
  assert.strictEqual(E.isExplained(db.entries[0]), true, "a coded entry is explained");
  assert.strictEqual(E.isExplained(db.entries[9]), false, "a Suspense entry is unexplained");
  assert.strictEqual(E.isRefund(db, db.entries[7]), true, "an \"in\" entry against an expense category is a refund");

  // computePL: EMI (BS) and party legs stay out; refund nets against Groceries.
  const pl = E.computePL(db, date, asOf);
  assert.strictEqual(pl.totalIncome, 80000, "P&L total income");
  assert.strictEqual(pl.expense.Rent, 20000, "P&L Rent");
  assert.strictEqual(pl.expense.Groceries, 3500, "P&L Groceries nets the refund (3000+1000-500)");
  assert.ok(!("Home Loan EMI" in pl.expense), "BS category excluded from P&L expense");
  assert.strictEqual(pl.totalExpense, 23500, "P&L total expense");
  assert.strictEqual(pl.net, 56500, "P&L net");

  // accountsWithBalances: card balance is OUTSTANDING (rises on spend, falls
  // on a transfer in) via the liability-inversion formula.
  const accts = E.accountsWithBalances(db, asOf);
  const bank1 = accts.find((a) => a.id === "bank1");
  const card1 = accts.find((a) => a.id === "card1");
  assert.strictEqual(bank1.balance, 139500, "bank1 balance");
  assert.strictEqual(card1.balance, 0, "card1 outstanding: +3000 (Groceries spend) -3000 (transfer in) = 0");

  // owedAsOf: party lent 5000, repaid 2000 -> still a debtor for 3000.
  const owed = E.owedAsOf(db, asOf);
  const p1 = owed.perParty.find((p) => p.id === "p1");
  assert.strictEqual(p1.balance, 3000, "party balance (debtor)");
  assert.strictEqual(owed.debtors, 3000, "total debtors");
  assert.strictEqual(owed.creditors, 0, "total creditors");

  // computeCashFlow: a literal running ledger (Opening -> Money In -> Money
  // Out -> Other Movement -> Net -> Closing), matching the approved design
  // handoff exactly. Money In/Out reuse computePL's own bags (so refunds net
  // the same way in both reports); Other Movement is BS categories + net
  // party lending, same worked example as before.
  const cf = E.computeCashFlow(db, date, asOf);
  assert.strictEqual(cf.opening, 100000, "Opening Balance: bank1 100000 + card1 0 opening, nothing dated before the period");
  assert.strictEqual(cf.totalIn, pl.totalIncome, "Cash Flow's Money In total matches computePL's income exactly");
  assert.strictEqual(cf.totalOut, pl.totalExpense, "Cash Flow's Money Out total matches computePL's expense exactly");
  const rentRow = cf.moneyOut.find((r) => r.category === "Rent");
  assert.ok(rentRow && rentRow.amount === 20000, "Money Out breaks down by category");
  const emiRow = cf.other.find((r) => r.label === "Home Loan EMI");
  assert.ok(emiRow, "Other Movement includes the BS category");
  assert.strictEqual(emiRow.amount, -14000, "EMI cash flow row is a cash outflow");
  const lentRow = cf.other.find((r) => r.label.startsWith("Lent to"));
  assert.ok(lentRow && lentRow.label.includes("A"), "net lending party is grouped into a \"Lent to\" row");
  assert.strictEqual(lentRow.amount, -3000, "net lent amount (5000 lent - 2000 repaid)");
  assert.strictEqual(cf.totalOther, -17000, "Other Movement subtotal");
  assert.strictEqual(cf.net, cf.totalIn - cf.totalOut + cf.totalOther, "Net Cash Flow is Money In minus Money Out plus Other Movement");
  assert.strictEqual(cf.net, 39500, "Net Cash Flow value");
  assert.strictEqual(cf.closing, 139500, "Closing Balance: opening 100000 + net 39500 (transfers cancel out across the book)");

  // suggestHead / keywordOf
  assert.strictEqual(E.suggestHead(db, "ZEPTO ONLINE"), "Groceries", "auto-coding rule matches");
  assert.strictEqual(E.suggestHead(db, "UNKNOWN MERCHANT XYZ"), "Suspense", "no rule match falls back to Suspense");

  console.log("ok — simple app renders and the engine's worked example checks out to the rupee");

  await testPdfParser();
}

// Real Axis Bank ("Flipkart Visa") credit card statement layout, positional
// text extracted directly from an actual statement PDF (not synthesized) —
// this fixture is what caught the original gap: a single "Amount (INR)"
// column (not split Withdrawal/Deposit), a "Debit/Credit" type column, a
// "Transaction Details" narration header, and amount cells carrying a
// literal "₹" glyph, none of which the parser's header-label regexes or
// digit-prefix checks recognized before this fix. Also covers one row whose
// narration wraps onto two separate lines *around* the numeric row instead
// of sharing its line, the same class of bug the HDFC savings-account fix
// addressed earlier.
async function testPdfParser() {
  const pdf = await import(require("node:url").pathToFileURL(path.join(__dirname, "..", "src", "pdf.js")).href);
  const axisPage = [
    { x: 52, y: 552, s: "Date" }, { x: 152, y: 552, s: "Transaction Details" },
    { x: 352, y: 552, s: "Amount (INR)" }, { x: 452, y: 552, s: "Debit/Credit" },
    { x: 52, y: 528, s: "06 May '25" }, { x: 152, y: 528, s: "CASHBACK CREDIT APR 2025" },
    { x: 352, y: 528, s: "₹ 46.00" }, { x: 452, y: 528, s: "Credit" },
    { x: 52, y: 504, s: "04 May '25" }, { x: 152, y: 504, s: "Foreign Currency Transaction Fee" },
    { x: 352, y: 504, s: "₹ 617.86" }, { x: 452, y: 504, s: "Debit" },
    { x: 52, y: 400, s: "22 Apr '25" },
    { x: 152, y: 408, s: "BBPS Payment Received -" }, { x: 152, y: 392, s: "DP015112133842couvGb" },
    { x: 352, y: 400, s: "₹ 4,874.96" }, { x: 452, y: 400, s: "Credit" },
    { x: 52, y: 368, s: "14 Apr '25" }, { x: 152, y: 368, s: "ZEPTO MARKETPLACE PRIV,BANGALORE" },
    { x: 352, y: 368, s: "₹ 284.00" }, { x: 452, y: 368, s: "Debit" },
    { x: 240, y: 293, s: "**End of Transaction Summary**" },
  ];
  const rows = pdf.parsePdfTable([axisPage]);
  assert.strictEqual(rows.length, 4, "all 4 Axis transactions recovered, got: " + JSON.stringify(rows));
  const [r1, r2, r3, r4] = rows;
  assert.strictEqual(r1.date, "2025-05-06");
  assert.strictEqual(r1.amount, 46, "leading ₹ glyph stripped from the amount cell");
  assert.strictEqual(r1.type, "in", "\"Credit\" (not just \"Cr\") recognized as money-in");
  assert.strictEqual(r1.note, "CASHBACK CREDIT APR 2025", "note excludes the Debit/Credit type token");
  assert.strictEqual(r2.type, "out", "\"Debit\" recognized as money-out");
  assert.strictEqual(r3.amount, 4875, "amount with a thousands comma (₹ 4,874.96) rounds correctly");
  assert.ok(/BBPS Payment Received/.test(r3.note) && /DP015112133842couvGb/.test(r3.note),
    "narration wrapped onto two lines around (not on) the numeric row is still stitched together, got: " + r3.note);
  assert.strictEqual(r4.amount, 284);
  assert.ok(!rows.some((r) => /End of Transaction Summary/.test(r.note)), "trailing footer line isn't absorbed as a note fragment");

  console.log("ok — Axis Bank credit card PDF statement layout parses correctly");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
