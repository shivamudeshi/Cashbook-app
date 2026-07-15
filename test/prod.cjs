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
  for (const expected of ["Cash Book", "Dashboard", "Owed", "Transactions", "Reports", "Setup", "Net Worth", "Quick Actions"]) {
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

  // Unexplained (Suspense) entries are excluded from Bank/P&L/Owed until
  // re-coded; a refund (type "in" tagged with an EXPENSE head) nets against
  // that head instead of counting as unrelated income — and the balance
  // sheet must still foot with a mix of all of this in one book.
  const db2 = {
    entries: [
      { id: "x1", date: "2025-05-01", amount: 1000, type: "out", head: "Rent" }, // explained spend
      { id: "x2", date: "2025-05-02", amount: 2000, type: "out", head: "Suspense" }, // unexplained — must not count
      { id: "x3", date: "2025-05-03", amount: 400, type: "in", head: "Rent" }, // refund against Rent
      { id: "x4", date: "2025-05-04", amount: 500, type: "in", head: "Suspense" }, // unexplained — must not count
    ],
    heads: { income: ["Salary"], expense: ["Rent", "Suspense"] },
    headClass: {},
    bsAccounts: [],
    parties: [],
    opening: { asOf: "2025-05-01", bank: 10000, accounts: {} },
    owedMemos: [],
  };
  const asOf2 = "2025-05-31";

  assert.strictEqual(E.isExplained(db2.entries[0]), true, "real head is explained");
  assert.strictEqual(E.isExplained(db2.entries[1]), false, "Suspense out is unexplained");
  assert.strictEqual(E.isExplained(db2.entries[2]), true, "refund with a real head is explained");
  assert.strictEqual(E.isExplained(db2.entries[3]), false, "Suspense in is unexplained");
  assert.strictEqual(E.isRefund(db2, db2.entries[2]), true, "an 'in' entry tagged with an expense head is a refund");
  assert.strictEqual(E.isRefund(db2, db2.entries[0]), false, "an 'out' entry is never a refund");

  const bal2 = E.balancesAsOf(db2, asOf2);
  assert.strictEqual(bal2.bank, 9400, "bank only moves for explained entries: 10000 - 1000 + 400");

  const pl2 = E.computePL(db2, "2025-05-01", asOf2);
  assert.strictEqual(pl2.expense.Rent, 600, "refund nets against Rent: 1000 spent - 400 refunded");
  assert.strictEqual(pl2.totalIncome, 0, "the refund never lands in income");
  assert.strictEqual(pl2.net, -600, "net matches the true cash effect of the explained entries");

  const bs2 = E.computeBS(db2, asOf2);
  assert.ok(bs2.balanced, "balance sheet still foots with unexplained + refund entries mixed in");
  assert.strictEqual(bs2.totalAssets, 9400, "assets reflect only the explained bank movement");

  // Row icon/color: curated category, Suspense, transfer, party, and an
  // unmatched custom head all resolve to something renderable.
  const db3 = { ...db2, parties: [{ id: "p1", name: "Alex" }], bsAccounts: [{ name: "Investments", kind: "asset" }] };
  const rentVisual = E.entryVisual(db3, { type: "out", head: "Rent" });
  assert.deepStrictEqual([rentVisual.kind, rentVisual.icon], ["icon", "home"], "Rent matches the curated home icon");
  const suspenseVisual = E.entryVisual(db3, { type: "out", head: "Suspense" });
  assert.strictEqual(suspenseVisual.icon, "tag", "unexplained entries get the neutral tag icon");
  const partyVisual = E.entryVisual(db3, { type: "party", partyId: "p1", dir: "out" });
  assert.deepStrictEqual([partyVisual.kind, partyVisual.name], ["avatar", "Alex"], "party entries show that party's own avatar");
  const transferVisual = E.entryVisual(db3, { type: "transfer", account: "Investments", dir: "out" });
  assert.deepStrictEqual([transferVisual.kind, transferVisual.icon], ["icon", "trend"], "an Investments transfer matches the curated invest icon");
  const customVisual = E.entryVisual(db3, { type: "out", head: "Golf Club Dues" });
  assert.strictEqual(customVisual.kind, "avatar", "an unmatched custom head falls back to a colored-letter avatar");
  assert.strictEqual(customVisual.name, "Golf Club Dues");
  assert.strictEqual(
    E.entryVisual(db3, { type: "out", head: "Golf Club Dues" }).index,
    customVisual.index,
    "the fallback color is deterministic for the same head"
  );

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

  // Local statement parser: dates in mixed formats, trailing balance column,
  // Cr marker for credits, header lines skipped.
  const sample = [
    "Date Description Debit Credit Balance",
    "01/05/2025 UPI-SWIGGY BANGALORE 450.00 12,550.00",
    "02/05/2025 NEFT SALARY ACME CORP CR 80,000.00 92,550.00",
    "03-05-2025 ATM WITHDRAWAL 2,000.00 90,550.00",
    "Closing balance 90,550.00",
  ].join("\n");
  const txs = E.parseStatementText(sample);
  assert.strictEqual(txs.length, 3, "three transaction lines parsed");
  assert.deepStrictEqual(
    [txs[0].date, txs[0].amount, txs[0].type],
    ["2025-05-01", 450, "out"],
    "amount is the second-last number when a balance column exists"
  );
  assert.ok(txs[0].note.includes("SWIGGY"), "note keeps the description");
  assert.deepStrictEqual([txs[1].amount, txs[1].type], [80000, "in"], "CR marker → in");
  assert.deepStrictEqual([txs[2].date, txs[2].amount], ["2025-05-03", 2000], "dd-mm-yyyy parsed");

  // Columnar PDF table parser: reproduces the real bug found in a Union
  // Bank of India statement — the narration cell wraps to a line before and
  // a line after the row that actually carries the date/amount/balance, and
  // the balance itself always prints "<amount> Cr", which must NOT be read
  // as the transaction's own direction. Item x/y mirrors actual pdf.js
  // output: a Withdrawal column (~x338) and a Deposit column (~x426), both
  // well clear of the Balance column (~x513).
  const pdfPage = [
    // header row
    { x: 29, y: 518, s: "SI" }, { x: 64, y: 518, s: "Date" }, { x: 150, y: 518, s: "Particulars" },
    { x: 263, y: 518, s: "Chq Num" }, { x: 338, y: 518, s: "Withdrawal" }, { x: 426, y: 518, s: "Deposit" },
    { x: 513, y: 518, s: "Balance" },
    // withdrawal, narration wraps around the numeric row
    { x: 105, y: 483, s: "AMAZON PAY INDIA PVT" },
    { x: 35, y: 477, s: "2" }, { x: 50, y: 477, s: "02-06-2025" }, { x: 363, y: 477, s: "1,250.00" }, { x: 517, y: 477, s: "45,000.00 Cr" },
    { x: 105, y: 472, s: "LTD REF9988776655" },
    // deposit, narration wraps around the numeric row
    { x: 105, y: 462, s: "NEFT SALARY ACME CORP" },
    { x: 35, y: 456, s: "3" }, { x: 50, y: 456, s: "03-06-2025" }, { x: 439, y: 456, s: "80,000.00" }, { x: 517, y: 456, s: "1,25,000.00 Cr" },
    { x: 105, y: 451, s: "PVT LTD HDFC0001234" },
  ];
  const pdfRows = E.parsePdfTable([pdfPage]);
  assert.strictEqual(pdfRows.length, 2, "two transaction rows recovered from the columnar page");
  const [wd, dep] = pdfRows;
  assert.deepStrictEqual(
    [wd.date, wd.amount, wd.type],
    ["2025-06-02", 1250, "out"],
    "amount column position (not the trailing balance Cr) decides direction"
  );
  assert.ok(/AMAZON/.test(wd.note) && /REF9988776655/.test(wd.note), "note stitches the before+after wrapped narration lines, got: " + wd.note);
  assert.deepStrictEqual([dep.date, dep.amount, dep.type], ["2025-06-03", 80000, "in"], "deposit column recognised despite balance also saying Cr");
  assert.ok(/SALARY/.test(dep.note) && /HDFC0001234/.test(dep.note), "note stitches wrapped narration for the deposit row too, got: " + dep.note);

  // Keyword coder + learning keyword extraction.
  const ruleDb = { codingRules: [{ match: "swiggy", head: "Food out" }] };
  assert.strictEqual(E.suggestHead(ruleDb, "UPI-SWIGGY BANGALORE"), "Food out");
  assert.strictEqual(E.suggestHead(ruleDb, "mystery shop"), "Suspense");
  assert.strictEqual(E.keywordOf("UPI-SWIGGY BANGALORE"), "swiggy", "skips upi/neft noise words");

  // Bank-SMS share-target parser.
  const sms1 = E.parseBankSms(
    "Rs.450.00 debited from A/c XX1234 on 05/07/26 at SWIGGY BANGALORE via UPI. Avl bal Rs.10,000"
  );
  assert.deepStrictEqual(
    [sms1.amount, sms1.type, sms1.date],
    [450, "out", "2026-07-05"],
    "debit SMS → out with SMS date"
  );
  assert.ok(/swiggy/i.test(sms1.note), "merchant captured in note");
  const sms2 = E.parseBankSms("INR 80,000 credited to your account from ACME CORP on 01/07/2026");
  assert.deepStrictEqual([sms2.amount, sms2.type], [80000, "in"], "credit SMS → in");
  assert.strictEqual(E.parseBankSms("Your OTP is 482910"), null, "non-money SMS rejected");

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
