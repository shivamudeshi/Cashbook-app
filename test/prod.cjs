// Mounts the REAL dist/app.js in jsdom and asserts it renders, then asserts
// the accounting engine (exposed as window.__cashbookEngine by the bundle)
// on a worked example. A clean esbuild bundle once shipped a "React is not
// defined" crash — this test exists so that can't happen again.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { indexedDB, IDBKeyRange, IDBFactory } = require("fake-indexeddb");

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

  // Trip spend: tagged entries fold into a per-trip total; untagged and
  // unexplained (Suspense) entries are excluded, and an "in" against a trip
  // nets as a refund — same shape as owedAsOf's filter-by-tag + isExplained.
  const dbT = {
    entries: [
      { id: "t1", date: "2025-06-01", amount: 3000, type: "out", head: "Food out", tripId: "goa" },
      { id: "t2", date: "2025-06-02", amount: 1500, type: "out", head: "Transport", tripId: "goa" },
      { id: "t3", date: "2025-06-03", amount: 500, type: "in", head: "Food out", tripId: "goa" }, // refund
      { id: "t4", date: "2025-06-04", amount: 2000, type: "out", head: "Shopping", tripId: "manali" },
      { id: "t5", date: "2025-06-05", amount: 4000, type: "out", head: "Rent" }, // untagged — must not count
      { id: "t6", date: "2025-06-06", amount: 1000, type: "out", head: "Suspense", tripId: "goa" }, // unexplained — must not count
      // Splitwise-style: a participant's "owed back" share carries the same
      // tripId as the real spend, purely so TripDetailPage's entry list
      // shows the full split — it must NEVER be summed as trip spend.
      { id: "t7", date: "2025-06-07", amount: 9999, type: "party", partyId: "p1", dir: "out", tripId: "goa" },
    ],
    heads: { income: [], expense: ["Food out", "Transport", "Shopping", "Rent", "Suspense"] },
    headClass: {},
    bsAccounts: [],
    parties: [{ id: "p1", name: "Friend" }],
    trips: [{ id: "goa", name: "Goa" }, { id: "manali", name: "Manali" }, { id: "empty", name: "Unplanned" }],
    opening: { asOf: "2025-06-01", bank: 0, accounts: {} },
    owedMemos: [],
  };
  const asOfT = "2025-06-30";
  const tripSpend = E.tripSpendAsOf(dbT, asOfT);
  const goa = tripSpend.find((t) => t.id === "goa");
  const manali = tripSpend.find((t) => t.id === "manali");
  const empty = tripSpend.find((t) => t.id === "empty");
  assert.strictEqual(goa.spent, 4000, "Goa: 3000 + 1500 − 500 refund, Suspense entry excluded, party share NOT counted");
  assert.strictEqual(goa.count, 3, "Goa count includes the refund but not the unexplained or party entries");
  assert.strictEqual(manali.spent, 2000, "Manali totals independently of Goa");
  assert.strictEqual(empty.spent, 0, "a trip with no tagged entries spends 0");
  assert.strictEqual(empty.count, 0, "a trip with no tagged entries has 0 count");

  // Investment holdings: a buy with a charge splits between cost basis and
  // the Finance charges expense; a later partial sell realizes a gain
  // (proceeds vs. the proportional average cost of the units sold) into
  // Capital gains income; the balance sheet must still foot both with a
  // live price snapshot (mark-to-market via the Unrealized gain/(loss)
  // plug) and without one (falls back to cost — the case gold always hits).
  const db4 = {
    entries: [
      { id: "h1", date: "2025-06-01", type: "holding", holdingId: "f1", dir: "buy", units: 80, amount: 10000, charge: 100 },
      { id: "h2", date: "2025-06-15", type: "holding", holdingId: "f1", dir: "sell", units: 40, amount: 5300 },
    ],
    heads: { income: ["Salary", "Capital gains"], expense: ["Rent", "Finance charges", "Suspense"] },
    headClass: {},
    bsAccounts: [],
    parties: [],
    holdings: [{ id: "f1", kind: "mf", instrumentId: "SCHEME1", label: "Test Fund", units: 0, costBasis: 0 }],
    opening: { asOf: "2025-06-01", bank: 100000, accounts: {} },
    owedMemos: [],
  };
  const asOf4 = "2025-06-30";
  const prices4 = { SCHEME1: { price: 130, asOf: asOf4 } };

  const hf1 = E.holdingsAsOf(db4, asOf4).find((h) => h.id === "f1");
  assert.strictEqual(hf1.units, 40, "80 bought, 40 sold, 40 remain");
  assert.strictEqual(hf1.costBasis, 4950, "cost basis: (10000-100) then half removed proportionally on the sell");

  assert.strictEqual(E.holdingsValue(hf1, prices4), 5200, "40 units x 130/unit live price");
  assert.strictEqual(E.holdingsValue(hf1, {}), 4950, "no price snapshot (e.g. gold) falls back to cost basis");

  // A "land" (Real Estate) holding is architecturally identical to gold —
  // a synthetic instrumentId that can never match a real price snapshot,
  // so it's permanently valued at cost, with zero engine changes needed.
  const landHolding = { id: "l1", kind: "land", instrumentId: "land:seed", label: "Flat in Pune", units: 1, costBasis: 2500000 };
  assert.strictEqual(E.holdingsValue(landHolding, prices4), 2500000, "a land holding is never found in any price snapshot — always values at cost");
  assert.strictEqual(E.holdingsValue(landHolding, {}), 2500000, "a land holding values at cost with no price snapshot at all, same as gold");

  const pl4 = E.computePL(db4, "2025-06-01", asOf4);
  assert.strictEqual(pl4.expense["Finance charges"], 100, "the buy's charge posts as a Finance charges expense");
  assert.strictEqual(pl4.income["Capital gains"], 350, "realized gain: 5300 proceeds - 4950 proportional cost");
  assert.strictEqual(pl4.net, 250, "net = 350 capital gains - 100 finance charge");

  const bal4 = E.balancesAsOf(db4, asOf4);
  assert.strictEqual(bal4.bank, 95300, "bank: 100000 - 10000 (buy) + 5300 (sell)");

  const bsWithPrice = E.computeBS(db4, asOf4, prices4);
  assert.ok(bsWithPrice.balanced, "balance sheet foots with a live price snapshot (mark-to-market)");
  assert.strictEqual(bsWithPrice.totalAssets, 100500, "bank 95300 + holdings market value 5200");

  const bsAtCost = E.computeBS(db4, asOf4);
  assert.ok(bsAtCost.balanced, "balance sheet foots with no price snapshot at all (values at cost)");
  assert.strictEqual(bsAtCost.totalAssets, 100250, "bank 95300 + holdings at cost 4950");

  // Opening holdings: an investment bought before this book existed, seeded
  // via opening.holdings the same way opening.accounts seeds a starting
  // account balance — no transaction entry, so it never touches bank. A
  // later sell against it must still work off the seeded cost basis.
  const db5 = {
    entries: [
      { id: "s1", date: "2025-07-10", type: "holding", holdingId: "g1", dir: "sell", units: 20, amount: 4500 },
    ],
    heads: { income: ["Salary", "Capital gains"], expense: ["Rent", "Finance charges", "Suspense"] },
    headClass: {},
    bsAccounts: [],
    parties: [],
    holdings: [{ id: "g1", kind: "gold", instrumentId: "gold:seed", label: "Opening Gold", units: 0, costBasis: 0 }],
    opening: { asOf: "2025-07-01", bank: 50000, accounts: {}, holdings: { g1: { units: 50, costBasis: 8000 } } },
    owedMemos: [],
  };
  const asOf5 = "2025-07-31";
  const hg1 = E.holdingsAsOf(db5, "2025-07-05").find((h) => h.id === "g1");
  assert.strictEqual(hg1.units, 50, "opening units apply even with zero transactions before this date");
  assert.strictEqual(hg1.costBasis, 8000, "opening cost basis applies with zero transactions");
  const bal5 = E.balancesAsOf(db5, asOf5);
  assert.strictEqual(bal5.bank, 54500, "opening holdings never move bank — only the sell entry's own amount does (50000 + 4500)");
  const pl5 = E.computePL(db5, "2025-07-01", asOf5);
  assert.strictEqual(pl5.income["Capital gains"], 1300, "realized gain off the seeded cost basis: 4500 proceeds - (8000 * 20/50) proportional cost");
  const bs5 = E.computeBS(db5, asOf5);
  assert.ok(bs5.balanced, "balance sheet foots with an opening holding position mixed in");

  // Helpers.
  assert.strictEqual(E.parseAmount("2k"), 2000);
  assert.strictEqual(E.parseAmount("1.2L"), 120000);
  assert.strictEqual(E.parseAmount("1,250"), 1250);
  assert.ok(isNaN(E.parseAmount("abc")));
  assert.strictEqual(E.inr(120000), "₹1,20,000", "Indian grouping");

  // Decimal/paise precision: amounts round to the nearest paisa (not the
  // nearest rupee), and money() shows exactly 2 decimals when there's a
  // fractional part but none for a whole-rupee amount — so a fractional
  // stamp-duty charge is preserved exactly and NAV-scale figures don't get
  // silently rounded away.
  assert.strictEqual(E.parseAmount("12.5"), 12.5, "fractional charges are no longer rounded to the nearest rupee");
  assert.strictEqual(E.parseAmount("12.3456"), 12.35, "parseAmount still rounds to the nearest paisa, not unbounded float precision");
  assert.strictEqual(E.money({}, 500), "₹500", "a whole-rupee amount shows no decimals");
  assert.strictEqual(E.money({}, 12.5), "₹12.50", "a fractional amount always shows exactly 2 decimals");
  assert.strictEqual(E.money({}, -12.5), "−₹12.50", "sign handled for fractional amounts too");
  assert.strictEqual(E.navPrice({}, 13.0697), "₹13.0697", "NAV keeps up to 4 decimal places, matching AMFI's own precision");
  assert.strictEqual(E.navPrice({}, 96), "₹96", "a whole NAV shows no decimals");
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

  // Columnar PDF table parser, second shape: an HDFC-style savings-account
  // statement, where date + the START of the narration + every numeric
  // column sit on ONE line (not split across a before/after wrap like the
  // Union Bank case above), and a second date-shaped "Value Dt" column sits
  // just left of Withdrawal. Column x/y below are synthetic but mirror the
  // real layout exactly (verified against an actual HDFC PDF, not just
  // guessed): a Withdrawal figure can land almost exactly equidistant
  // between the Withdrawal and Deposit header LABELS' own x (since data is
  // right-aligned within a column that starts at the label's x) — nearest-
  // single-point-distance picks the wrong column on a near-tie like that;
  // range-based classification (this column starts here, the next starts
  // there) does not. The statement also spans 2 pages where only the FIRST
  // page repeats the column header — a real, common statement-generator
  // behavior this parser must carry the header forward through, while still
  // skipping the repeated letterhead/address block above it on the
  // continuation page (which would otherwise be misread as narration).
  const hdfcPage1 = [
    // repeated per-page letterhead, above the header
    { x: 290, y: 820, s: "Page No .: 1" },
    { x: 34, y: 790, s: "MR. JOHN Q TESTER" },
    { x: 340, y: 760, s: "Statement of account" },
    // header row
    { x: 40, y: 602, s: "Date" }, { x: 144, y: 602, s: "Narration" }, { x: 284, y: 602, s: "Chq./Ref.No." },
    { x: 362, y: 602, s: "Value Dt" }, { x: 405, y: 602, s: "Withdrawal Amt." }, { x: 491, y: 602, s: "Deposit Amt." },
    { x: 564, y: 602, s: "Closing Balance" },
    // tx1: withdrawal, date+narration-start+numbers on one line, one wrap after
    { x: 34, y: 584, s: "01/05/26" }, { x: 72, y: 584, s: "PAYMENT TO ACME CORP" }, { x: 289, y: 584, s: "0000111122223333" },
    { x: 362, y: 584, s: "01/05/26" }, { x: 442, y: 584, s: "5,000.00" }, { x: 599, y: 584, s: "12,000.00" },
    { x: 72, y: 567, s: "REF NUMBER TAIL 998877" },
    // tx2: withdrawal figure (448) sits almost exactly equidistant between
    // the Withdrawal (405) and Deposit (491) header labels' own x — the
    // exact real-world near-tie this fix targets.
    { x: 34, y: 550, s: "02/05/26" }, { x: 72, y: 550, s: "COFFEE SHOP PURCHASE" }, { x: 289, y: 550, s: "0000222233334444" },
    { x: 362, y: 550, s: "02/05/26" }, { x: 448, y: 550, s: "150.00" }, { x: 599, y: 550, s: "11,850.00" },
    // tx3: deposit
    { x: 34, y: 516, s: "03/05/26" }, { x: 72, y: 516, s: "SALARY CREDIT ACME" }, { x: 289, y: 516, s: "0000333344445555" },
    { x: 362, y: 516, s: "03/05/26" }, { x: 534, y: 516, s: "2,000.00" }, { x: 599, y: 516, s: "13,850.00" },
    { x: 72, y: 499, s: "EMPLOYER PAYROLL REF" },
  ];
  const hdfcPage2 = [
    // same letterhead Y positions as page 1, but different page-number text
    // — the continuation-page skip must key off Y, not exact text, since
    // "Page No .: 2" legitimately differs from "Page No .: 1".
    { x: 290, y: 820, s: "Page No .: 2" },
    { x: 34, y: 790, s: "MR. JOHN Q TESTER" },
    { x: 340, y: 760, s: "Statement of account" },
    // NO header row repeated on this page — real data starts right after
    // the letterhead, at y=610: ABOVE where page 1's own header sat
    // (y=602), which is exactly the off-by-one-line trap a naive "skip
    // everything above the carried header's Y" cutoff falls into.
    { x: 34, y: 610, s: "05/05/26" }, { x: 72, y: 610, s: "ONLINE STORE PURCHASE" }, { x: 289, y: 610, s: "0000444455556666" },
    { x: 362, y: 610, s: "05/05/26" }, { x: 442, y: 610, s: "300.00" }, { x: 599, y: 610, s: "13,550.00" },
    { x: 34, y: 580, s: "06/05/26" }, { x: 72, y: 580, s: "REFUND FROM STORE" }, { x: 289, y: 580, s: "0000555566667777" },
    { x: 362, y: 580, s: "06/05/26" }, { x: 534, y: 580, s: "500.00" }, { x: 599, y: 580, s: "14,050.00" },
  ];
  const hdfcRows = E.parsePdfTable([hdfcPage1, hdfcPage2]);
  assert.strictEqual(hdfcRows.length, 5, "all 5 transactions recovered across both pages, got: " + JSON.stringify(hdfcRows));
  const [h1, h2, h3, h4, h5] = hdfcRows;
  assert.deepStrictEqual([h1.date, h1.amount, h1.type], ["2026-05-01", 5000, "out"]);
  assert.ok(/ACME CORP/.test(h1.note), "note includes the payee, got: " + h1.note);
  assert.deepStrictEqual(
    [h2.date, h2.amount, h2.type], ["2026-05-02", 150, "out"],
    "a withdrawal figure almost equidistant between the two column labels' own x still resolves to Withdrawal, not Deposit"
  );
  assert.deepStrictEqual([h3.date, h3.amount, h3.type], ["2026-05-03", 2000, "in"]);
  assert.ok(!/Value Dt|Ref\.?No/i.test(h1.note + h2.note + h3.note), "the Value Dt/Ref No columns never leak into a note as if they were narration");
  assert.deepStrictEqual(
    [h4.date, h4.amount, h4.type], ["2026-05-05", 300, "out"],
    "page 2's transactions are recovered even though it never repeats the column header"
  );
  assert.deepStrictEqual([h5.date, h5.amount, h5.type], ["2026-05-06", 500, "in"]);
  for (const r of hdfcRows) {
    assert.ok(!/Page No|Statement of account|JOHN Q TESTER/.test(r.note), "the repeated per-page letterhead never leaks into a transaction's note, got: " + r.note);
  }

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
  assert.strictEqual(fresh.prefs.bankName, "Bank", "fresh books default the primary account's display name to Bank");

  // Theme: a single "Royal Sapphire" (dark) / "Navy Professional" (light)
  // glass identity with a light/dark pair. applyTheme swaps the shared C
  // token object's FULL palette in place (accent family + bg/ink/surface/
  // overlay/decorative-color tokens) -- the mechanism the whole live
  // theme-switcher relies on.
  assert.strictEqual(fresh.prefs.theme, "dark", "fresh books default to the dark Royal Sapphire theme");
  assert.ok(E.THEMES && E.THEMES.dark && E.THEMES.light, "both theme entries are registered");
  assert.strictEqual(E.THEMES.dark.mode, "dark");
  assert.strictEqual(E.THEMES.light.mode, "light");

  E.applyTheme("light");
  assert.strictEqual(E.C.accent, "#16357a", "applyTheme('light') swaps C.accent to the Navy Professional accent");
  assert.strictEqual(E.C.grad, "linear-gradient(135deg,#16357a,#0b1d45)", "C.grad follows the active theme too");
  assert.strictEqual(E.C.mode, "light", "a light theme flips C.mode");
  assert.strictEqual(E.C.colorScheme, "light", "a light theme flips the native form-control color-scheme too");
  assert.strictEqual(E.C.bg, "#f3f5f9", "a light theme actually changes the background, not just the accent");
  assert.notStrictEqual(E.C.ink, "#eef3fb", "ink flips to a dark color on the light theme (not the dark theme's near-white)");
  assert.ok(/^rgba\(11,24,53,/.test(E.C.overlayBorder), "the light theme's overlay scale is ink-tinted, not the dark theme's white-based scale");
  assert.strictEqual(E.C.dc[0], "#16357a", "light mode's decorative-color slots are navy tints");
  assert.strictEqual(E.C.iconGlow, "none", "light mode's icon glow is a guaranteed no-op");

  E.applyTheme("dark");
  assert.strictEqual(E.C.accent, "#3b82f6", "applyTheme('dark') restores the dark Royal Sapphire accent");
  assert.strictEqual(E.C.bg, "#050912", "switching back to dark restores the dark background");
  assert.strictEqual(E.C.mode, "dark", "switching back to dark restores dark mode");
  assert.strictEqual(E.C.dc[0], "#3b82f6", "dark mode's decorative-color slots keep the vivid hue");
  E.applyTheme("nonexistent");
  assert.strictEqual(E.C.accent, "#3b82f6", "an unknown theme name falls back to dark rather than throwing");

  console.log("ok — app renders and the balance sheet foots to the rupee");
  window.close();

  // Migration v7: a pre-existing v6 book (no prefs.theme) must come out of
  // loadBook() upgraded to v7 with prefs.theme defaulted to "blue" — run
  // via a second, fully isolated bundle mount against a fresh in-memory
  // IndexedDB seeded directly (bypassing the app) with v6-shaped data.
  const migIndexedDB = new IDBFactory();
  const seedReq = migIndexedDB.open("cashbook", 1);
  await new Promise((resolve, reject) => {
    seedReq.onupgradeneeded = () => seedReq.result.createObjectStore("kv");
    seedReq.onsuccess = () => {
      const db = seedReq.result;
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(
        {
          v: 6,
          entries: [], heads: { income: [], expense: ["Suspense"] }, headClass: {},
          bsAccounts: [], parties: [], opening: { asOf: "2025-01-01", bank: 0, accounts: {}, holdings: {} },
          owedMemos: [], codingRules: [],
          prefs: { currency: "₹", dateFmt: "dmy", notifs: {}, lock: { on: false, pin: "" } }, // no theme key — the v6 shape
          budgets: {}, partyNotes: [], holdings: [],
        },
        "book"
      );
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    seedReq.onerror = () => reject(seedReq.error);
  });

  const migDom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { runScripts: "dangerously", pretendToBeVisual: true, url: "https://cashbook.test/" }
  );
  migDom.window.indexedDB = migIndexedDB;
  migDom.window.IDBKeyRange = IDBKeyRange;
  migDom.window.eval(fs.readFileSync(BUNDLE, "utf8"));
  await new Promise((r) => setTimeout(r, 400));

  const readBack = migIndexedDB.open("cashbook", 1);
  const migratedBook = await new Promise((resolve, reject) => {
    readBack.onsuccess = () => {
      const db = readBack.result;
      const req = db.transaction("kv", "readonly").objectStore("kv").get("book");
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => reject(req.error);
    };
    readBack.onerror = () => reject(readBack.error);
  });
  assert.strictEqual(migratedBook.v, 10, "a v6 book is migrated to v10 on load");
  assert.strictEqual(migratedBook.prefs.theme, "dark", "the v7+v10 migrations backfill prefs.theme to the dark default");
  assert.deepStrictEqual(migratedBook.trips, [], "the v8 migration backfills an empty trips array");
  assert.strictEqual(migratedBook.prefs.bankName, "Bank", "the v9 migration backfills prefs.bankName to Bank");

  console.log("ok — v6 book migrates to v10 with prefs.theme/bankName defaulted and trips backfilled");
  migDom.window.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
