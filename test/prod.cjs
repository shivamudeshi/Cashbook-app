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

  // Theme: Blue is the shipped default, and applyTheme swaps the shared C
  // token object's accent family in place (the mechanism the whole live
  // theme-switcher relies on) without touching its neutral/category tokens.
  assert.strictEqual(fresh.prefs.theme, "blue", "fresh books default to the blue theme");
  assert.ok(E.THEMES && E.THEMES.blue && E.THEMES.violet, "both themes are registered");
  const bgBefore = E.C.bg;
  E.applyTheme("violet");
  assert.strictEqual(E.C.accent, "#a78bfa", "applyTheme('violet') swaps C.accent to the legacy violet");
  assert.strictEqual(E.C.grad, "linear-gradient(135deg,#a78bfa,#6d28d9)", "C.grad follows the active theme too");
  assert.strictEqual(E.C.bg, bgBefore, "neutral/structural tokens are untouched by a theme swap");
  E.applyTheme("blue");
  assert.strictEqual(E.C.accent, "#6366f1", "applyTheme('blue') restores the default indigo");
  E.applyTheme("nonexistent");
  assert.strictEqual(E.C.accent, "#6366f1", "an unknown theme name falls back to blue rather than throwing");

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
  assert.strictEqual(migratedBook.v, 7, "a v6 book is migrated to v7 on load");
  assert.strictEqual(migratedBook.prefs.theme, "blue", "the v7 migration backfills prefs.theme to blue");

  console.log("ok — v6 book migrates to v7 with prefs.theme defaulted to blue");
  migDom.window.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
