// Mounts the REAL dist/app.js in jsdom and asserts it renders, then asserts
// the accounting engine (exposed as window.__cashbookEngine by the bundle)
// on a worked example. A clean esbuild bundle once shipped a "React is not
// defined" crash — this test exists so that can't happen again.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { indexedDB, IDBKeyRange } = require("fake-indexeddb");

const BUNDLE = path.join(__dirname, "..", "dist", "app.js");

async function main() {
  assert.ok(fs.existsSync(BUNDLE), "dist/app.js missing — run `npm run build` first");

  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { runScripts: "dangerously", pretendToBeVisual: true, url: "https://cashbook.test/" }
  );
  const { window } = dom;
  window.indexedDB = indexedDB;
  window.IDBKeyRange = IDBKeyRange;

  window.eval(fs.readFileSync(BUNDLE, "utf8"));

  // Let the async IndexedDB load resolve and React commit.
  await new Promise((r) => setTimeout(r, 400));

  const text = window.document.body.textContent;
  for (const expected of ["Cash Book", "Book", "Owed", "Reports", "Plan", "Setup", "Bank balance", "Import"]) {
    assert.ok(text.includes(expected), `rendered app should contain "${expected}"`);
  }

  /* ── engine: worked example ── */
  const E = window.__cashbookEngine;
  assert.ok(E, "bundle should expose window.__cashbookEngine");

  const db = {
    entries: [
      { id: "e1", date: "2025-04-05", amount: 80000, type: "in", head: "Salary" },
      { id: "e2", date: "2025-04-06", amount: 20000, type: "out", head: "Rent" },
      { id: "e3", date: "2025-04-07", amount: 10000, type: "out", head: "SIP" }, // classed → Investments
      { id: "e4", date: "2025-04-08", amount: 5000, type: "transfer", account: "Investments", dir: "out" },
      { id: "e5", date: "2025-04-09", amount: 2000, type: "transfer", account: "Credit card", dir: "in" }, // borrow
      { id: "e6", date: "2025-04-10", amount: 15000, type: "party", partyId: "p1", dir: "out" }, // lent
      { id: "e7", date: "2025-04-12", amount: 5000, type: "party", partyId: "p1", dir: "in" }, // repaid
    ],
    heads: { income: ["Salary"], expense: ["Rent", "SIP", "Suspense"] },
    headClass: { SIP: "Investments" },
    bsAccounts: [
      { name: "Investments", kind: "asset" },
      { name: "Credit card", kind: "liability" },
    ],
    parties: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
    opening: { asOf: "2025-04-01", bank: 100000, accounts: { Investments: 50000, "Credit card": 10000 } },
    owedMemos: [{ id: "m1", partyId: "p2", amount: -3000, date: "2025-04-11", note: "" }], // I owe B
  };
  const asOf = "2025-04-30";

  // P&L: cash basis — SIP (classed), transfers and party entries stay out.
  const pl = E.computePL(db, "2025-04-01", asOf);
  assert.strictEqual(pl.totalIncome, 80000, "income");
  assert.strictEqual(pl.totalExpense, 20000, "expenses exclude SIP/transfers/party");
  assert.strictEqual(pl.expense.SIP, undefined, "SIP must be absent from P&L expenses");
  assert.strictEqual(pl.net, 60000, "net");

  // Balances.
  const bal = E.balancesAsOf(db, asOf);
  assert.strictEqual(bal.bank, 137000, "bank");
  assert.strictEqual(bal.accounts.Investments, 65000, "Investments = opening + SIP + transfer");
  assert.strictEqual(bal.accounts["Credit card"], 12000, "Credit card grows when borrowing");

  // Owed auto-fills from bank data + memos.
  const owed = E.owedAsOf(db, asOf);
  const pA = owed.perParty.find((p) => p.id === "p1");
  const pB = owed.perParty.find((p) => p.id === "p2");
  assert.strictEqual(pA.balance, 10000, "party A: 15000 lent − 5000 repaid");
  assert.strictEqual(pA.cash, 10000, "party A balance is all cash-derived");
  assert.strictEqual(pB.balance, -3000, "party B: memo creditor");
  assert.strictEqual(owed.debtors, 10000, "debtors total");
  assert.strictEqual(owed.creditors, 3000, "creditors total");
  assert.strictEqual(owed.memoNet, -3000, "accruals reserve = memo components only");

  // Balance sheet must foot to the rupee.
  const bs = E.computeBS(db, asOf);
  assert.strictEqual(bs.totalAssets, 212000, "assets = bank + investments + debtors");
  assert.strictEqual(bs.totalLiabilities, 15000, "liabilities = card + creditors");
  assert.strictEqual(bs.totalEquity, 197000, "equity = derived capital + retained + reserve");
  assert.ok(bs.balanced, "Assets = Liabilities + Equity");
  const capital = bs.equity.find((r) => r.name === "Opening capital");
  assert.strictEqual(capital.amount, 140000, "opening capital is derived");

  // Helpers.
  assert.strictEqual(E.parseAmount("2k"), 2000);
  assert.strictEqual(E.parseAmount("1.2L"), 120000);
  assert.strictEqual(E.parseAmount("1,250"), 1250);
  assert.ok(isNaN(E.parseAmount("abc")));
  assert.strictEqual(E.inr(120000), "₹1,20,000", "Indian grouping");
  assert.strictEqual(E.fyOf("2026-03-31"), 2025, "March belongs to previous FY");
  assert.strictEqual(E.fyOf("2026-04-01"), 2026);
  assert.strictEqual(E.quarterOf("2026-07-09"), 2, "Jul = Q2");
  assert.strictEqual(E.quarterOf("2026-02-01"), 4);

  // Default book sanity: sheet balances from day one, Suspense head exists.
  const fresh = E.defaultBook();
  assert.ok(E.computeBS(fresh, "2099-12-31").balanced, "fresh book balances");
  assert.ok(fresh.heads.expense.includes("Suspense"), "Suspense head present");
  assert.ok(fresh.parties.length >= 2, "placeholder parties seeded");

  console.log("ok — app renders and the balance sheet foots to the rupee");
  window.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
