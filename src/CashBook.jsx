import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { loadBook, saveBook, DEFAULT_CODING_RULES } from "./storage.js";

// pdf.js touches browser-only APIs (DOMMatrix) the moment its module runs, so
// it is loaded lazily on first PDF import — esbuild defers evaluation of the
// bundled module until this call.
async function getPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.mjs";
  return pdfjsLib;
}

// Tesseract OCR, also lazy. Assets are self-hosted under ocr/ (copied from
// node_modules by the build) and runtime-cached by the service worker, so
// after the first ~9MB download recognition is free and offline.
async function getOcrWorker(onProgress) {
  const { createWorker } = await import("tesseract.js");
  const base = new URL("ocr/", window.location.href).href;
  const worker = createWorker("eng", 1, {
    workerPath: base + "worker.min.js",
    corePath: base,
    langPath: base,
    gzip: true,
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round((m.progress || 0) * 100));
      }
    },
  });
  // A failed worker script never settles the promise — surface it instead.
  return Promise.race([
    worker,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("The reader didn't start — check the connection for the one-time download and try again.")), 90000)
    ),
  ]);
}

/* ────────────────────────── palette & type ──────────────────────────
   Emerald fintech, dark: near-black charcoal surfaces, emerald for the
   balance and money-in, warm coral for money-out. `olive` keeps its name
   as the primary-action slot; `paper` is the app background; `creamText`
   is the on-primary text color. */
/* Violet glass design system (from the user's Claude Design project
   "Cash Book.dc.html"): near-black aubergine ground, frosted glass panels,
   violet gradient actions, gradient icon orbs per stat family. */
export const C = {
  bg: "#050308",
  ink: "#f1ecfb",
  soft: "#e4d9f5",
  muted: "#a99cc9",
  faint: "#8a7fae",
  accent: "#a78bfa",
  accentDeep: "#6d28d9",
  accentText: "#c4a6ff",
  grad: "linear-gradient(135deg,#a78bfa,#6d28d9)",
  glass: "linear-gradient(160deg, rgba(255,255,255,.10), rgba(255,255,255,.02))",
  glassSoft: "linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.02))",
  border: "1px solid rgba(255,255,255,.14)",
  borderSoft: "1px solid rgba(255,255,255,.10)",
  line: "rgba(255,255,255,.08)",
  chip: "rgba(255,255,255,.06)",
  tile: "rgba(255,255,255,.05)",
  shadow: "0 20px 40px -22px rgba(0,0,0,.6)",
  green: "#6ee7b7",
  greenGrad: "linear-gradient(135deg,#34d399,#047857)",
  red: "#fda4af",
  redGrad: "linear-gradient(135deg,#fb7185,#9f1239)",
  amberGrad: "linear-gradient(135deg,#fbbf24,#b45309)",
  blueGrad: "linear-gradient(135deg,#60a5fa,#2563eb)",
  skyGrad: "linear-gradient(135deg,#38bdf8,#0369a1)",
  indigoGrad: "linear-gradient(135deg,#6366f1,#4338ca)",
  tealGrad: "linear-gradient(135deg,#2dd4bf,#0f766e)",
  pinkGrad: "linear-gradient(135deg,#e879f9,#a21caf)",
  grayGrad: "linear-gradient(135deg,#71717a,#3f3f46)",
  sheetBg: "linear-gradient(170deg,#171029,#0c0716)",
  navBg: "rgba(13,10,23,.94)",
  amber: "#fbbf24",
  // legacy aliases still used by the money-direction coloring
  credit: "#6ee7b7",
  debit: "#fda4af",
};
export const F = {
  serif: '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  sans: '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

/* Keyframes and state-driven styles (:active, :focus) can't be inline —
   this sheet is injected once at the app root. */
const ANIM_CSS = `
html { scroll-behavior: smooth; }
@keyframes cbFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes cbSlideUp { from { transform: translateY(48px); opacity: .4; } to { transform: none; opacity: 1; } }
@keyframes cbSlideIn { from { transform: translateX(56px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes cbFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes cbSplashPop {
  0% { transform: scale(.55); opacity: 0; }
  60% { transform: scale(1.06); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes cbSplashRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.cb-view { animation: cbFadeUp .32s cubic-bezier(.2,.8,.3,1) both; }
.cb-subpage { animation: cbSlideIn .3s cubic-bezier(.2,.8,.3,1) both; }
.cb-stagger > * { animation: cbFadeUp .34s cubic-bezier(.2,.8,.3,1) both; }
.cb-stagger > *:nth-child(2) { animation-delay: .04s; }
.cb-stagger > *:nth-child(3) { animation-delay: .08s; }
.cb-stagger > *:nth-child(4) { animation-delay: .12s; }
.cb-stagger > *:nth-child(5) { animation-delay: .16s; }
.cb-stagger > *:nth-child(6) { animation-delay: .2s; }
.cb-row { animation: cbFadeIn .3s ease both; }
.cb-sheet-overlay { animation: cbFadeIn .2s ease both; }
.cb-sheet { animation: cbSlideUp .32s cubic-bezier(.2,.9,.3,1) both; }
.cb-press { transition: transform .12s ease, filter .15s ease, background .2s ease, color .2s ease; }
.cb-press:active { transform: scale(.96); }
.cb-fab { transition: transform .15s ease, box-shadow .2s ease; }
.cb-fab:active { transform: scale(.9); }
.cb-tab { transition: color .2s ease, transform .15s ease; }
.cb-tab:active { transform: translateY(1px); }
.cb-splash-glyph { animation: cbSplashPop .55s cubic-bezier(.2,.8,.3,1) both; }
.cb-splash-name { animation: cbSplashRise .5s .25s ease both; }
.cb-splash-out { transition: opacity .35s ease; opacity: 0 !important; pointer-events: none; }
.cb-header { position: sticky; top: 0; z-index: 15; backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  background: rgba(6,4,10,.55); border-bottom: 1px solid rgba(255,255,255,.08); }
@keyframes cbListIn { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }
@keyframes cbChipPop { from { transform: scale(.88); opacity: .5; } to { transform: scale(1); opacity: 1; } }
@keyframes cbCheckPop { 0% { transform: scale(.3); opacity: 0; } 65% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
@keyframes cbRingPulse { 0% { transform: scale(.8); opacity: .7; } 100% { transform: scale(1.5); opacity: 0; } }
.cb-list-in { animation: cbListIn .42s cubic-bezier(.2,.85,.3,1) both; }
.cb-chip-pop { animation: cbChipPop .22s cubic-bezier(.3,.9,.3,1) both; }
.cb-check-pop { animation: cbCheckPop .5s cubic-bezier(.3,1.4,.4,1) both; }
.cb-carousel::-webkit-scrollbar { display: none; }
.cb-carousel { scrollbar-width: none; }
input::placeholder { color: #7a6f95; }
input, select { transition: border-color .18s ease, box-shadow .18s ease; }
input:focus, select:focus { outline: none; border-color: #a78bfa !important; box-shadow: 0 0 0 3px rgba(167,139,250,.18); }
@media (prefers-reduced-motion: reduce) {
  .cb-view, .cb-row, .cb-sheet, .cb-sheet-overlay, .cb-subpage, .cb-list-in,
  .cb-chip-pop, .cb-check-pop,
  .cb-stagger > *, .cb-splash-glyph, .cb-splash-name { animation: none; }
  .cb-press, .cb-fab, .cb-tab, input, select { transition: none; }
  html { scroll-behavior: auto; }
}
@media print {
  body { background: #fff !important; }
  .cb-header, .cb-noprint { display: none !important; }
}
`;

/* ─────────────── bank SMS → entry (Android share-target) ───────────────
   The user shares a bank SMS to the app; this extracts amount, direction and
   a merchant-ish note. Returns null when the text doesn't look like money. */
export function parseBankSms(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const amtM = t.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!amtM) return null;
  const amount = Math.round(parseFloat(amtM[1].replace(/,/g, "")));
  if (!amount) return null;
  const low = t.toLowerCase();
  let type = null;
  if (/\b(debited|spent|paid|withdrawn|purchase|sent)\b/.test(low)) type = "out";
  else if (/\b(credited|received|deposited|refund)\b/.test(low)) type = "in";
  if (!type) return null;
  // merchant / counterparty: "at X", "to X", "from X", or a UPI VPA
  let note = "";
  const m =
    t.match(/(?:\bat|\bto|\bfrom)\s+([A-Za-z0-9 &.\-*_']{3,40}?)(?=\s+(?:on|via|ref|upi|a\/c|avl|bal|info)\b|[.,;]|$)/i) ||
    t.match(/([\w.\-]{2,}@[\w]{2,})/);
  if (m) note = m[1].trim();
  const dm = t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  let date = today();
  if (dm) {
    let y = +dm[3];
    if (y < 100) y += 2000;
    const mo = +dm[2], d = +dm[1];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) date = `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  return { amount, type, note, date };
}

/* ────────────────────────── money helpers ────────────────────────── */
export function inr(n) {
  const v = Math.round(n);
  return (v < 0 ? "−" : "") + "₹" + Math.abs(v).toLocaleString("en-IN");
}

export function parseAmount(s) {
  if (typeof s === "number") return Math.round(s);
  if (!s) return NaN;
  const t = String(s).replace(/[₹,\s]/g, "").toLowerCase();
  const m = t.match(/^(\d+(?:\.\d+)?)(k|l|lac|lakh|lakhs|cr|crore)?$/);
  if (!m) return NaN;
  const mult =
    { k: 1e3, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7 }[
      m[2]
    ] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

/* ─────────────────── calendar: Indian FY (Apr–Mar) ─────────────────── */
export function fyOf(date) {
  const y = +date.slice(0, 4);
  return +date.slice(5, 7) >= 4 ? y : y - 1;
}
export function quarterOf(date) {
  const m = +date.slice(5, 7);
  return m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
}
const pad2 = (n) => String(n).padStart(2, "0");
export function fyRange(fy, q = 0) {
  if (!q) return [`${fy}-04-01`, `${fy + 1}-03-31`];
  const startM = [null, 4, 7, 10, 1][q];
  const y = q === 4 ? fy + 1 : fy;
  const endM = startM + 2;
  const last = new Date(y, endM, 0).getDate();
  return [`${y}-${pad2(startM)}-01`, `${y}-${pad2(endM)}-${pad2(last)}`];
}
// mIdx 0..11 = Apr..Mar of the given FY
export function monthRange(fy, mIdx) {
  const m = ((mIdx + 3) % 12) + 1;
  const y = mIdx < 9 ? fy : fy + 1;
  const last = new Date(y, m, 0).getDate();
  return [`${y}-${pad2(m)}-01`, `${y}-${pad2(m)}-${pad2(last)}`];
}
const MONTH_NAMES = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/* ────────────────────────── engine ──────────────────────────
   Cash basis. Every entry has Bank on one side (implicit); the other side
   is a P&L head, a balance-sheet account (transfer / classed head), or a
   party (lend/borrow — never P&L). Invariant: Assets = Liabilities + Equity. */

// A freshly-imported (or manually parked) entry sits in the reserved
// "Suspense" head until the user confirms a real category for it — until
// then it's "unexplained" and stays out of every balance/report. Transfer
// and party entries never carry a head, so they're always explained.
export function isExplained(e) {
  if (e.type === "in" || e.type === "out") return e.head !== "Suspense";
  return true;
}

// Money received back for something already paid (a refund) is tagged with
// an EXPENSE head instead of an income head — computePL nets it against
// that head's spend rather than counting it as unrelated income.
export function isRefund(db, e) {
  return e.type === "in" && !!(db.heads && db.heads.expense || []).includes(e.head);
}

export function computePL(db, from, to) {
  const income = {}, expense = {};
  for (const e of db.entries) {
    if (e.type !== "in" && e.type !== "out") continue;
    if (!isExplained(e)) continue;
    if (e.date < from || e.date > to) continue;
    if (db.headClass && db.headClass[e.head]) continue; // posts to a BS account
    if (isRefund(db, e)) {
      expense[e.head] = (expense[e.head] || 0) - e.amount;
    } else {
      const bag = e.type === "in" ? income : expense;
      bag[e.head] = (bag[e.head] || 0) + e.amount;
    }
  }
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const totalIncome = sum(income), totalExpense = sum(expense);
  return { income, expense, totalIncome, totalExpense, net: totalIncome - totalExpense };
}

export function balancesAsOf(db, asOf) {
  let bank = (db.opening && db.opening.bank) || 0;
  const accounts = {}, kind = {};
  for (const a of db.bsAccounts) {
    accounts[a.name] = (db.opening && db.opening.accounts && db.opening.accounts[a.name]) || 0;
    kind[a.name] = a.kind;
  }
  // dir "out" = money left the bank toward the account
  const post = (name, dir, amt) => {
    if (!(name in accounts)) return; // account no longer exists; bank leg still counts
    const assetDelta = dir === "out" ? amt : -amt;
    accounts[name] += kind[name] === "liability" ? -assetDelta : assetDelta;
  };
  for (const e of db.entries) {
    if (e.date > asOf) continue;
    if (!isExplained(e)) continue;
    if (e.type === "transfer") {
      bank += e.dir === "in" ? e.amount : -e.amount;
      post(e.account, e.dir, e.amount);
    } else if (e.type === "party") {
      bank += e.dir === "in" ? e.amount : -e.amount;
    } else {
      bank += e.type === "in" ? e.amount : -e.amount;
      const acct = db.headClass && db.headClass[e.head];
      if (acct) post(acct, e.type, e.amount);
    }
  }
  return { bank, accounts };
}

// Auto-fills Owed from bank data: each party's balance is the cash component
// (bank entries tagged to the party) plus the memo component (manual items
// that never touched the bank). Positive = debtor, negative = creditor.
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

export function computeBS(db, asOf) {
  const bal = balancesAsOf(db, asOf);
  const owed = owedAsOf(db, asOf);
  const pl = computePL(db, "0000-01-01", asOf);

  const assets = [{ name: "Bank", amount: bal.bank }];
  const liabilities = [];
  for (const a of db.bsAccounts) {
    (a.kind === "liability" ? liabilities : assets).push({
      name: a.name,
      amount: bal.accounts[a.name],
    });
  }
  assets.push({ name: "Debtors", amount: owed.debtors });
  liabilities.push({ name: "Creditors", amount: owed.creditors });

  // Opening capital is derived — never user-set — so the sheet always foots.
  let openingCapital = (db.opening && db.opening.bank) || 0;
  for (const a of db.bsAccounts) {
    const o = (db.opening && db.opening.accounts && db.opening.accounts[a.name]) || 0;
    openingCapital += a.kind === "liability" ? -o : o;
  }
  // Accruals reserve offsets only the memo component: cash lent/borrowed is an
  // asset swap with Bank, but memos must stay off the cash-basis P&L.
  const equity = [
    { name: "Opening capital", amount: openingCapital },
    { name: "Retained surplus", amount: pl.net },
    { name: "Accruals reserve", amount: owed.memoNet },
  ];

  const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0);
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity);
  return {
    assets, liabilities, equity,
    totalAssets, totalLiabilities, totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

/* ────────────────────────── default book ────────────────────────── */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function defaultBook() {
  return {
    entries: [],
    heads: {
      income: ["Salary", "Interest", "Other income"],
      expense: ["Rent", "Groceries", "Food out", "Transport", "Utilities",
                "Shopping", "Health", "SIP", "Suspense"],
    },
    headClass: { SIP: "Investments" },
    bsAccounts: [
      { name: "Investments", kind: "asset" },
      { name: "Credit card", kind: "liability" },
    ],
    parties: [
      { id: uid(), name: "Party 1" },
      { id: uid(), name: "Party 2" },
      { id: uid(), name: "Party 3" },
    ],
    opening: { asOf: today(), bank: 0, accounts: {} },
    owedMemos: [],
    codingRules: DEFAULT_CODING_RULES.map((r) => ({ ...r })),
    prefs: {
      currency: "₹",
      dateFmt: "dmy",
      notifs: { backup: true, suspense: true, dues: true },
      lock: { on: false, pin: "" },
    },
    budgets: {},
    partyNotes: [],
  };
}

function normalizeBook(j) {
  const d = defaultBook();
  const b = { ...d, ...j };
  b.heads = { ...d.heads, ...(j.heads || {}) };
  b.opening = { ...d.opening, ...(j.opening || {}) };
  if (!b.opening.accounts) b.opening.accounts = {};
  for (const k of ["entries", "bsAccounts", "parties", "owedMemos", "codingRules", "partyNotes"]) {
    if (!Array.isArray(b[k])) b[k] = d[k];
  }
  if (!b.headClass) b.headClass = {};
  if (!b.budgets) b.budgets = {};
  b.prefs = { ...d.prefs, ...(j.prefs || {}) };
  b.prefs.notifs = { ...d.prefs.notifs, ...((j.prefs || {}).notifs || {}) };
  b.prefs.lock = { ...d.prefs.lock, ...((j.prefs || {}).lock || {}) };
  return b;
}

/* ─────────────────── local statement parsing (free, on-device) ─────────────────── */
const MONTHS3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
                  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const DATE_RE =
  /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b|\b(\d{1,2})[ \-]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ \-,']*(\d{2,4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/i;

function ymdFromDateMatch(dm) {
  let y, m, d;
  if (dm[1]) { d = +dm[1]; m = +dm[2]; y = +dm[3]; }
  else if (dm[4]) { d = +dm[4]; m = MONTHS3[dm[5].toLowerCase()]; y = +dm[6]; }
  else { y = +dm[7]; m = +dm[8]; d = +dm[9]; }
  if (y < 100) y += 2000;
  if (!m || m > 12 || !d || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// Heuristic statement-line parser. A transaction line = a date + at least one
// amount; when a trailing running balance is present the amount is the
// second-last number. Direction comes from Dr/Cr-style markers, defaulting to
// "out" (the review screen lets the user flip anything). This is the
// fallback used for CSV/Excel/OCR text and any PDF whose table shape
// parsePdfTable() below doesn't recognise.
export function parseStatementText(text) {
  const dateRe = DATE_RE;
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/[|;"]+/g, " ").trim();
    if (!line) continue;
    const dm = line.match(dateRe);
    if (!dm) continue;
    let y, m, d;
    if (dm[1]) { d = +dm[1]; m = +dm[2]; y = +dm[3]; }
    else if (dm[4]) { d = +dm[4]; m = MONTHS3[dm[5].toLowerCase()]; y = +dm[6]; }
    else { y = +dm[7]; m = +dm[8]; d = +dm[9]; }
    if (y < 100) y += 2000;
    if (!m || m > 12 || !d || d > 31 || y < 1990 || y > 2100) continue;
    const date = `${y}-${pad2(m)}-${pad2(d)}`;

    const rest = line.replace(dm[0], " ");
    const nums = [...rest.matchAll(/\d[\d,]*(?:\.\d{1,2})?/g)]
      .map((t) => ({ v: parseFloat(t[0].replace(/,/g, "")), i: t.index, raw: t[0] }))
      .filter((n) => Number.isFinite(n.v) && n.v > 0);
    if (!nums.length) continue;
    const amtTok = nums.length >= 2 ? nums[nums.length - 2] : nums[0];
    const amount = Math.round(amtTok.v);
    if (!amount) continue;

    const low = line.toLowerCase();
    let type = /\b(cr|credit|deposit|received)\b/.test(low) ? "in" : "out";

    let note = rest
      .slice(0, amtTok.i)
      .replace(/\b(dr|cr|debit|credit|deposit|withdrawal|w\/d)\b/gi, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s\-–—:,.]+|[\s\-–—:,.]+$/g, "")
      .slice(0, 60);
    rows.push({ date, amount, type, note });
  }
  return rows;
}

// First matching keyword rule wins; unknowns land in Suspense for re-coding.
export function suggestHead(db, note) {
  const low = (note || "").toLowerCase();
  for (const r of db.codingRules || []) {
    if (r.match && low.includes(r.match.toLowerCase())) return r.head;
  }
  return "Suspense";
}

// The keyword the importer learns when the user re-codes a row: the first
// reasonably distinctive word of the note.
export function keywordOf(note) {
  const words = (note || "").toLowerCase().match(/[a-z]{4,}/g) || [];
  const skip = new Set(["upi", "neft", "imps", "rtgs", "bank", "transfer", "payment", "toward", "from"]);
  return words.find((w) => !skip.has(w)) || words[0] || "";
}

// Per-page positioned text items — x/y kept so a table's column layout can be
// read directly, instead of only the flattened, order-guessed text below.
async function extractPdfPages(file) {
  const pdfjsLib = await getPdfjs();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      items.push({ x: it.transform[4], y: Math.round(it.transform[5]), s: it.str });
    }
    pages.push(items);
  }
  return pages;
}

function pdfGroupLines(items) {
  const byY = new Map();
  for (const it of items) {
    if (!byY.has(it.y)) byY.set(it.y, []);
    byY.get(it.y).push(it);
  }
  return [...byY.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, its]) => {
      const sorted = its.slice().sort((a, b) => a.x - b.x);
      return { y, items: sorted, text: sorted.map((i) => i.s).join(" ") };
    });
}

/* ── columnar PDF table parser ──
 * Many Indian bank statement PDFs lay out a real table (SI · Date ·
 * Particulars · Withdrawal · Deposit · Balance, or Date · Description ·
 * Debit · Credit · Balance, etc). Because the narration cell often wraps to
 * 2 lines while the numeric cells don't, flattening a page's text purely by
 * y-coordinate interleaves a transaction's narration around its own numeric
 * row instead of alongside it — parseStatementText() then reads
 * the numeric row alone and finds little or no note text there, and can
 * misread the trailing running-balance "Cr"/"Dr" as the transaction's own
 * direction. This reads column position instead of guessing from text
 * order: it locates the header row's column x-positions, anchors each
 * transaction on its date, and pulls the amount/direction from whichever
 * amount column is physically closest, and the note from every narration
 * line nearest that same row (by y-distance), however many lines it wraps
 * to. Returns [] if a page's layout doesn't look like a table it can read
 * confidently — callers should fall back to parseStatementText() then. */
const PDF_NOISE_RE = /^\d+\s+of\s+\d+$/i;
const PDF_STOP_RE = /closing balance|total (debit|credit)s?|other account details|^summary\s*:?$/i;
const PDF_LABEL_RE =
  /^(si|date|particulars|narration|description|transaction remarks|remarks|details|chq num|withdrawal|deposit|balance|debit|credit|amount|type|dr\/cr|cr\/dr)\.?$/i;

function pdfFindHeader(lines) {
  const DATE_LBL = /^(date|txn date|value date)$/i;
  const NARR_LBL = /^(particulars|narration|description|transaction remarks|remarks|details)$/i;
  const WITHDRAWAL_LBL = /^(withdrawal|debit)(\s*amt\.?)?$/i;
  const DEPOSIT_LBL = /^(deposit|credit)(\s*amt\.?)?$/i;
  const AMOUNT_LBL = /^amount$/i;
  const TYPE_LBL = /^(dr\/cr|cr\/dr|type)$/i;
  const BALANCE_LBL = /^balance$/i;

  for (let li = 0; li < lines.length; li++) {
    let dateX, narrX, wX, dX, amtX, typeX, balX;
    for (const it of lines[li].items) {
      const s = it.s.trim();
      if (DATE_LBL.test(s)) dateX = it.x;
      else if (NARR_LBL.test(s)) narrX = it.x;
      else if (WITHDRAWAL_LBL.test(s)) wX = it.x;
      else if (DEPOSIT_LBL.test(s)) dX = it.x;
      else if (AMOUNT_LBL.test(s)) amtX = it.x;
      else if (TYPE_LBL.test(s)) typeX = it.x;
      else if (BALANCE_LBL.test(s)) balX = it.x;
    }
    if (dateX == null || narrX == null) continue;
    if (wX != null && dX != null) return { headerIndex: li, dateX, mode: "split", withdrawalX: wX, depositX: dX, balanceX: balX };
    if (amtX != null && typeX != null) return { headerIndex: li, dateX, mode: "typed", amountX: amtX, typeX, balanceX: balX };
  }
  return null;
}

// Leading numeric value of an item's own text, e.g. "2,11,586.20 Cr" -> 211586.2.
function pdfLeadingNumber(s) {
  const m = s.trim().match(/^\d[\d,]*(?:\.\d{1,2})?/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : null;
}

function parsePdfTablePage(items) {
  const lines = pdfGroupLines(items);
  const hdr = pdfFindHeader(lines);
  if (!hdr) return [];

  const anchors = [];
  const fragments = [];
  for (let li = hdr.headerIndex + 1; li < lines.length; li++) {
    const line = lines[li];
    const trimmed = line.text.trim();
    if (PDF_STOP_RE.test(trimmed)) break;
    if (!trimmed || PDF_NOISE_RE.test(trimmed)) continue;

    const dm = line.text.match(DATE_RE);
    const dateItem = dm && line.items.find((it) => it.s.includes(dm[0].trim()) || dm[0].trim().includes(it.s.trim()));
    const date = dm && ymdFromDateMatch(dm);

    if (date && dateItem) {
      // Candidate amount items: to the right of the Date column, start with a digit.
      const candidates = line.items
        .filter((it) => it.x > hdr.dateX + 5 && /^\d/.test(it.s.trim()))
        .map((it) => ({ it, v: pdfLeadingNumber(it.s) }))
        .filter((c) => Number.isFinite(c.v) && c.v > 0);

      let amount, type;
      if (hdr.mode === "split") {
        let best = null;
        for (const c of candidates) {
          const dw = Math.abs(c.it.x - hdr.withdrawalX);
          const dd = Math.abs(c.it.x - hdr.depositX);
          const db = hdr.balanceX != null ? Math.abs(c.it.x - hdr.balanceX) : Infinity;
          const min = Math.min(dw, dd, db);
          if (min === db) continue; // nearest the balance column — skip
          if (!best || min < best.dist) best = { dist: min, amount: Math.round(c.v), type: dw < dd ? "out" : "in" };
        }
        if (best) { amount = best.amount; type = best.type; }
      } else {
        let best = null;
        for (const c of candidates) {
          const da = Math.abs(c.it.x - hdr.amountX);
          const db = hdr.balanceX != null ? Math.abs(c.it.x - hdr.balanceX) : Infinity;
          if (da > db) continue;
          if (!best || da < best.dist) best = { dist: da, amount: Math.round(c.v) };
        }
        if (best) {
          amount = best.amount;
          const typeTok = line.items.find((it) => Math.abs(it.x - hdr.typeX) < 40);
          type = typeTok && /^cr/i.test(typeTok.s.trim()) ? "in" : "out";
        }
      }

      if (amount) {
        const inline = line.items
          .filter((it) => it.x > hdr.dateX + 5 && it !== dateItem && !/^\d/.test(it.s.trim()))
          .map((it) => it.s)
          .join(" ")
          .trim();
        anchors.push({ y: line.y, date, amount, type, pieces: inline ? [{ y: line.y, text: inline }] : [] });
        continue;
      }
    }

    // A line with no date and no item that starts with a digit (an actual
    // amount-shaped token, as opposed to a reference number embedded in a
    // merchant string like "HDFCH01031352354") is a wrapped narration line.
    const looksNumeric = line.items.some((it) => /^\d/.test(it.s.trim()));
    if (!dm && !looksNumeric && !PDF_LABEL_RE.test(trimmed)) fragments.push({ y: line.y, text: trimmed });
  }

  for (const f of fragments) {
    let best = null;
    for (const a of anchors) {
      const dist = Math.abs(a.y - f.y);
      if (dist > 40) continue;
      if (!best || dist < best.dist) best = { a, dist };
    }
    if (best) best.a.pieces.push({ y: f.y, text: f.text });
  }

  return anchors.map((a) => ({
    date: a.date,
    amount: a.amount,
    type: a.type,
    note: a.pieces
      .sort((p, q) => q.y - p.y)
      .map((p) => p.text)
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 80),
  }));
}

// Exposed so npm test can drive it directly with a synthetic item list —
// this is the function that fixes the wrapped-narration/wrong-direction bug.
export function parsePdfTable(pages) {
  return pages.flatMap(parsePdfTablePage);
}

// Exposed so npm test can assert the engine on the REAL production bundle.
if (typeof window !== "undefined") {
  window.__cashbookEngine = {
    inr, parseAmount, fyOf, quarterOf, fyRange, monthRange,
    computePL, balancesAsOf, owedAsOf, computeBS, defaultBook,
    parseStatementText, suggestHead, keywordOf, parseBankSms, parsePdfTable,
    isExplained, isRefund,
  };
}

/* ────────────────────────── shared UI bits ────────────────────────── */
const clone = (o) => JSON.parse(JSON.stringify(o));

// OCR a photo or a rendered PDF page. `src` is a File/Blob or a canvas.
async function ocrRecognize(worker, src) {
  const { data } = await worker.recognize(src);
  return data.text || "";
}

// Render each page of a scanned PDF to a canvas for OCR.
async function pdfPagesToCanvases(file, onPage) {
  const pdfjsLib = await getPdfjs();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    out.push(canvas);
    if (onPage) onPage(p, pdf.numPages);
  }
  return out;
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
export function compareRange(span, fy, from, to, mode) {
  if (mode === "prev") {
    if (span === "year") return fyRange(fy - 1);
    if (span.startsWith("q")) {
      const q = +span[1];
      return q > 1 ? fyRange(fy, q - 1) : fyRange(fy - 1, 4);
    }
    if (span.startsWith("m")) {
      const i = +span.slice(1);
      return i > 0 ? monthRange(fy, i - 1) : monthRange(fy - 1, 11);
    }
    const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    const pTo = addDays(from, -1);
    return [addDays(pTo, -(days - 1)), pTo];
  }
  if (span === "year") return fyRange(fy - 1);
  if (span.startsWith("q")) return fyRange(fy - 1, +span[1]);
  if (span.startsWith("m")) return monthRange(fy - 1, +span.slice(1));
  return [shiftYear(from, -1), shiftYear(to, -1)];
}

/* display formatting driven by prefs */
const cur = (book) => (book && book.prefs && book.prefs.currency) || "₹";
function money(book, n) {
  const v = Math.round(n || 0);
  return (v < 0 ? "−" : "") + cur(book) + Math.abs(v).toLocaleString("en-IN");
}
function compactMoney(book, n) {
  const v = Math.abs(Math.round(n || 0));
  const sign = n < 0 ? "−" : "";
  const c = cur(book);
  if (v >= 1e7) return `${sign}${c}${(v / 1e7).toFixed(v % 1e7 ? 1 : 0)}Cr`;
  if (v >= 1e5) return `${sign}${c}${(v / 1e5).toFixed(v % 1e5 ? 1 : 0)}L`;
  if (v >= 1e3) return `${sign}${c}${(v / 1e3).toFixed(v % 1e3 ? 1 : 0)}K`;
  return `${sign}${c}${v}`;
}
function fmtDate(book, iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const f = (book && book.prefs && book.prefs.dateFmt) || "dmy";
  if (f === "mdy") return `${m}-${d}-${y}`;
  if (f === "ymd") return `${y}-${m}-${d}`;
  return `${d}-${m}-${y}`;
}
function prettyDate(d) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
function monthShort(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { month: "short" });
}

const partyName = (book, id) =>
  (book.parties.find((p) => p.id === id) || { name: "Unknown" }).name;

function entryLabel(book, e) {
  if (e.type === "transfer")
    return e.dir === "out" ? `To ${e.account}` : `From ${e.account}`;
  if (e.type === "party")
    return e.dir === "out"
      ? `Paid ${partyName(book, e.partyId)}`
      : `From ${partyName(book, e.partyId)}`;
  return e.head;
}
const entrySign = (e) =>
  e.type === "in" || ((e.type === "transfer" || e.type === "party") && e.dir === "in") ? 1 : -1;

// Eased count-up for hero figures; snaps instantly under reduced motion.
function useCountUp(target, ms = 650) {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) { setV(target); return; }
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (target - from) * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/* small inline icon set (feather-style strokes) */
function Ic({ name, size = 15, stroke = "#fff", sw = 2.2 }) {
  const P = {
    bank: <><line x1="3" y1="21" x2="21" y2="21" /><line x1="5" y1="21" x2="5" y2="10" /><line x1="10" y1="21" x2="10" y2="10" /><line x1="14" y1="21" x2="14" y2="10" /><line x1="19" y1="21" x2="19" y2="10" /><polygon points="12 3 21 9 3 9" /></>,
    card: <><rect x="2" y="5" width="20" height="14" rx="2.5" /><line x1="2" y1="10" x2="22" y2="10" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
    search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></>,
    people: <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><circle cx="17.5" cy="9" r="2.6" /><path d="M16 14.4c3 .3 5.5 2.4 5.5 5.6" /></>,
    pie: <><path d="M21.2 12A9.2 9.2 0 1 1 12 2.8" /><path d="M12 2.8V12h9.2" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    list: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
    shield: <><path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10z" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
    gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></>,
    trend: <><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></>,
    wallet: <><rect x="2" y="6" width="20" height="14" rx="3" /><path d="M2 10h20" /><circle cx="17" cy="15" r="1.2" /></>,
    coins: <><circle cx="9" cy="9" r="6" /><path d="M15.5 6.6A6 6 0 1 1 8.6 15.5" /></>,
    tag: <><path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
    check: <><polyline points="20 6 9 17 4 12" /></>,
    flip: <><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
    info: <><circle cx="12" cy="12" r="9" /><line x1="12" y1="10" x2="12" y2="16" /><circle cx="12" cy="7.4" r="0.6" /></>,
    home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
    swap: <><polyline points="7 4 3 8 7 12" /><path d="M3 8h13" /><polyline points="17 12 21 16 17 20" /><path d="M21 16H8" /></>,
    calendar: <><rect x="3" y="4" width="18" height="17" rx="2.5" /><line x1="3" y1="9.5" x2="21" y2="9.5" /><line x1="8" y1="2.5" x2="8" y2="6" /><line x1="16" y1="2.5" x2="16" y2="6" /></>,
    trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  }[name];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={stroke}
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P}
    </svg>
  );
}

const AVATARS = [C.grad, C.greenGrad, C.blueGrad, C.amberGrad, C.pinkGrad, C.tealGrad, C.indigoGrad, C.redGrad];
const avatarBg = (i) => AVATARS[i % AVATARS.length];
const SLICE_COLORS = ["#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#e879f9", "#2dd4bf", "#fb7185", "#71717a"];

/* glass primitives */
const glass = (r = 24) => ({
  background: C.glass, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
  border: C.border, borderRadius: r, boxShadow: C.shadow,
});
const st = {
  input: {
    width: "100%", boxSizing: "border-box", padding: "11px 14px",
    borderRadius: 12, border: "1px solid rgba(255,255,255,.16)",
    background: "rgba(255,255,255,.06)", fontSize: 15, fontFamily: F.sans,
    color: C.ink, colorScheme: "dark",
  },
  label: {
    display: "block", fontSize: 11, color: C.muted, margin: "14px 0 6px",
    textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700,
  },
  h1: { fontSize: 22, fontWeight: 800, color: C.ink, marginBottom: 2 },
  sub: { fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 14 },
  section: { fontSize: 15, fontWeight: 800, color: C.ink },
  eyebrow: { fontSize: 11, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em", margin: "2px 2px 8px" },
};

function PrimaryBtn({ style, danger, ...props }) {
  return (
    <button
      className="cb-press"
      style={{
        padding: "13px 0", border: "none", borderRadius: 14,
        background: danger ? C.redGrad : C.grad, color: "#fff",
        fontWeight: 800, fontSize: 14, fontFamily: F.sans, cursor: "pointer", ...style,
      }}
      {...props}
    />
  );
}
function GhostBtn({ style, ...props }) {
  return (
    <button
      className="cb-press"
      style={{
        padding: "13px 0", border: "1px solid rgba(255,255,255,.18)", borderRadius: 14,
        background: "rgba(255,255,255,.06)", color: C.ink,
        fontWeight: 700, fontSize: 13, fontFamily: F.sans, cursor: "pointer", ...style,
      }}
      {...props}
    />
  );
}
function RoundBtn({ style, children, ...props }) {
  return (
    <button
      className="cb-press"
      style={{
        width: 34, height: 34, borderRadius: 999, border: "1px solid rgba(255,255,255,.14)",
        background: "rgba(255,255,255,.06)", display: "flex", alignItems: "center",
        justifyContent: "center", cursor: "pointer", flexShrink: 0, ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}

function Seg({ options, value, onChange, size = 12.5 }) {
  return (
    <div style={{
      display: "flex", gap: 6, background: C.chip, backdropFilter: "blur(16px)",
      border: C.border, borderRadius: 16, padding: 4,
    }}>
      {options.map((o) => (
        <button
          key={o.v}
          className="cb-press"
          onClick={() => onChange(o.v)}
          style={{
            flex: 1, border: "none", borderRadius: 12, padding: "9px 0",
            fontSize: size, fontWeight: 700, fontFamily: F.sans, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            background: value === o.v ? C.grad : "transparent",
            color: value === o.v ? "#fff" : C.muted,
          }}
        >
          {o.label}
          {o.badge != null && o.badge > 0 && (
            <span style={{
              background: C.amber, color: "#1c1024", borderRadius: 999,
              padding: "1px 7px", fontSize: 10.5, fontWeight: 800,
            }}>
              {o.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function FilterChip({ label, active, onClick, pop }) {
  return (
    <button
      className={"cb-press" + (pop ? " cb-chip-pop" : "")}
      onClick={onClick}
      style={{
        padding: "7px 13px", borderRadius: 999, fontSize: 12, fontWeight: 700,
        fontFamily: F.sans, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
        border: `1px solid ${active ? "rgba(167,139,250,.5)" : "rgba(255,255,255,.16)"}`,
        background: active ? "rgba(167,139,250,.18)" : "rgba(255,255,255,.06)",
        color: active ? C.accentText : C.soft,
      }}
    >
      {label}
    </button>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button
      className="cb-press"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      style={{
        width: 44, height: 26, borderRadius: 999, border: "none", cursor: "pointer",
        background: on ? C.grad : "rgba(255,255,255,.14)", position: "relative", padding: 0, flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: on ? 20 : 2, width: 22, height: 22,
        borderRadius: 999, background: "#fff", display: "block",
        boxShadow: "0 2px 4px rgba(0,0,0,.3)", transition: "left .18s ease",
      }} />
    </button>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      className="cb-sheet-overlay"
      style={{
        position: "fixed", inset: 0, background: "rgba(3,2,6,.65)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-end", zIndex: 30,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cb-sheet"
        style={{
          width: "100%", maxWidth: 480, margin: "0 auto", maxHeight: "88vh",
          overflowY: "auto", boxSizing: "border-box",
          background: C.sheetBg, border: C.border,
          borderTop: "1px solid rgba(255,255,255,.22)",
          borderRadius: "24px 24px 0 0",
          padding: "16px 18px calc(22px + env(safe-area-inset-bottom))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 800, flex: 1, color: C.ink }}>{title}</div>
          <button
            className="cb-press"
            onClick={onClose}
            style={{
              border: "1px solid rgba(255,255,255,.18)", background: "rgba(255,255,255,.06)",
              color: C.ink, padding: "7px 14px", borderRadius: 10, fontSize: 13,
              fontWeight: 700, fontFamily: F.sans, cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Chips({ options, value, onChange, render }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => (
        <button
          key={o}
          className="cb-press"
          onClick={() => onChange(o)}
          style={{
            padding: "7px 12px", borderRadius: 999, fontSize: 13, fontWeight: 700,
            fontFamily: F.sans, cursor: "pointer",
            border: `1px solid ${value === o ? "rgba(167,139,250,.5)" : "rgba(255,255,255,.16)"}`,
            background: value === o ? "rgba(167,139,250,.18)" : "rgba(255,255,255,.05)",
            color: value === o ? C.accentText : C.soft,
          }}
        >
          {render ? render(o) : o}
        </button>
      ))}
    </div>
  );
}

function AmountField({ book, value, onChange }) {
  const parsed = parseAmount(value);
  return (
    <div>
      <input
        style={{ ...st.input, fontSize: 22, fontWeight: 700 }}
        inputMode="decimal"
        placeholder="Amount — 500, 2k, 1.2L"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <div style={{ fontSize: 12, color: isNaN(parsed) ? C.red : C.muted, marginTop: 4 }}>
          {isNaN(parsed) ? "Can't read that amount" : `= ${money(book, parsed)}`}
        </div>
      )}
    </div>
  );
}

function Avatar({ name, index, size = 34 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 999, background: avatarBg(index),
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 800, color: "#fff", flexShrink: 0,
    }}>
      {(name || "?").trim().charAt(0).toUpperCase()}
    </div>
  );
}

function Orb({ grad, shadow, children, size = 48, radius = 999 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, background: grad,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      boxShadow: shadow || "0 6px 14px -4px rgba(0,0,0,.5)",
    }}>
      {children}
    </div>
  );
}

/* ────────────────────── derived account + notif models ────────────────────── */
function accountModels(book) {
  const t = today();
  const bal = balancesAsOf(book, t);
  const monthStart = t.slice(0, 8) + "01";
  let bIn = 0, bOut = 0;
  const acctFlow = {};
  for (const a of book.bsAccounts) acctFlow[a.name] = { in: 0, out: 0 };
  for (const e of book.entries) {
    if (e.date < monthStart || e.date > t) continue;
    if (!isExplained(e)) continue;
    entrySign(e) > 0 ? (bIn += e.amount) : (bOut += e.amount);
    if (e.type === "transfer" && acctFlow[e.account]) {
      // money moving INTO the account is a transfer out of the bank
      e.dir === "out" ? (acctFlow[e.account].in += e.amount) : (acctFlow[e.account].out += e.amount);
    } else if ((e.type === "in" || e.type === "out") && book.headClass[e.head] && acctFlow[book.headClass[e.head]]) {
      e.type === "out"
        ? (acctFlow[book.headClass[e.head]].in += e.amount)
        : (acctFlow[book.headClass[e.head]].out += e.amount);
    }
  }
  const looksLikeCard = (a) => a.kind === "liability";
  return [
    { id: "bank", type: "bank", kind: "asset", name: "Bank", last4: book.prefs.bankLast4 || "", balance: bal.bank, monthIn: bIn, monthOut: bOut },
    ...book.bsAccounts.map((a) => ({
      id: "acct:" + a.name,
      type: looksLikeCard(a) ? "credit_card" : "bank",
      kind: a.kind,
      name: a.name,
      last4: a.last4 || "",
      balance: bal.accounts[a.name] || 0,
      monthIn: acctFlow[a.name] ? acctFlow[a.name].in : 0,
      monthOut: acctFlow[a.name] ? acctFlow[a.name].out : 0,
    })),
  ];
}

function computeNotifs(book) {
  const list = [];
  const n = book.prefs.notifs || {};
  if (n.suspense) {
    const c = book.entries.filter((e) => e.head === "Suspense").length;
    if (c > 0) list.push({ id: "suspense", label: `${c} ${c === 1 ? "entry needs" : "entries need"} re-coding`, sub: "Parked in Suspense — tap Transactions › Unexplained", grad: C.amberGrad, icon: "tag" });
  }
  if (n.dues) {
    const owed = owedAsOf(book, today());
    const creditors = owed.perParty.filter((p) => p.balance < 0);
    if (creditors.length) {
      list.push({ id: "dues", label: `You owe ${money(book, owed.creditors)}`, sub: `Across ${creditors.length} ${creditors.length === 1 ? "person" : "people"}`, grad: C.redGrad, icon: "people" });
    }
  }
  if (n.backup) {
    const last = book.lastBackupAt || null;
    const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    if (!last || days > 30) {
      list.push({ id: "backup", label: last ? `Backup is ${days} days old` : "No backup yet", sub: "Setup › Backup & Data › Export JSON", grad: C.indigoGrad, icon: "download" });
    }
  }
  return list;
}

// Net Bank effect of entries still sitting in Suspense, as of today — what
// the balance would move by once they're all explained. Backs the "pending"
// indicator so the displayed balance doesn't silently look wrong.
function pendingSummary(book) {
  const t = today();
  let amount = 0, count = 0;
  for (const e of book.entries) {
    if (e.date > t) continue;
    if ((e.type === "in" || e.type === "out") && e.head === "Suspense") {
      amount += e.type === "in" ? e.amount : -e.amount;
      count++;
    }
  }
  return { count, amount };
}

/* budgets: spent this month per expense head */
function budgetStatus(book) {
  const t = today();
  const pl = computePL(book, t.slice(0, 8) + "01", t);
  const rows = Object.entries(book.budgets || {})
    .filter(([, amt]) => amt > 0)
    .map(([head, amt]) => ({ head, budget: amt, spent: pl.expense[head] || 0 }));
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  return { rows, totalBudget, totalSpent, expense: pl.expense };
}

/* ────────────────────── account card (flip) ────────────────────── */
function AccountCard({ book, acc, active, onImport, onTransactions, pending, onViewPending }) {
  const [flipped, setFlipped] = useState(false);
  const shown = useCountUp(acc.balance, 700);
  const isCard = acc.type === "credit_card";
  const activeGrad = isCard
    ? "linear-gradient(150deg, rgba(136,19,55,.55) 0%, rgba(88,13,44,.5) 55%, rgba(38,6,17,.55) 100%)"
    : "linear-gradient(150deg, rgba(59,91,219,.55) 0%, rgba(44,55,150,.5) 55%, rgba(20,20,55,.55) 100%)";
  const compactGrad = isCard
    ? "linear-gradient(160deg, rgba(80,20,40,.42) 0%, rgba(20,6,14,.5) 100%)"
    : "linear-gradient(160deg, rgba(30,41,82,.48) 0%, rgba(10,14,30,.55) 100%)";
  const shadow = isCard ? "0 24px 50px -20px rgba(70,10,32,.6)" : "0 24px 50px -20px rgba(10,20,50,.6)";
  const face = {
    position: "absolute", inset: 0, backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden", borderRadius: 22, boxSizing: "border-box",
    display: "flex", flexDirection: "column", overflow: "hidden",
  };
  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "1.6/1", perspective: 1400 }}>
      <div style={{
        position: "relative", width: "100%", height: "100%", transformStyle: "preserve-3d",
        transition: "transform .7s cubic-bezier(.4,.15,.2,1)",
        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
      }}>
        <div
          className="cb-press"
          onClick={() => setFlipped(true)}
          style={{
            ...face,
            background: active ? activeGrad : compactGrad,
            backdropFilter: active ? "blur(22px)" : "blur(8px)",
            border: active ? "1px solid rgba(255,255,255,.18)" : "1px solid rgba(255,255,255,.09)",
            boxShadow: `${shadow}, inset 0 1px 0 rgba(255,255,255,.16)`,
            padding: active ? "18px 20px" : "16px 18px", cursor: "pointer",
          }}
        >
          <div style={{
            position: "absolute", top: "-60%", left: "-20%", width: "85%", height: "170%",
            background: "radial-gradient(ellipse, rgba(255,255,255,.12), transparent 70%)", pointerEvents: "none",
          }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              <Orb size={32} grad={isCard ? C.grad : C.blueGrad} shadow={isCard ? "0 4px 10px -3px rgba(109,40,217,.6)" : "0 4px 10px -3px rgba(37,99,235,.6)"}>
                <Ic name={isCard ? "card" : "bank"} size={15} />
              </Orb>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 190 }}>
                  {acc.name}
                </div>
                {acc.last4 && <div style={{ fontSize: 11, color: "#c7c3ba", marginTop: 1 }}>•••• {acc.last4}</div>}
              </div>
            </div>
            <RoundBtn style={{ width: 30, height: 30 }} aria-label="Flip card" onClick={(e) => { e.stopPropagation(); setFlipped(true); }}>
              <Ic name="flip" size={14} stroke="#e9e6df" />
            </RoundBtn>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", position: "relative" }}>
            <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#c7c3ba", fontWeight: 700 }}>
              {isCard ? "Outstanding balance" : "Available balance"}
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, color: "#fff", marginTop: 6, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
              {money(book, shown)}
            </div>
            {pending && pending.count > 0 ? (
              <div
                className="cb-press"
                onClick={(e) => { e.stopPropagation(); onViewPending && onViewPending(); }}
                style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 9, cursor: "pointer" }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 999, background: C.amber, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#f1d9a8", fontWeight: 700 }}>
                  {money(book, Math.abs(pending.amount))} pending in {pending.count} unexplained ›
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 9 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: "#6ee7b7", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#c7c3ba", fontWeight: 600 }}>Live from your book</span>
              </div>
            )}
          </div>
        </div>

        <div style={{
          ...face, transform: "rotateY(180deg)",
          background: activeGrad, backdropFilter: "blur(22px)",
          border: "1px solid rgba(255,255,255,.18)",
          boxShadow: `${shadow}, inset 0 1px 0 rgba(255,255,255,.2)`,
        }}>
          <div style={{ height: 28, background: "#0a0512", marginTop: 16, flexShrink: 0 }} />
          <div style={{ flex: 1, padding: "12px 18px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", color: "#e8defb", textTransform: "uppercase" }}>This month</div>
              <RoundBtn style={{ width: 28, height: 28 }} aria-label="Flip back" onClick={(e) => { e.stopPropagation(); setFlipped(false); }}>
                <Ic name="flip" size={14} stroke="#e8defb" />
              </RoundBtn>
            </div>
            <div style={{ display: "flex", gap: 6, fontSize: 10, flexWrap: "wrap" }}>
              <span style={{ background: "rgba(167,139,250,.2)", border: "1px solid rgba(167,139,250,.4)", color: "#e2d6fb", padding: "3px 8px", borderRadius: 999, fontWeight: 700 }}>
                in {money(book, acc.monthIn)}
              </span>
              <span style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)", color: "#d3c8e8", padding: "3px 8px", borderRadius: 999, fontWeight: 700 }}>
                out {money(book, acc.monthOut)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              <button className="cb-press" onClick={(e) => { e.stopPropagation(); onImport(); }}
                style={{ flex: 1, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.18)", color: C.accentText, padding: "5px", borderRadius: 999, fontSize: 10, fontWeight: 700, fontFamily: F.sans, whiteSpace: "nowrap", cursor: "pointer" }}>
                ⇩ Import
              </button>
              <button className="cb-press" onClick={(e) => { e.stopPropagation(); onTransactions(); }}
                style={{ flex: 1, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.18)", color: C.accentText, padding: "5px", borderRadius: 999, fontSize: 10, fontWeight: 700, fontFamily: F.sans, whiteSpace: "nowrap", cursor: "pointer" }}>
                ≡ Transactions
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────── SVG mini-charts ────────────────────── */
function Sparkline({ points, width = 320, height = 90, color = "#a78bfa" }) {
  if (!points || points.length < 2) {
    return <div style={{ fontSize: 12, color: C.faint, padding: "20px 0" }}>Not enough history yet — check back next month.</div>;
  }
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const px = (i) => (i / (points.length - 1)) * (width - 12) + 6;
  const py = (v) => height - 10 - ((v - min) / span) * (height - 24);
  const path = points.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const area = `${path} L${px(points.length - 1)},${height - 4} L${px(0)},${height - 4} Z`;
  const lx = px(points.length - 1), ly = py(points[points.length - 1]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="cbSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#cbSparkFill)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="4" fill={color} stroke="#0d0818" strokeWidth="2" />
    </svg>
  );
}

function Donut({ slices, size = 120, thickness = 14, centerLabel, centerValue }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={thickness} />
      {slices.map((s, i) => {
        const frac = s.value / total;
        const el = (
          <circle
            key={i}
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={s.color} strokeWidth={thickness}
            strokeDasharray={`${Math.max(0, frac * circ - 2)} ${circ}`}
            strokeDashoffset={-offset * circ}
            strokeLinecap="butt"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
        offset += frac;
        return el;
      })}
      {centerValue && (
        <>
          <text x="50%" y="47%" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="800" fontFamily={F.sans}>{centerValue}</text>
          <text x="50%" y="61%" textAnchor="middle" fill={C.faint} fontSize="8.5" fontWeight="600" fontFamily={F.sans}>{centerLabel}</text>
        </>
      )}
    </svg>
  );
}

/* asset / liability slices from the balance sheet */
function bsSlices(book, asOf) {
  const bs = computeBS(book, asOf || today());
  const mk = (rows) => {
    const pos = rows.filter((r) => r.amount > 0);
    const total = pos.reduce((s, r) => s + r.amount, 0) || 1;
    return pos
      .sort((a, b) => b.amount - a.amount)
      .map((r, i) => ({
        label: r.name, value: r.amount, color: SLICE_COLORS[i % SLICE_COLORS.length],
        pct: Math.round((r.amount / total) * 100),
      }));
  };
  return { bs, assets: mk(bs.assets), liabilities: mk(bs.liabilities) };
}

/* net worth history: equity at each month end */
function equitySeries(book, months) {
  const t = today();
  const out = [];
  const start = new Date(t.slice(0, 7) + "-01T00:00:00");
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(start.getFullYear(), start.getMonth() - i + 1, 0);
    const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    out.push({ label: monthShort(iso.slice(0, 7) + "-01"), value: computeBS(book, iso > t ? t : iso).totalEquity });
  }
  return out;
}
/* ────────────────────────── Dashboard ────────────────────────── */
function StatOrb({ grad, shadow, icon, value, label, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Orb grad={grad} shadow={shadow}><Ic name={icon} size={20} /></Orb>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{value}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.soft }}>
          {label}
          <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.faint }}>{sub}</span>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ grad, shadow, icon, l1, l2, onClick }) {
  return (
    <button className="cb-press" onClick={onClick} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "center" }}>
      <Orb size={50} radius={15} grad={grad} shadow={shadow}><Ic name={icon} size={21} /></Orb>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#c9bfe0", marginTop: 7, lineHeight: 1.35 }}>
        {l1}<br />{l2 || " "}
      </div>
    </button>
  );
}

function DashHome({ book, go, onImport, onAdd, setTab }) {
  const t = today();
  const monthStart = t.slice(0, 8) + "01";
  const { bs } = bsSlices(book, t);
  const netWorth = bs.totalEquity;
  const shownNw = useCountUp(netWorth);
  const prevEnd = addDays(monthStart, -1);
  const nwPrev = computeBS(book, prevEnd).totalEquity;
  const nwDiff = netWorth - nwPrev;
  const nwPct = nwPrev !== 0 ? Math.round((nwDiff / Math.abs(nwPrev)) * 100) : null;

  const pl = computePL(book, monthStart, t);
  const [pFrom, pTo] = [addDays(monthStart, -31).slice(0, 8) + "01", prevEnd];
  const plPrev = computePL(book, pFrom, pTo);
  let invested = 0;
  for (const e of book.entries) {
    if (e.date < monthStart || e.date > t) continue;
    if (e.type === "out" && book.headClass[e.head]) invested += e.amount;
    if (e.type === "transfer" && e.dir === "out") {
      const a = book.bsAccounts.find((x) => x.name === e.account);
      if (a && a.kind === "asset") invested += e.amount;
    }
  }

  const accounts = accountModels(book);
  const pending = pendingSummary(book);
  const scrollRef = useRef(null);
  const [cardIdx, setCardIdx] = useState(0);
  const onCarouselScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const w = el.scrollWidth / accounts.length;
    setCardIdx(Math.min(accounts.length - 1, Math.max(0, Math.round(el.scrollLeft / w))));
  };

  const owed = owedAsOf(book, t);
  const dues = owed.perParty
    .filter((p) => p.balance < 0)
    .sort((a, b) => a.balance - b.balance)
    .slice(0, 4);

  const expDiffPct = plPrev.totalExpense
    ? Math.round(((pl.totalExpense - plPrev.totalExpense) / plPrev.totalExpense) * 100)
    : null;
  const topCat = Object.entries(pl.expense).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="cb-stagger">
      <div style={st.h1}>Dashboard</div>
      <div style={st.sub}>Your accounts, spending, and net worth at a glance</div>

      <div className="cb-press" onClick={() => go("networth")} style={{ ...glass(22), padding: "18px 18px 16px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "#e2d6fb" }}>
            Net Worth
            <Ic name="info" size={13} stroke={C.faint} />
          </div>
          <span style={{
            display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 999,
            border: "1px solid rgba(255,255,255,.16)", background: "rgba(255,255,255,.06)",
            color: "#e2d6fb", fontSize: 12, fontWeight: 700,
          }}>
            This Month
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
              {money(book, shownNw)}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: nwDiff >= 0 ? C.green : C.red, marginTop: 5, display: "flex", gap: 4 }}>
              {nwDiff >= 0 ? "▲" : "▼"} {nwPct !== null ? `${Math.abs(nwPct)}%` : money(book, Math.abs(nwDiff))} this month
            </div>
          </div>
        </div>
      </div>

      <div style={{ margin: "14px -16px 0" }}>
        <div
          ref={scrollRef}
          onScroll={onCarouselScroll}
          className="cb-carousel"
          style={{ display: "flex", gap: 12, padding: "4px 16px 6px", overflowX: "auto", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
        >
          {accounts.map((acc, i) => (
            <div key={acc.id} style={{ flex: "0 0 78%", scrollSnapAlign: "center" }}>
              <AccountCard
                book={book} acc={acc} active={i === cardIdx}
                onImport={onImport}
                onTransactions={() => { setTab("tx", { account: acc.id }); }}
                pending={acc.id === "bank" ? pending : null}
                onViewPending={() => setTab("tx", { seg: "unexplained" })}
              />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "center" }}>
          {accounts.map((a, i) => (
            <span key={a.id} style={{
              width: i === cardIdx ? 18 : 6, height: 6, borderRadius: 999,
              background: i === cardIdx ? C.accent : "rgba(255,255,255,.2)", transition: "width .25s ease",
            }} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: C.faint, fontWeight: 600, marginTop: 8, textAlign: "center" }}>
          Swipe to view all accounts
        </div>
      </div>

      <div style={{ ...glass(24), marginTop: 14, padding: "18px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 8px" }}>
          <StatOrb grad={C.greenGrad} shadow="0 6px 14px -4px rgba(4,120,87,.7)" icon="trend" value={compactMoney(book, pl.totalIncome)} label="Income" sub="This Month" />
          <StatOrb grad={C.redGrad} shadow="0 6px 14px -4px rgba(159,18,57,.7)" icon="wallet" value={compactMoney(book, pl.totalExpense)} label="Expenses" sub="This Month" />
          <StatOrb grad={C.grad} shadow="0 6px 14px -4px rgba(109,40,217,.6)" icon="coins" value={compactMoney(book, pl.net)} label="Savings" sub="This Month" />
          <StatOrb grad={C.amberGrad} shadow="0 6px 14px -4px rgba(180,83,9,.7)" icon="pie" value={compactMoney(book, invested)} label="Invested" sub="This Month" />
        </div>
      </div>

      {dues.length > 0 && (
        <div style={{ ...glass(24), marginTop: 14, padding: "18px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
            <div style={{ ...st.section, flex: 1 }}>Upcoming Dues</div>
            <button className="cb-press" onClick={() => setTab("owed")} style={{ border: "none", background: "none", color: C.accentText, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              View All
            </button>
          </div>
          <div className="cb-carousel" style={{ display: "flex", gap: 10, overflowX: "auto" }}>
            {dues.map((d, i) => (
              <div key={d.id} className="cb-press" onClick={() => go("party", d.id)} style={{ minWidth: 118, background: C.tile, border: C.borderSoft, borderRadius: 16, padding: 12, textAlign: "center", cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
                  <Avatar name={d.name} index={i + 3} size={40} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</div>
                <div style={{ fontSize: 11, color: C.muted }}>you owe</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#f2a7c8", marginTop: 2 }}>{money(book, Math.abs(d.balance))}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ ...glass(24), marginTop: 14, padding: "16px 18px 18px" }}>
        <div style={{ ...st.section, marginBottom: 14 }}>Quick Actions</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
          <QuickAction grad={C.indigoGrad} shadow="0 6px 14px -4px rgba(67,56,202,.55)" icon="download" l1="Import" l2="Statement" onClick={onImport} />
          <QuickAction grad={C.skyGrad} shadow="0 6px 14px -4px rgba(3,105,161,.55)" icon="plus" l1="Add" l2="Transaction" onClick={onAdd} />
          <QuickAction grad={C.grad} shadow="0 6px 14px -4px rgba(109,40,217,.55)" icon="pie" l1="Reports" onClick={() => setTab("reports")} />
          <QuickAction grad={C.pinkGrad} shadow="0 6px 14px -4px rgba(162,28,175,.55)" icon="tag" l1="Budget" onClick={() => { setTab("reports"); go("budget"); }} />
          <QuickAction grad={C.tealGrad} shadow="0 6px 14px -4px rgba(15,118,110,.55)" icon="people" l1="Owed" onClick={() => setTab("owed")} />
        </div>
      </div>

      {(expDiffPct !== null || topCat) && (
        <div style={{ ...glass(24), marginTop: 14, marginBottom: 8, padding: "16px 18px 18px" }}>
          <div style={{ ...st.section, marginBottom: 14 }}>Insights for You</div>
          <div className="cb-carousel" style={{ display: "flex", gap: 10, overflowX: "auto" }}>
            {expDiffPct !== null && (
              <div style={{ minWidth: 210, background: C.tile, border: C.borderSoft, borderRadius: 16, padding: 14 }}>
                <Orb size={34} grad={C.greenGrad}><Ic name="trend" size={15} /></Orb>
                <div style={{ fontSize: 13, color: C.soft, marginTop: 10 }}>
                  You spent{" "}
                  <span style={{ fontWeight: 800, color: expDiffPct <= 0 ? C.green : C.red }}>
                    {Math.abs(expDiffPct)}% {expDiffPct <= 0 ? "less" : "more"}
                  </span>{" "}
                  than last month.
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginTop: 2 }}>
                  {expDiffPct <= 0 ? "Keep it up!" : "Worth a look."}
                </div>
                <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,.1)", marginTop: 12 }}>
                  <div style={{ height: "100%", width: `${Math.min(100, Math.abs(expDiffPct))}%`, borderRadius: 999, background: expDiffPct <= 0 ? C.greenGrad : C.redGrad }} />
                </div>
              </div>
            )}
            {topCat && (
              <div style={{ minWidth: 210, background: C.tile, border: C.borderSoft, borderRadius: 16, padding: 14 }}>
                <Orb size={34} grad={C.grad}><Ic name="tag" size={15} /></Orb>
                <div style={{ fontSize: 13, color: C.soft, marginTop: 10 }}>{topCat[0]} is your top expense category.</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.accentText, marginTop: 2 }}>
                  {money(book, topCat[1])} spent this month
                </div>
                <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,.1)", marginTop: 12 }}>
                  <div style={{ height: "100%", width: `${Math.round((topCat[1] / (pl.totalExpense || 1)) * 100)}%`, borderRadius: 999, background: "linear-gradient(90deg,#a78bfa,#6d28d9)" }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── Net worth + breakdowns ────────────────────────── */
function NetWorthPage({ book, go }) {
  const [months, setMonths] = useState(6);
  const t = today();
  const { bs, assets, liabilities } = bsSlices(book, t);
  const series = useMemo(() => equitySeries(book, months), [book, months]);
  const prev = computeBS(book, addDays(t.slice(0, 8) + "01", -1)).totalEquity;
  const diff = bs.totalEquity - prev;
  const pct = prev !== 0 ? Math.round((diff / Math.abs(prev)) * 100) : null;

  const Breakdown = ({ title, slices, accent, page }) => (
    <div style={{ ...glass(24), marginTop: 14, padding: "18px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <div style={{ ...st.section, flex: 1 }}>{title}</div>
        <button className="cb-press" onClick={() => go(page)} style={{ border: "none", background: "none", padding: 0, fontSize: 12.5, fontWeight: 700, color: accent, cursor: "pointer" }}>
          View Details ›
        </button>
      </div>
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <Donut slices={slices} centerValue={compactMoney(book, slices.reduce((s, x) => s + x.value, 0))} centerLabel="total" />
        <div style={{ display: "grid", gap: 10, flex: 1 }}>
          {slices.slice(0, 4).map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: C.soft }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, display: "inline-block" }} />
                {s.label}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "#fff" }}>{compactMoney(book, s.value)}</div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: C.faint }}>{s.pct}%</div>
              </div>
            </div>
          ))}
          {slices.length === 0 && <div style={{ fontSize: 12, color: C.faint }}>Nothing here yet.</div>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="cb-stagger">
      <div style={{ padding: "6px 0 4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: C.muted }}>
          Total Net Worth <Ic name="info" size={13} stroke={C.faint} />
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, color: "#fff", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
          {money(book, bs.totalEquity)}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: diff >= 0 ? C.green : C.red, marginTop: 6 }}>
          {diff >= 0 ? "▲" : "▼"} {pct !== null ? `${Math.abs(pct)}%` : ""}{" "}
          <span style={{ color: C.faint, fontWeight: 600 }}>({money(book, Math.abs(diff))} this month)</span>
        </div>
      </div>

      <div style={{ ...glass(24), marginTop: 14, padding: "18px 16px" }}>
        <Sparkline points={series.map((s) => s.value)} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          {series.filter((_, i) => series.length <= 7 || i % 2 === 0).map((s, i) => (
            <div key={i} style={{ fontSize: 10, color: C.faint, fontWeight: 600 }}>{s.label}</div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 14, paddingBottom: 2 }}>
          {[["3M", 3], ["6M", 6], ["1Y", 12], ["All", 24]].map(([label, m]) => (
            <button
              key={label}
              className="cb-press"
              onClick={() => setMonths(m)}
              style={{
                padding: "7px 14px", borderRadius: 999, fontSize: 12, fontWeight: 800,
                fontFamily: F.sans, cursor: "pointer",
                border: `1px solid ${months === m ? "rgba(167,139,250,.5)" : "rgba(255,255,255,.14)"}`,
                background: months === m ? "rgba(167,139,250,.18)" : "rgba(255,255,255,.05)",
                color: months === m ? C.accentText : C.muted,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...glass(24), marginTop: 14, padding: "16px 18px 18px" }}>
        <div style={{ ...st.section, marginBottom: 12 }}>Summary</div>
        {[
          { label: "Total Assets", value: bs.totalAssets, grad: C.greenGrad, icon: "trend" },
          { label: "Total Liabilities", value: bs.totalLiabilities, grad: C.redGrad, icon: "card" },
        ].map((r) => (
          <div key={r.label} style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
              <Orb size={32} grad={r.grad}><Ic name={r.icon} size={14} /></Orb>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.soft }}>{r.label}</div>
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>{money(book, r.value)}</div>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", padding: "12px 0 0" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, flex: 1 }}>Net Worth</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.accentText }}>{money(book, bs.totalEquity)}</div>
        </div>
      </div>

      <Breakdown title="Breakdown" slices={assets} accent={C.accentText} page="assets" />
      <Breakdown title="Liability Breakdown" slices={liabilities} accent="#fca5a5" page="liabilities" />
      <div style={{ height: 10 }} />
    </div>
  );
}

function AllocationPage({ book, kind }) {
  const t = today();
  const { assets, liabilities } = bsSlices(book, t);
  const slices = kind === "assets" ? assets : liabilities;
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <div className="cb-stagger">
      <div style={{ padding: "6px 0 4px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
          Total {kind === "assets" ? "Assets" : "Liabilities"} Value
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, color: "#fff", marginTop: 6 }}>{money(book, total)}</div>
      </div>
      <div style={{ ...glass(24), marginTop: 14, padding: "16px 18px 18px" }}>
        <div style={st.section}>{kind === "assets" ? "Asset" : "Liability"} Allocation</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.faint, margin: "2px 0 12px" }}>By Category</div>
        <div style={{ display: "flex", height: 10, borderRadius: 999, background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
          {slices.map((s) => (
            <div key={s.label} style={{ width: `${s.pct}%`, background: s.color }} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
          {slices.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, display: "inline-block" }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "#fff" }}>{s.pct}%</div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: C.faint }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ ...glass(24), marginTop: 14, marginBottom: 8, padding: "16px 18px 18px" }}>
        <div style={{ ...st.section, marginBottom: 12 }}>All {kind === "assets" ? "Assets" : "Liabilities"}</div>
        {slices.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ width: 34, height: 34, borderRadius: 999, background: "rgba(255,255,255,.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: s.color, display: "inline-block" }} />
            </div>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.soft }}>{s.label}</div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>{money(book, s.value)}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.faint, marginTop: 2 }}>{s.pct}%</div>
            </div>
          </div>
        ))}
        {slices.length === 0 && <div style={{ fontSize: 13, color: C.muted, padding: "10px 0" }}>Nothing here yet.</div>}
      </div>
    </div>
  );
}

/* ────────────────────────── Transactions ────────────────────────── */
function TxView({ book, up, onEdit, initialFilter }) {
  const t = today();
  const [seg, setSeg] = useState((initialFilter && initialFilter.seg) || "explained");
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState("all"); // all | month | 90d | fy | custom
  const [customFrom, setCustomFrom] = useState(t.slice(0, 8) + "01");
  const [customTo, setCustomTo] = useState(t);
  const [type, setType] = useState("all"); // all | in | out | transfer | party
  const [account, setAccount] = useState((initialFilter && initialFilter.account) || "all");
  const [head, setHead] = useState("all");
  const [sortAmt, setSortAmt] = useState(false);
  const [popover, setPopover] = useState(""); // "" | period | type | account | head
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkPicker, setBulkPicker] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const unexplained = book.entries.filter((e) => e.head === "Suspense").length;

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); setBulkPicker(false); setConfirmBulkDelete(false); };
  const toggleSelected = (id) => setSelected((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectedEntries = book.entries.filter((e) => selected.has(e.id));
  const selectedTypes = new Set(selectedEntries.map((e) => e.type));
  const bulkRecodeable = selectedEntries.length > 0 && selectedTypes.size === 1 && (selectedTypes.has("in") || selectedTypes.has("out"));
  const bulkDeletable = selectedEntries.length > 0 && selectedEntries.every((e) => e.head === "Suspense");
  const bulkHeads = bulkRecodeable ? (selectedTypes.has("in") ? book.heads.income : book.heads.expense) : [];

  const applyBulkHead = (h) => {
    const ids = new Set(selectedEntries.map((e) => e.id));
    up((b) => {
      const learned = {};
      for (const e of b.entries) {
        if (!ids.has(e.id)) continue;
        e.head = h;
        const kw = keywordOf(e.note);
        if (kw) learned[kw] = h;
      }
      for (const [match, hd] of Object.entries(learned)) {
        const ex = b.codingRules.find((x) => x.match === match);
        if (ex) ex.head = hd;
        else b.codingRules.push({ match, head: hd });
      }
      return b;
    });
    exitSelectMode();
  };
  const applyBulkDelete = () => {
    const ids = new Set(selectedEntries.map((e) => e.id));
    up((b) => {
      b.entries = b.entries.filter((x) => !(ids.has(x.id) && x.head === "Suspense"));
      return b;
    });
    exitSelectMode();
  };

  const [from, to] =
    period === "month" ? [t.slice(0, 8) + "01", t]
    : period === "90d" ? [addDays(t, -90), t]
    : period === "fy" ? fyRange(fyOf(t))
    : period === "custom" ? [customFrom, customTo]
    : ["0000-01-01", "9999-12-31"];

  const needle = q.trim().toLowerCase();
  const matches = (e) => {
    if (seg === "unexplained" ? e.head !== "Suspense" : e.head === "Suspense") return false;
    if (e.date < from || e.date > to) return false;
    if (type !== "all" && e.type !== type) return false;
    if (account !== "all") {
      if (account === "bank") { if (e.type === "transfer") return false; }
      else if (account.startsWith("acct:")) {
        const name = account.slice(5);
        const via = (e.type === "transfer" && e.account === name) || ((e.type === "in" || e.type === "out") && book.headClass[e.head] === name);
        if (!via) return false;
      }
    }
    if (head !== "all" && e.head !== head) return false;
    if (!needle) return true;
    const hay = `${entryLabel(book, e)} ${e.note || ""} ${e.amount} ${e.date}`.toLowerCase();
    return needle.split(/\s+/).every((w) => hay.includes(w));
  };

  const filtered = book.entries.filter(matches).sort(
    sortAmt
      ? (a, b) => b.amount - a.amount
      : (a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1)
  );
  const groups = [];
  if (!sortAmt) {
    for (const e of filtered) {
      const g = groups[groups.length - 1];
      if (g && g.date === e.date) g.items.push(e);
      else groups.push({ date: e.date, items: [e] });
    }
  }
  const heads = [...new Set(book.entries.filter((e) => e.head).map((e) => e.head))];
  const filtersActive = period !== "all" || type !== "all" || account !== "all" || head !== "all" || needle;
  const accounts = accountModels(book);

  const periodLabel = { all: "All time", month: "This month", "90d": "Last 90 days", fy: "This FY", custom: "Custom" }[period];
  const typeLabel = { all: "All types", in: "Money in", out: "Money out", transfer: "Transfers", party: "Party" }[type];
  const accountLabel = account === "all" ? "All accounts" : account === "bank" ? "Bank" : account.slice(5);

  const Popover = ({ children }) => (
    <div className="cb-view" style={{ background: C.tile, border: "1px solid rgba(255,255,255,.12)", borderRadius: 16, padding: "12px 14px", marginTop: 8 }}>
      {children}
      <PrimaryBtn style={{ width: "100%", marginTop: 10, padding: "9px 0", fontSize: 12.5 }} onClick={() => setPopover("")}>Done</PrimaryBtn>
    </div>
  );
  const Opt = ({ active, label, onClick }) => (
    <FilterChip label={label} active={active} onClick={onClick} />
  );

  const Row = ({ e, showDate }) => (
    <div
      className="cb-row cb-press"
      onClick={() => (selectMode ? toggleSelected(e.id) : onEdit(e))}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}
    >
      {selectMode && (
        <div style={{
          width: 20, height: 20, borderRadius: 999, flexShrink: 0,
          border: `1.5px solid ${selected.has(e.id) ? C.accent : "rgba(255,255,255,.3)"}`,
          background: selected.has(e.id) ? C.grad : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff",
        }}>
          {selected.has(e.id) && "✓"}
        </div>
      )}
      {showDate && (
        <div style={{ width: 46, fontSize: 11, color: C.faint, fontWeight: 600, flexShrink: 0 }}>
          {prettyDate(e.date).replace(/^\w+, /, "")}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>
          {entryLabel(book, e)}
          {e.head === "Suspense" && <span style={{ color: C.amber, fontSize: 11, marginLeft: 6, fontWeight: 700 }}>● re-code</span>}
          {isRefund(book, e) && <span style={{ color: C.accentText, fontSize: 11, marginLeft: 6, fontWeight: 700 }}>↩ refund</span>}
        </div>
        {e.note && (
          <div style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.note}</div>
        )}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: entrySign(e) > 0 ? C.green : C.red, whiteSpace: "nowrap" }}>
        {entrySign(e) > 0 ? "+" : "−"}{money(book, e.amount)}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={st.h1}>Transactions</div>
          <div style={st.sub}>Every entry, explained and coded</div>
        </div>
        <button
          className="cb-press"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          style={{ border: "none", background: "none", color: C.accentText, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "4px 2px" }}
        >
          {selectMode ? "Cancel" : "Select"}
        </button>
      </div>
      <Seg
        value={seg}
        onChange={setSeg}
        options={[
          { v: "explained", label: "Explained" },
          { v: "unexplained", label: "Unexplained", badge: unexplained },
        ]}
      />
      <input
        style={{ ...st.input, borderRadius: 14, marginTop: 12 }}
        placeholder="Search entries…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="cb-carousel" style={{ display: "flex", gap: 8, padding: "10px 0 2px", overflowX: "auto" }}>
        <FilterChip label={`${periodLabel} ▾`} active={period !== "all"} onClick={() => setPopover(popover === "period" ? "" : "period")} />
        <FilterChip label={`${typeLabel} ▾`} active={type !== "all"} onClick={() => setPopover(popover === "type" ? "" : "type")} />
        <FilterChip label={`${accountLabel} ▾`} active={account !== "all"} onClick={() => setPopover(popover === "account" ? "" : "account")} />
        <FilterChip label={`${head === "all" ? "All heads" : head} ▾`} active={head !== "all"} onClick={() => setPopover(popover === "head" ? "" : "head")} />
        <FilterChip label={sortAmt ? "By amount" : "Newest"} active={sortAmt} onClick={() => setSortAmt(!sortAmt)} />
      </div>

      {popover === "period" && (
        <Popover>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["all", "All time"], ["month", "This month"], ["90d", "90 days"], ["fy", "This FY"], ["custom", "Custom"]].map(([v, l]) => (
              <Opt key={v} active={period === v} label={l} onClick={() => setPeriod(v)} />
            ))}
          </div>
          {period === "custom" && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input style={{ ...st.input, padding: "9px 10px", fontSize: 12.5 }} type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <input style={{ ...st.input, padding: "9px 10px", fontSize: 12.5 }} type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          )}
        </Popover>
      )}
      {popover === "type" && (
        <Popover>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["all", "All"], ["in", "Money in"], ["out", "Money out"], ["transfer", "Transfers"], ["party", "Party"]].map(([v, l]) => (
              <Opt key={v} active={type === v} label={l} onClick={() => setType(v)} />
            ))}
          </div>
        </Popover>
      )}
      {popover === "account" && (
        <Popover>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Opt active={account === "all"} label="All" onClick={() => setAccount("all")} />
            {accounts.map((a) => (
              <Opt key={a.id} active={account === a.id} label={a.name} onClick={() => setAccount(a.id)} />
            ))}
          </div>
        </Popover>
      )}
      {popover === "head" && (
        <Popover>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Opt active={head === "all"} label="All" onClick={() => setHead("all")} />
            {heads.map((h) => (
              <Opt key={h} active={head === h} label={h} onClick={() => setHead(h)} />
            ))}
            {heads.length === 0 && <div style={{ fontSize: 12, color: C.muted }}>No categories in the current scope.</div>}
          </div>
        </Popover>
      )}

      <div style={{ display: "flex", alignItems: "center", margin: "8px 2px 0" }}>
        <div style={{ fontSize: 12, color: filtersActive ? C.accentText : C.faint, flex: 1 }}>
          {filtered.length} of {book.entries.length} entries
        </div>
        {filtersActive && (
          <button
            className="cb-press"
            onClick={() => { setPeriod("all"); setType("all"); setAccount("all"); setHead("all"); setQ(""); }}
            style={{ border: "none", background: "none", color: C.accentText, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            Clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <div style={{ color: C.muted, padding: "34px 10px", fontSize: 14, textAlign: "center" }}>
          {seg === "unexplained"
            ? "Nothing to re-code — every entry is explained. 🎉"
            : filtersActive ? "Nothing matches these filters." : "No entries yet — tap + to record the first one."}
        </div>
      )}

      {!sortAmt && groups.map((g) => (
        <div key={g.date} style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em", margin: "0 2px 6px", fontWeight: 700 }}>
            {prettyDate(g.date)}
          </div>
          <div style={{ ...glass(18), overflow: "hidden" }}>
            {g.items.map((e) => <Row key={e.id} e={e} />)}
          </div>
        </div>
      ))}
      {sortAmt && filtered.length > 0 && (
        <div style={{ ...glass(18), overflow: "hidden", marginTop: 16 }}>
          {filtered.map((e) => <Row key={e.id} e={e} showDate />)}
        </div>
      )}
      {selectMode && selected.size > 0 && <div style={{ height: 76 }} />}
      {selectMode && selected.size > 0 && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: "calc(64px + env(safe-area-inset-bottom, 0px))",
          zIndex: 25, display: "flex", justifyContent: "center", padding: "0 14px",
        }}>
          <div style={{
            ...glass(18), width: "100%", maxWidth: 460, padding: "10px 12px",
            display: "flex", alignItems: "center", gap: 8, boxShadow: "0 12px 30px -8px rgba(0,0,0,.6)",
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>{selected.size} selected</div>
            {bulkDeletable && (
              <GhostBtn style={{ padding: "9px 12px", fontSize: 12.5, color: C.red }} onClick={() => setConfirmBulkDelete(true)}>
                Delete
              </GhostBtn>
            )}
            <PrimaryBtn
              disabled={!bulkRecodeable}
              style={{ padding: "9px 14px", fontSize: 12.5, opacity: bulkRecodeable ? 1 : 0.5 }}
              onClick={() => bulkRecodeable && setBulkPicker(true)}
              title={bulkRecodeable ? "" : "Select entries of one type (all money in, or all money out) to bulk re-code"}
            >
              Set category
            </PrimaryBtn>
          </div>
        </div>
      )}
      {bulkPicker && (
        <Sheet title={`Set category for ${selected.size} ${selected.size === 1 ? "entry" : "entries"}`} onClose={() => setBulkPicker(false)}>
          <Chips
            options={bulkHeads}
            value=""
            onChange={(h) => applyBulkHead(h)}
            render={(h) => (book.headClass[h] ? `${h} → ${book.headClass[h]}` : h)}
          />
        </Sheet>
      )}
      {confirmBulkDelete && (
        <Sheet title="Delete entries?" onClose={() => setConfirmBulkDelete(false)}>
          <div style={{ fontSize: 13, color: C.soft }}>
            {selected.size} unexplained {selected.size === 1 ? "entry" : "entries"} will be removed. Explained
            entries can never be deleted — this only touches Suspense rows.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
            <GhostBtn style={{ padding: "10px 0" }} onClick={() => setConfirmBulkDelete(false)}>Cancel</GhostBtn>
            <PrimaryBtn danger style={{ padding: "10px 0" }} onClick={applyBulkDelete}>Delete</PrimaryBtn>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/* ────────────────────────── Owed suite ────────────────────────── */
function partyMeta(book, p, index) {
  const acts = [
    ...book.entries.filter((e) => e.type === "party" && e.partyId === p.id).map((e) => e.date),
    ...book.owedMemos.filter((m) => m.partyId === p.id).map((m) => m.date),
  ].sort();
  const last = acts[acts.length - 1] || null;
  const first = acts[0] || null;
  const days = last ? Math.floor((new Date(today()) - new Date(last)) / 86400000) : null;
  let statusLabel = "Settled", statusColor = C.faint;
  if (p.balance > 0) {
    statusLabel = days != null && days > 30 ? "Follow up" : "Owes you";
    statusColor = days != null && days > 30 ? C.amber : C.green;
  } else if (p.balance < 0) {
    statusLabel = "You owe";
    statusColor = C.red;
  }
  return { last, first, days, statusLabel, statusColor, index };
}

function agingBuckets(book, list) {
  const buckets = [
    { label: "0–30 days", color: "#6ee7b7", value: 0 },
    { label: "31–60 days", color: "#fbbf24", value: 0 },
    { label: "60+ days", color: "#fb7185", value: 0 },
  ];
  for (const p of list) {
    const m = partyMeta(book, p);
    const amt = Math.abs(p.balance);
    if (m.days == null || m.days <= 30) buckets[0].value += amt;
    else if (m.days <= 60) buckets[1].value += amt;
    else buckets[2].value += amt;
  }
  return buckets;
}

function PartyRow({ book, p, index, onOpen }) {
  const m = partyMeta(book, p, index);
  return (
    <div className="cb-press cb-row" onClick={() => onOpen(p.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: `1px solid ${C.line}`, cursor: "pointer" }}>
      <Avatar name={p.name} index={index} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{p.name}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: m.statusColor, marginTop: 1 }}>{m.statusLabel}</div>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: "#fff" }}>{money(book, Math.abs(p.balance))}</div>
    </div>
  );
}

function OwedView({ book, go, onAddMemo, onRecordPayment }) {
  const [seg, setSeg] = useState("all");
  const t = today();
  const owed = owedAsOf(book, t);
  const prevOwed = owedAsOf(book, addDays(t.slice(0, 8) + "01", -1));
  const receivables = owed.perParty.filter((p) => p.balance > 0).sort((a, b) => b.balance - a.balance);
  const payables = owed.perParty.filter((p) => p.balance < 0).sort((a, b) => a.balance - b.balance);
  const net = owed.debtors - owed.creditors;
  const delta = (nowV, prevV) => (prevV ? Math.round(((nowV - prevV) / prevV) * 100) : null);

  const SectionHead = ({ grad, title, sub }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <Orb size={38} grad={grad}><Ic name="people" size={17} /></Orb>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.ink }}>{title}</div>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{sub}</div>
      </div>
    </div>
  );

  const TotalsRow = ({ label, total, prevTotal, accent, border, bg, detailPage }) => {
    const d = delta(total, prevTotal);
    return (
      <div style={{ display: "flex", alignItems: "flex-start", padding: "2px 0 4px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted }}>{label}</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "#fff", marginTop: 4 }}>{money(book, total)}</div>
          {d !== null && (
            <div style={{ fontSize: 12.5, fontWeight: 700, color: d >= 0 ? C.green : C.red, marginTop: 6 }}>
              {d >= 0 ? "▲" : "▼"} {Math.abs(d)}% <span style={{ color: C.faint, fontWeight: 600 }}>vs last month</span>
            </div>
          )}
        </div>
        <button className="cb-press" onClick={() => go(detailPage)} style={{ border, background: bg, borderRadius: 12, padding: "9px 12px", color: accent, fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontFamily: F.sans }}>
          Details ›
        </button>
      </div>
    );
  };

  const showRecv = seg === "all" || seg === "recv";
  const showPay = seg === "all" || seg === "pay";

  return (
    <div className="cb-stagger">
      <div style={st.h1}>Owed</div>
      <div style={st.sub}>Everyone who owes you, and everyone you owe</div>
      <Seg
        value={seg}
        onChange={setSeg}
        options={[
          { v: "all", label: "All" },
          { v: "recv", label: "Receivables" },
          { v: "pay", label: "Payables" },
        ]}
      />
      <div style={{ ...glass(20), padding: 16, margin: "14px 0 20px" }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>
          Net position
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: net >= 0 ? C.green : C.red, marginTop: 6 }}>
          {net >= 0 ? "+" : "−"}{money(book, Math.abs(net))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
          <div style={{ background: "rgba(110,231,183,.12)", border: "1px solid rgba(110,231,183,.3)", borderRadius: 12, padding: "9px 10px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase" }}>You'll receive</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.green, marginTop: 3 }}>{money(book, owed.debtors)}</div>
          </div>
          <div style={{ background: "rgba(251,113,133,.12)", border: "1px solid rgba(251,113,133,.3)", borderRadius: 12, padding: "9px 10px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase" }}>You owe</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.red, marginTop: 3 }}>{money(book, owed.creditors)}</div>
          </div>
        </div>
      </div>

      {showRecv && (
        <div>
          <SectionHead grad={C.greenGrad} title="Receivables" sub="Money owed to you by people" />
          <TotalsRow label="Total Receivables" total={owed.debtors} prevTotal={prevOwed.debtors} accent={C.green} border="1px solid rgba(110,231,183,.3)" bg="rgba(110,231,183,.1)" detailPage="recvDetail" />
          <div style={{ margin: "12px 0 0", ...st.section }}>All Receivables</div>
          {receivables.length > 0 ? (
            <div style={{ ...glass(20), padding: "4px 16px", marginTop: 8 }}>
              {receivables.map((p, i) => <PartyRow key={p.id} book={book} p={p} index={i} onOpen={(id) => go("party", id)} />)}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: C.muted, padding: "20px 10px" }}>Nobody owes you right now.</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "16px 0 26px" }}>
            <PrimaryBtn onClick={() => onAddMemo("debtor")}>Add Receivable</PrimaryBtn>
            <GhostBtn onClick={() => onRecordPayment(receivables[0] || null, "in")}>Record Payment</GhostBtn>
          </div>
        </div>
      )}

      {showPay && (
        <div>
          <SectionHead grad={C.redGrad} title="Payables" sub="Money you owe to people" />
          <TotalsRow label="Total Payables" total={owed.creditors} prevTotal={prevOwed.creditors} accent={C.red} border="1px solid rgba(251,113,133,.35)" bg="rgba(251,113,133,.1)" detailPage="payDetail" />
          <div style={{ margin: "12px 0 0", ...st.section }}>All Payables</div>
          {payables.length > 0 ? (
            <div style={{ ...glass(20), padding: "4px 16px", marginTop: 8 }}>
              {payables.map((p, i) => <PartyRow key={p.id} book={book} p={p} index={i + 2} onOpen={(id) => go("party", id)} />)}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: C.muted, padding: "20px 10px" }}>You don't owe anybody right now.</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "16px 0 10px" }}>
            <PrimaryBtn danger onClick={() => onAddMemo("creditor")}>Add Payable</PrimaryBtn>
            <GhostBtn onClick={() => onRecordPayment(payables[0] || null, "out")}>Record Payment</GhostBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function OwedDetailPage({ book, kind, go }) {
  const t = today();
  const owed = owedAsOf(book, t);
  const prevOwed = owedAsOf(book, addDays(t.slice(0, 8) + "01", -1));
  const isRecv = kind === "recv";
  const list = owed.perParty
    .filter((p) => (isRecv ? p.balance > 0 : p.balance < 0))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  const total = isRecv ? owed.debtors : owed.creditors;
  const prevTotal = isRecv ? prevOwed.debtors : prevOwed.creditors;
  const d = prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
  const buckets = agingBuckets(book, list);
  const bucketTotal = buckets.reduce((s, b) => s + b.value, 0) || 1;
  const largest = list[0];
  const stats = [
    { label: isRecv ? "People owe you" : "You owe people", value: `${list.length}`, color: "#fff" },
    { label: "Average", value: money(book, list.length ? Math.round(total / list.length) : 0), color: "#fff" },
    { label: "Largest", value: largest ? money(book, Math.abs(largest.balance)) : money(book, 0), color: isRecv ? C.green : C.red },
  ];
  return (
    <div className="cb-stagger">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Orb size={38} grad={isRecv ? C.greenGrad : C.redGrad}><Ic name="people" size={17} /></Orb>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.ink }}>{isRecv ? "Receivables" : "Payables"}</div>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
            {isRecv ? "Money owed to you by people" : "Money you owe to people"}
          </div>
        </div>
      </div>
      <div style={{ padding: "2px 0 4px" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted }}>Total {isRecv ? "Receivables" : "Payables"}</div>
        <div style={{ fontSize: 34, fontWeight: 800, color: "#fff", marginTop: 4 }}>{money(book, total)}</div>
        {d !== null && (
          <div style={{ fontSize: 12.5, fontWeight: 700, color: d >= 0 ? C.green : C.red, marginTop: 6 }}>
            {d >= 0 ? "▲" : "▼"} {Math.abs(d)}% <span style={{ color: C.faint, fontWeight: 600 }}>vs last month</span>
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 14 }}>
        {stats.map((s2) => (
          <div key={s2.label} style={{ background: C.chip, border: C.borderSoft, borderRadius: 16, padding: "11px 12px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: ".04em" }}>{s2.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: s2.color, marginTop: 4 }}>{s2.value}</div>
          </div>
        ))}
      </div>
      <div style={{ ...glass(22), marginTop: 16, padding: "16px 18px 18px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 10 }}>Aging Summary</div>
        <div style={{ display: "flex", height: 9, borderRadius: 999, background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
          {buckets.map((b) => (
            <div key={b.label} style={{ width: `${(b.value / bucketTotal) * 100}%`, background: b.color }} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px 10px", marginTop: 10 }}>
          {buckets.map((b) => (
            <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#c9bfe0", fontWeight: 600 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: b.color, flexShrink: 0 }} />
              {b.label} <span style={{ color: C.faint }}>· {compactMoney(book, b.value)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ margin: "16px 0 0", ...st.section }}>All {isRecv ? "Receivables" : "Payables"}</div>
      {list.length > 0 ? (
        <div style={{ ...glass(20), padding: "4px 16px", marginTop: 8, marginBottom: 10 }}>
          {list.map((p, i) => <PartyRow key={p.id} book={book} p={p} index={i} onOpen={(id) => go("party", id)} />)}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: C.muted, padding: "20px 10px" }}>
          {isRecv ? "Nobody owes you right now." : "You don't owe anybody right now."}
        </div>
      )}
    </div>
  );
}

function PartyProfilePage({ book, partyId, up, onRecordPayment, onSettle, onAddMemo }) {
  const [noteText, setNoteText] = useState("");
  const t = today();
  const owed = owedAsOf(book, t);
  const p = owed.perParty.find((x) => x.id === partyId);
  if (!p) return <div style={{ color: C.muted, padding: 30 }}>Party not found.</div>;
  const idx = book.parties.findIndex((x) => x.id === partyId);
  const m = partyMeta(book, p, idx);
  let lent = 0, repaid = 0;
  const txns = [];
  for (const e of book.entries) {
    if (e.type === "party" && e.partyId === partyId) {
      e.dir === "out" ? (lent += e.amount) : (repaid += e.amount);
      txns.push({ date: e.date, label: e.dir === "out" ? "Paid via bank" : "Received via bank", note: e.note, delta: e.dir === "out" ? e.amount : -e.amount });
    }
  }
  for (const mm of book.owedMemos) {
    if (mm.partyId === partyId) {
      txns.push({ date: mm.date, label: mm.amount >= 0 ? "Memo — they owe" : "Memo — you owe", note: mm.note, delta: mm.amount });
    }
  }
  txns.sort((a, b) => b.date.localeCompare(a.date));
  const notes = (book.partyNotes || []).filter((n) => n.partyId === partyId).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="cb-stagger">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Avatar name={p.name} index={idx} size={46} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.ink }}>{p.name}</div>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
            {m.first ? `Since ${prettyDate(m.first)}` : "No activity yet"}
          </div>
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: m.statusColor, background: "rgba(255,255,255,.08)", padding: "4px 10px", borderRadius: 999 }}>
          {m.statusLabel}
        </span>
      </div>
      <div style={{ padding: "4px 0" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>Outstanding</div>
        <div style={{ fontSize: 34, fontWeight: 800, color: "#fff", marginTop: 4 }}>
          {p.balance < 0 ? "−" : ""}{money(book, Math.abs(p.balance))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, margin: "14px 0" }}>
        <div style={{ background: C.chip, border: C.borderSoft, borderRadius: 14, padding: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase" }}>Lent</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 3 }}>{money(book, lent)}</div>
        </div>
        <div style={{ background: C.chip, border: C.borderSoft, borderRadius: 14, padding: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase" }}>Repaid</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.green, marginTop: 3 }}>{money(book, repaid)}</div>
        </div>
        <div style={{ background: C.chip, border: C.borderSoft, borderRadius: 14, padding: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase" }}>Last activity</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", marginTop: 5 }}>{m.last ? prettyDate(m.last) : "—"}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
        <PrimaryBtn onClick={() => onRecordPayment(p)}>Record Payment</PrimaryBtn>
        <GhostBtn onClick={() => onSettle(p)} disabled={p.balance === 0} style={{ opacity: p.balance === 0 ? 0.5 : 1 }}>
          Settle in Full
        </GhostBtn>
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 8 }}>Transactions</div>
      <div style={{ ...glass(18), marginBottom: 20, padding: txns.length ? 0 : 16 }}>
        {txns.map((tx, i) => (
          <div key={i} className="cb-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderTop: i ? `1px solid ${C.line}` : "none" }}>
            <Orb size={30} grad={tx.delta >= 0 ? C.grad : C.greenGrad}><Ic name={tx.delta >= 0 ? "trend" : "check"} size={13} /></Orb>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{tx.label}</div>
              <div style={{ fontSize: 11.5, color: C.muted }}>
                {tx.note ? `${tx.note} · ` : ""}{prettyDate(tx.date)}
              </div>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: tx.delta >= 0 ? C.green : C.red }}>
              {tx.delta >= 0 ? "+" : "−"}{money(book, Math.abs(tx.delta))}
            </div>
          </div>
        ))}
        {txns.length === 0 && <div style={{ fontSize: 12.5, color: C.muted }}>No activity yet.</div>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 8 }}>Notes</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          style={{ ...st.input, flex: 1, padding: "11px 12px", fontSize: 13 }}
          placeholder="Add a note about this person…"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
        />
        <button
          className="cb-press"
          disabled={!noteText.trim()}
          onClick={() => {
            const text = noteText.trim();
            if (!text) return;
            up((b) => (b.partyNotes.push({ id: uid(), partyId, text, date: today() }), b));
            setNoteText("");
          }}
          style={{ padding: "11px 16px", border: "none", borderRadius: 12, background: C.grad, color: "#fff", fontWeight: 700, fontSize: 12.5, fontFamily: F.sans, cursor: "pointer", opacity: noteText.trim() ? 1 : 0.5 }}
        >
          Add
        </button>
      </div>
      {notes.map((n) => (
        <div key={n.id} style={{ background: C.tile, border: C.borderSoft, borderLeft: `3px solid ${C.accent}`, borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, color: C.soft }}>{n.text}</div>
          <div style={{ fontSize: 10.5, color: C.faint, fontWeight: 700, marginTop: 8 }}>{prettyDate(n.date)}</div>
        </div>
      ))}
      {notes.length === 0 && <div style={{ fontSize: 12.5, color: C.muted, padding: "6px 0 12px" }}>No notes yet.</div>}
      <div style={{ paddingBottom: 8 }}>
        <GhostBtn style={{ width: "100%" }} onClick={() => onAddMemo(p.balance >= 0 ? "debtor" : "creditor", partyId)}>
          Add memo (non-cash)
        </GhostBtn>
      </div>
    </div>
  );
}
/* ────────────────────────── Reports suite ────────────────────────── */
function Variance({ book, current, prev, goodWhenUp }) {
  const diff = current - prev;
  const pct = prev !== 0 ? Math.round((diff / Math.abs(prev)) * 100) : null;
  const good = goodWhenUp ? diff >= 0 : diff <= 0;
  return (
    <div style={{ fontSize: 11, color: C.faint, marginTop: 1 }}>
      prev {money(book, prev)} ·{" "}
      <span style={{ color: diff === 0 ? C.faint : good ? C.green : C.red, fontWeight: 700 }}>
        {diff >= 0 ? "+" : "−"}{money(book, Math.abs(diff))}
        {pct !== null && ` (${diff >= 0 ? "+" : "−"}${Math.abs(pct)}%)`}
      </span>
    </div>
  );
}

function ReportsHub({ book, go }) {
  const t = today();
  const monthStart = t.slice(0, 8) + "01";
  const pl = computePL(book, monthStart, t);
  const bud = budgetStatus(book);
  const { bs } = bsSlices(book, t);
  const prevNw = computeBS(book, addDays(monthStart, -1)).totalEquity;
  const nwPct = prevNw !== 0 ? Math.round(((bs.totalEquity - prevNw) / Math.abs(prevNw)) * 100) : null;
  const accounts = accountModels(book);
  const bankTotal = accounts.filter((a) => a.kind !== "liability").reduce((s, a) => s + a.balance, 0);
  const budPct = bud.totalBudget ? Math.round((bud.totalSpent / bud.totalBudget) * 100) : null;

  const Card = ({ title, big, bigColor, sub, sub2, page, children }) => (
    <div className="cb-press" onClick={() => go(page)} style={{ ...glass(20), padding: 16, cursor: "pointer" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.soft }}>{title}</div>
      {children}
      {big != null && <div style={{ fontSize: 18, fontWeight: 800, color: bigColor || "#fff", marginTop: 10 }}>{big}</div>}
      {sub && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{sub}</div>}
      {sub2 && <div style={{ fontSize: 10, fontWeight: 700, color: C.green, marginTop: 3 }}>{sub2}</div>}
    </div>
  );

  return (
    <div className="cb-stagger">
      <div style={st.h1}>Reports</div>
      <div style={st.sub}>Tap any report to explore, filter by period, and export</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Card title="Budget" page="budget"
          big={budPct !== null ? `${budPct}%` : "Set up"}
          bigColor={budPct !== null && budPct > 100 ? C.red : "#fff"}
          sub={budPct !== null ? `${money(book, Math.max(0, bud.totalBudget - bud.totalSpent))} left` : "No budgets yet — tap to add"} />
        <Card title="Cash Flow" page="cashflow"
          big={`${pl.net >= 0 ? "+" : "−"}${compactMoney(book, Math.abs(pl.net))}`}
          bigColor={pl.net >= 0 ? C.green : C.red}
          sub="net this month" />
        <Card title="Net Worth" page="networth"
          big={compactMoney(book, bs.totalEquity)}
          sub={nwPct !== null ? `${nwPct >= 0 ? "▲" : "▼"} ${Math.abs(nwPct)}% this month` : "this month"} />
        <Card title="P&L" page="pl"
          big={compactMoney(book, pl.totalIncome)}
          sub={`income · ${compactMoney(book, pl.totalExpense)} expenses`} />
        <Card title="Bank Balances" page="bankbalances"
          big={compactMoney(book, bankTotal)}
          sub="across all accounts" />
        <Card title="Category Spending" page="catspend"
          big={compactMoney(book, pl.totalExpense)}
          sub="this month, by category" />
        <Card title="Actual vs Budget" page="budget"
          big={bud.totalBudget ? compactMoney(book, bud.totalSpent) : "—"}
          sub={bud.totalBudget ? `spent of ${compactMoney(book, bud.totalBudget)}` : "set budgets first"} />
        <Card title="Balance Sheet" page="bs"
          big={compactMoney(book, bs.totalAssets)}
          sub={`Assets · ${compactMoney(book, bs.totalLiabilities)} liabilities`}
          sub2={bs.balanced ? "✓ balanced" : "✗ out of balance"} />
      </div>
      <div style={{ height: 10 }} />
    </div>
  );
}

function PLPage({ book }) {
  const t = today();
  const fys = useMemo(() => {
    const s = new Set([fyOf(t)]);
    for (const e of book.entries) s.add(fyOf(e.date));
    return [...s].sort((a, b) => b - a);
  }, [book.entries, t]);
  const [fy, setFy] = useState(fyOf(t));
  const [span, setSpan] = useState("year");
  const [customFrom, setCustomFrom] = useState(t.slice(0, 8) + "01");
  const [customTo, setCustomTo] = useState(t);
  const [cmp, setCmp] = useState("off");
  const [openHead, setOpenHead] = useState("");

  const [from, to] =
    span === "year" ? fyRange(fy)
    : span.startsWith("q") ? fyRange(fy, +span[1])
    : span === "custom" ? [customFrom, customTo]
    : monthRange(fy, +span.slice(1));
  const pl = computePL(book, from, to);
  const [pFrom, pTo] = cmp === "off" ? [null, null] : compareRange(span, fy, from, to, cmp);
  const plPrev = cmp === "off" ? null : computePL(book, pFrom, pTo);

  const entriesFor = (type, head) =>
    book.entries
      .filter((e) => e.type === type && e.head === head && e.date >= from && e.date <= to)
      .sort((a, b) => b.date.localeCompare(a.date));

  const downloadCsv = () => {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [["Section", "Head", "Amount", ...(plPrev ? ["Previous", "Change"] : [])].map(esc).join(",")];
    const dump = (section, bag, prevBag) => {
      for (const [h, a] of Object.entries(bag)) {
        lines.push([section, h, a, ...(plPrev ? [prevBag[h] || 0, a - (prevBag[h] || 0)] : [])].map(esc).join(","));
      }
    };
    dump("Income", pl.income, plPrev ? plPrev.income : {});
    dump("Expenses", pl.expense, plPrev ? plPrev.expense : {});
    lines.push(["Total", "Income", pl.totalIncome, ...(plPrev ? [plPrev.totalIncome, pl.totalIncome - plPrev.totalIncome] : [])].map(esc).join(","));
    lines.push(["Total", "Expenses", pl.totalExpense, ...(plPrev ? [plPrev.totalExpense, pl.totalExpense - plPrev.totalExpense] : [])].map(esc).join(","));
    lines.push(["Total", "Net", pl.net, ...(plPrev ? [plPrev.net, pl.net - plPrev.net] : [])].map(esc).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cashbook-pl-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const Section = ({ title, bag, prevBag, type, totalName, total, prevTotal, goodWhenUp, color }) => (
    <div style={{ ...glass(20), padding: 16, marginTop: 12 }}>
      <div style={{ ...st.section, marginBottom: 6 }}>{title}</div>
      {Object.entries(bag).map(([h, a]) => {
        const open = openHead === `${type}:${h}`;
        return (
          <div key={h}>
            <div className="cb-press" onClick={() => setOpenHead(open ? "" : `${type}:${h}`)}
              style={{ display: "flex", padding: "6px 0", fontSize: 14, cursor: "pointer", alignItems: "baseline", color: C.soft }}>
              <span style={{ flex: 1 }}>
                <span style={{ color: C.faint, fontSize: 11, marginRight: 6 }}>{open ? "▾" : "▸"}</span>{h}
              </span>
              <span style={{ fontWeight: 700, color: "#fff" }}>{money(book, a)}</span>
            </div>
            {plPrev && <div style={{ marginLeft: 17 }}><Variance book={book} current={a} prev={prevBag[h] || 0} goodWhenUp={goodWhenUp} /></div>}
            {open && (
              <div style={{ margin: "2px 0 8px 17px", borderLeft: `2px solid ${C.line}`, paddingLeft: 10 }}>
                {entriesFor(type, h).map((e) => (
                  <div key={e.id} className="cb-row" style={{ display: "flex", gap: 8, fontSize: 12, padding: "3px 0", color: C.faint }}>
                    <span style={{ flexShrink: 0 }}>{prettyDate(e.date)}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.soft }}>{e.note || "—"}</span>
                    <span style={{ color: "#fff", fontWeight: 600 }}>{money(book, e.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {Object.keys(bag).length === 0 && <div style={{ fontSize: 13, color: C.muted }}>Nothing in this period.</div>}
      <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 4, paddingTop: 6 }}>
        <div style={{ display: "flex", fontSize: 15, fontWeight: 800 }}>
          <span style={{ flex: 1, color: C.ink }}>{totalName}</span>
          <span style={{ color }}>{money(book, total)}</span>
        </div>
        {plPrev && <Variance book={book} current={total} prev={prevTotal} goodWhenUp={goodWhenUp} />}
      </div>
    </div>
  );

  const spend = Object.entries(pl.expense).sort((a, b) => b[1] - a[1]);
  const spendMax = spend.length ? spend[0][1] : 0;

  return (
    <div className="cb-stagger">
      <div className="cb-noprint" style={{ display: "flex", gap: 8 }}>
        <select style={{ ...st.input, flex: "0 0 118px" }} value={fy} onChange={(e) => setFy(+e.target.value)}>
          {fys.map((y) => <option key={y} value={y}>FY {y}–{String(y + 1).slice(2)}</option>)}
        </select>
        <select style={st.input} value={span} onChange={(e) => setSpan(e.target.value)}>
          <option value="year">Full year</option>
          <option value="q1">Q1 · Apr–Jun</option>
          <option value="q2">Q2 · Jul–Sep</option>
          <option value="q3">Q3 · Oct–Dec</option>
          <option value="q4">Q4 · Jan–Mar</option>
          {MONTH_NAMES.map((m, i) => <option key={m} value={`m${i}`}>{m} {i < 9 ? fy : fy + 1}</option>)}
          <option value="custom">Custom range…</option>
        </select>
      </div>
      {span === "custom" && (
        <div className="cb-noprint" style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input style={st.input} type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <input style={st.input} type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </div>
      )}
      <div className="cb-noprint" style={{ marginTop: 8 }}>
        <Seg
          value={cmp}
          onChange={setCmp}
          options={[
            { v: "off", label: "No compare" },
            { v: "prev", label: "vs previous" },
            { v: "lastyear", label: "vs last year" },
          ]}
        />
        {plPrev && (
          <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>
            Comparing {from} → {to} with {pFrom} → {pTo}
          </div>
        )}
      </div>
      <div className="cb-noprint" style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <GhostBtn style={{ flex: 1, padding: "9px 0", fontSize: 12.5 }} onClick={downloadCsv}>⇩ Export CSV</GhostBtn>
        <GhostBtn style={{ flex: 1, padding: "9px 0", fontSize: 12.5 }} onClick={() => window.print()}>⎙ Print / PDF</GhostBtn>
      </div>

      <Section title="Income" bag={pl.income} prevBag={plPrev ? plPrev.income : {}} type="in"
        totalName="Total income" total={pl.totalIncome} prevTotal={plPrev ? plPrev.totalIncome : 0}
        goodWhenUp color={C.green} />
      <Section title="Expenses" bag={pl.expense} prevBag={plPrev ? plPrev.expense : {}} type="out"
        totalName="Total expenses" total={pl.totalExpense} prevTotal={plPrev ? plPrev.totalExpense : 0}
        goodWhenUp={false} color={C.red} />

      {spend.length > 0 && (
        <div style={{ ...glass(20), padding: 16, marginTop: 12 }}>
          <div style={{ ...st.section, marginBottom: 10 }}>Where it went</div>
          {spend.map(([h, a]) => (
            <div key={h} style={{ marginBottom: 9 }}>
              <div style={{ display: "flex", fontSize: 12, marginBottom: 3, color: C.soft }}>
                <span style={{ flex: 1 }}>{h}</span>
                <span style={{ fontWeight: 700, color: "#fff" }}>{money(book, a)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, background: C.grad, width: `${Math.max(2, Math.round((a / spendMax) * 100))}%`, transition: "width .4s ease" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...glass(20), padding: 16, marginTop: 12, marginBottom: 8 }}>
        <div style={{ display: "flex" }}>
          <span style={{ flex: 1, fontWeight: 800, color: C.ink }}>Net {pl.net >= 0 ? "surplus" : "deficit"}</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: pl.net >= 0 ? C.green : C.red }}>{money(book, pl.net)}</span>
        </div>
        {plPrev && <Variance book={book} current={pl.net} prev={plPrev.net} goodWhenUp />}
        <div style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>
          Cash basis · transfers, party entries and SIP-type heads excluded
        </div>
      </div>
    </div>
  );
}

function BSPage({ book }) {
  const t = today();
  const [asOf, setAsOf] = useState(t);
  const [cmpAsOf, setCmpAsOf] = useState("");
  const bs = computeBS(book, asOf || t);
  const bsPrev = cmpAsOf ? computeBS(book, cmpAsOf) : null;

  const downloadCsv = () => {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [["Section", "Line", "Amount", ...(bsPrev ? ["Previous", "Change"] : [])].map(esc).join(",")];
    const dump = (section, rows, prevRows) => {
      for (const r of rows) {
        const p = prevRows ? (prevRows.find((x) => x.name === r.name) || { amount: 0 }).amount : null;
        lines.push([section, r.name, r.amount, ...(bsPrev ? [p, r.amount - p] : [])].map(esc).join(","));
      }
    };
    dump("Assets", bs.assets, bsPrev && bsPrev.assets);
    dump("Liabilities", bs.liabilities, bsPrev && bsPrev.liabilities);
    dump("Equity", bs.equity, bsPrev && bsPrev.equity);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cashbook-bs-${asOf}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const Row = ({ name, amount, prev, strong, color }) => (
    <div style={{ padding: "5px 0" }}>
      <div style={{ display: "flex", fontSize: strong ? 15 : 14, fontWeight: strong ? 800 : 500, color: C.soft }}>
        <span style={{ flex: 1 }}>{name}</span>
        <span style={{ color: color || "#fff", fontWeight: strong ? 800 : 600 }}>{money(book, amount)}</span>
      </div>
      {prev !== undefined && prev !== null && <Variance book={book} current={amount} prev={prev} goodWhenUp />}
    </div>
  );

  return (
    <div className="cb-stagger">
      <div className="cb-noprint" style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ ...st.label, margin: "0 0 4px" }}>As of</label>
          <input style={st.input} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ ...st.label, margin: "0 0 4px" }}>Compare as of</label>
          <input style={st.input} type="date" value={cmpAsOf} onChange={(e) => setCmpAsOf(e.target.value)} />
        </div>
      </div>
      <div className="cb-noprint" style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <GhostBtn style={{ flex: 1, padding: "9px 0", fontSize: 12.5 }} onClick={downloadCsv}>⇩ Export CSV</GhostBtn>
        <GhostBtn style={{ flex: 1, padding: "9px 0", fontSize: 12.5 }} onClick={() => window.print()}>⎙ Print / PDF</GhostBtn>
      </div>
      {[
        { title: "Assets", rows: bs.assets, prevRows: bsPrev && bsPrev.assets, totalName: "Total assets", total: bs.totalAssets, prevTotal: bsPrev && bsPrev.totalAssets },
        { title: "Liabilities", rows: bs.liabilities, prevRows: bsPrev && bsPrev.liabilities, totalName: "Total liabilities", total: bs.totalLiabilities, prevTotal: bsPrev && bsPrev.totalLiabilities },
        { title: "Equity", rows: bs.equity, prevRows: bsPrev && bsPrev.equity, totalName: "Total equity", total: bs.totalEquity, prevTotal: bsPrev && bsPrev.totalEquity },
      ].map((sec) => (
        <div key={sec.title} style={{ ...glass(20), padding: 16, marginTop: 12 }}>
          <div style={{ ...st.section, marginBottom: 6 }}>{sec.title}</div>
          {sec.rows.map((r) => (
            <Row key={r.name} name={r.name} amount={r.amount}
              prev={sec.prevRows ? (sec.prevRows.find((p) => p.name === r.name) || { amount: 0 }).amount : undefined} />
          ))}
          <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 4 }}>
            <Row name={sec.totalName} amount={sec.total} strong prev={sec.prevTotal != null && bsPrev ? sec.prevTotal : undefined} />
          </div>
        </div>
      ))}
      <div style={{ ...glass(20), padding: 16, marginTop: 12, marginBottom: 8, textAlign: "center", fontSize: 13.5, color: C.soft }}>
        Assets {money(book, bs.totalAssets)} = Liabilities {money(book, bs.totalLiabilities)} + Equity {money(book, bs.totalEquity)}{" "}
        <b style={{ color: bs.balanced ? C.green : C.red }}>{bs.balanced ? "✓ balanced" : "✗ OUT OF BALANCE"}</b>
      </div>
    </div>
  );
}

function CatSpendPage({ book }) {
  const t = today();
  const [span, setSpan] = useState("month");
  const [from, to] =
    span === "month" ? [t.slice(0, 8) + "01", t]
    : span === "prev" ? compareRange("m0", fyOf(t), t.slice(0, 8) + "01", t, "prev")
    : fyRange(fyOf(t));
  const pl = computePL(book, from, to);
  const rows = Object.entries(pl.expense).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, rows.length ? rows[0][1] : 0);
  return (
    <div className="cb-stagger">
      <Seg value={span} onChange={setSpan} options={[
        { v: "month", label: "This month" },
        { v: "prev", label: "Last month" },
        { v: "fy", label: "This FY" },
      ]} />
      <div style={{ ...glass(20), padding: 16, marginTop: 12, marginBottom: 8 }}>
        <div style={{ ...st.section, marginBottom: 4 }}>Category Spending</div>
        <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 12 }}>{from} → {to} · total {money(book, pl.totalExpense)}</div>
        {rows.map(([h, a], i) => (
          <div key={h} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", fontSize: 12.5, marginBottom: 3, color: C.soft }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                {h}
              </span>
              <span style={{ fontWeight: 700, color: "#fff" }}>{money(book, a)}</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 4, background: SLICE_COLORS[i % SLICE_COLORS.length], width: `${a > 0 ? Math.max(2, Math.round((a / max) * 100)) : 0}%` }} />
            </div>
          </div>
        ))}
        {rows.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>No spending in this period.</div>}
      </div>
    </div>
  );
}

function CashFlowPage({ book }) {
  const t = today();
  const months = [];
  const base = new Date(t.slice(0, 7) + "-01T00:00:00");
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const from = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const to = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
    let mIn = 0, mOut = 0;
    for (const e of book.entries) {
      if (e.date < from || e.date > to) continue;
      if (!isExplained(e)) continue;
      entrySign(e) > 0 ? (mIn += e.amount) : (mOut += e.amount);
    }
    months.push({ label: monthShort(from), in: mIn, out: mOut, net: mIn - mOut });
  }
  const max = Math.max(1, ...months.map((m) => Math.max(m.in, m.out)));
  return (
    <div className="cb-stagger">
      <div style={{ ...glass(20), padding: 16 }}>
        <div style={{ ...st.section, marginBottom: 4 }}>Cash Flow</div>
        <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 14 }}>All bank movement, last 6 months</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 120 }}>
          {months.map((m) => (
            <div key={m.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 92 }}>
                <div style={{ width: 9, borderRadius: 4, background: C.greenGrad, height: `${Math.max(3, (m.in / max) * 100)}%` }} />
                <div style={{ width: 9, borderRadius: 4, background: C.redGrad, height: `${Math.max(3, (m.out / max) * 100)}%` }} />
              </div>
              <div style={{ fontSize: 10, color: C.faint, fontWeight: 600 }}>{m.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 11, color: "#c9bfe0", fontWeight: 600 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: "#34d399" }} /> Money in</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: "#fb7185" }} /> Money out</span>
        </div>
      </div>
      <div style={{ ...glass(20), padding: "4px 16px", marginTop: 12, marginBottom: 8 }}>
        {months.slice().reverse().map((m) => (
          <div key={m.label} style={{ display: "flex", alignItems: "center", padding: "11px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: C.soft }}>{m.label}</div>
            <div style={{ fontSize: 12, color: C.muted, marginRight: 12 }}>
              +{compactMoney(book, m.in)} / −{compactMoney(book, m.out)}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: m.net >= 0 ? C.green : C.red }}>
              {m.net >= 0 ? "+" : "−"}{money(book, Math.abs(m.net))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetAmount({ book, value, onCommit }) {
  const [v, setV] = useState(value ? String(value) : "");
  useEffect(() => setV(value ? String(value) : ""), [value]);
  return (
    <input
      style={{ ...st.input, width: 108, textAlign: "right", padding: "8px 10px", fontSize: 13.5, fontWeight: 700 }}
      inputMode="decimal"
      placeholder="—"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = v.trim() === "" ? 0 : parseAmount(v);
        if (!isNaN(n)) onCommit(n);
        else setV(value ? String(value) : "");
      }}
    />
  );
}

function BudgetPage({ book, up }) {
  const bud = budgetStatus(book);
  const pct = bud.totalBudget ? Math.max(0, Math.min(999, Math.round((bud.totalSpent / bud.totalBudget) * 100))) : 0;
  return (
    <div className="cb-stagger">
      <div style={{ ...glass(20), padding: 16 }}>
        <div style={{ ...st.section }}>This Month</div>
        {bud.totalBudget > 0 ? (
          <>
            <div style={{ fontSize: 26, fontWeight: 800, color: pct > 100 ? C.red : "#fff", marginTop: 8 }}>
              {pct}% used
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {money(book, bud.totalSpent)} spent of {money(book, bud.totalBudget)} · {money(book, Math.max(0, bud.totalBudget - bud.totalSpent))} left
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,.08)", marginTop: 12, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 999, width: `${Math.min(100, pct)}%`, background: pct > 100 ? C.redGrad : C.grad }} />
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>
            Set a monthly budget per category below — progress appears here.
          </div>
        )}
      </div>
      <div style={{ ...glass(20), padding: "8px 16px 16px", marginTop: 12, marginBottom: 8 }}>
        {book.heads.expense.filter((h) => !book.headClass[h]).map((h) => {
          const budget = book.budgets[h] || 0;
          const spent = bud.expense[h] || 0;
          const p = budget ? Math.max(0, Math.round((spent / budget) * 100)) : null;
          return (
            <div key={h} style={{ padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{h}</div>
                  <div style={{ fontSize: 11.5, color: p !== null && p > 100 ? C.red : C.muted, marginTop: 1 }}>
                    {money(book, spent)} spent{p !== null ? ` · ${p}% of budget` : ""}
                  </div>
                </div>
                <BudgetAmount book={book} value={budget}
                  onCommit={(n) => up((b) => ((n > 0 ? (b.budgets[h] = n) : delete b.budgets[h]), b))} />
              </div>
              {budget > 0 && (
                <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,.08)", marginTop: 8, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 999, width: `${Math.min(100, p)}%`, background: p > 100 ? C.redGrad : p > 80 ? C.amberGrad : C.greenGrad }} />
                </div>
              )}
            </div>
          );
        })}
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10 }}>
          Amounts understand 2k / 1.2L. Clear a field to remove that budget.
        </div>
      </div>
    </div>
  );
}

function BankBalancesPage({ book, go }) {
  const accounts = accountModels(book);
  return (
    <div className="cb-stagger">
      <div style={{ ...glass(20), padding: "4px 16px", marginBottom: 8 }}>
        {accounts.map((a, i) => (
          <div key={a.id} className="cb-press" onClick={() => go("account", a.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: `1px solid ${C.line}`, cursor: "pointer" }}>
            <Orb size={38} radius={11} grad={a.type === "credit_card" ? C.redGrad : C.blueGrad}>
              <Ic name={a.type === "credit_card" ? "card" : "bank"} size={16} />
            </Orb>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{a.name}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>
                {a.kind === "liability" ? "Liability" : "Asset"}{a.last4 ? ` · •••• ${a.last4}` : ""}
              </div>
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: "#fff" }}>{money(book, a.balance)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountDetailPage({ book, accId, onEdit }) {
  const accounts = accountModels(book);
  const acc = accounts.find((a) => a.id === accId);
  if (!acc) return <div style={{ color: C.muted, padding: 30 }}>Account not found.</div>;
  const name = accId.startsWith("acct:") ? accId.slice(5) : null;
  const related = book.entries
    .filter((e) => {
      if (!name) return true; // bank: everything moves through it
      return (e.type === "transfer" && e.account === name) ||
        ((e.type === "in" || e.type === "out") && book.headClass[e.head] === name);
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 40);
  const shown = useCountUp(acc.balance);
  return (
    <div className="cb-stagger">
      <div style={{ ...glass(22), padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Orb size={38} grad={acc.type === "credit_card" ? C.grad : C.blueGrad}>
            <Ic name={acc.type === "credit_card" ? "card" : "bank"} size={16} />
          </Orb>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>{acc.name}</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>{acc.kind === "liability" ? "Outstanding balance" : "Available balance"}</div>
          </div>
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#fff", marginTop: 12, fontVariantNumeric: "tabular-nums" }}>
          {money(book, shown)}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10, fontSize: 10.5 }}>
          <span style={{ background: "rgba(167,139,250,.2)", border: "1px solid rgba(167,139,250,.4)", color: "#e2d6fb", padding: "3px 8px", borderRadius: 999, fontWeight: 700 }}>
            in {money(book, acc.monthIn)} this month
          </span>
          <span style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)", color: "#d3c8e8", padding: "3px 8px", borderRadius: 999, fontWeight: 700 }}>
            out {money(book, acc.monthOut)}
          </span>
        </div>
      </div>
      <div style={{ margin: "16px 0 8px", ...st.section }}>Recent activity</div>
      <div style={{ ...glass(18), overflow: "hidden", marginBottom: 8 }}>
        {related.map((e, i) => (
          <div key={e.id} className="cb-row cb-press" onClick={() => onEdit(e)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderTop: i ? `1px solid ${C.line}` : "none", cursor: "pointer" }}>
            <div style={{ width: 52, fontSize: 11, color: C.faint, fontWeight: 600, flexShrink: 0 }}>{prettyDate(e.date).replace(/^\w+, /, "")}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{entryLabel(book, e)}</div>
              {e.note && <div style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflowe: "ellipsis" }}>{e.note}</div>}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: entrySign(e) > 0 ? C.green : C.red }}>
              {entrySign(e) > 0 ? "+" : "−"}{money(book, e.amount)}
            </div>
          </div>
        ))}
        {related.length === 0 && <div style={{ fontSize: 13, color: C.muted, padding: 16 }}>No activity yet.</div>}
      </div>
    </div>
  );
}
/* ────────────────────────── Setup suite ────────────────────────── */
function SetupRow({ grad, icon, title, sub, onClick, last }) {
  return (
    <div className="cb-press" onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderTop: last === 0 ? "none" : `1px solid ${C.line}`, cursor: "pointer" }}>
      <Orb size={38} radius={11} grad={grad}><Ic name={icon} size={16} /></Orb>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: C.ink }}>{title}</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{sub}</div>
      </div>
      <span style={{ color: C.faint, fontSize: 15 }}>›</span>
    </div>
  );
}

function SetupHub({ book, go }) {
  const cats = book.heads.income.length + book.heads.expense.length;
  const lock = book.prefs.lock || {};
  const notifCount = Object.values(book.prefs.notifs || {}).filter(Boolean).length;
  return (
    <div className="cb-stagger">
      <div style={st.h1}>Setup</div>
      <div style={st.sub}>Accounts, categories, preferences, and your data</div>
      <div style={st.eyebrow}>Account</div>
      <div style={{ ...glass(18), marginBottom: 18, overflow: "hidden", background: C.glassSoft, border: C.borderSoft }}>
        <SetupRow last={0} grad={C.skyGrad} icon="bank" title="Accounts" sub={`${book.bsAccounts.length + 1} linked`} onClick={() => go("setupAccounts")} />
        <SetupRow grad={C.grad} icon="tag" title="Categories" sub={`${cats} categories`} onClick={() => go("setupCategories")} />
        <SetupRow grad={C.tealGrad} icon="people" title="Parties" sub={`${book.parties.length} people`} onClick={() => go("setupParties")} />
      </div>
      <div style={st.eyebrow}>Preferences</div>
      <div style={{ ...glass(18), marginBottom: 18, overflow: "hidden", background: C.glassSoft, border: C.borderSoft }}>
        <SetupRow last={0} grad={C.amberGrad} icon="calendar" title="Currency & Date" sub={`${book.prefs.currency} · ${{ dmy: "DD-MM-YYYY", mdy: "MM-DD-YYYY", ymd: "YYYY-MM-DD" }[book.prefs.dateFmt]}`} onClick={() => go("setupPrefs")} />
        <SetupRow grad={C.redGrad} icon="bell" title="Notifications" sub={`${notifCount} enabled`} onClick={() => go("setupNotifs")} />
        <SetupRow grad={C.indigoGrad} icon="shield" title="Security" sub={lock.on && lock.pin ? "App lock on" : "App lock off"} onClick={() => go("setupSecurity")} />
      </div>
      <div style={st.eyebrow}>Data</div>
      <div style={{ ...glass(18), overflow: "hidden", background: C.glassSoft, border: C.borderSoft }}>
        <SetupRow last={0} grad={C.grayGrad} icon="download" title="Backup & Data" sub="Export, import, or reset" onClick={() => go("setupData")} />
      </div>
      <div style={{ height: 10 }} />
    </div>
  );
}

function NameEditor({ value, onCommit, placeholder }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      style={{ ...st.input, flex: 1, padding: "9px 11px", fontSize: 14 }}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = v.trim();
        if (n && n !== value) onCommit(n);
        else setV(value);
      }}
    />
  );
}

function OpeningAmount({ book, value, onCommit }) {
  const [v, setV] = useState(String(value || 0));
  useEffect(() => setV(String(value || 0)), [value]);
  return (
    <input
      style={{ ...st.input, width: 104, textAlign: "right", padding: "9px 10px", fontSize: 13.5, fontWeight: 700 }}
      inputMode="decimal"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = parseAmount(v);
        if (!isNaN(n)) onCommit(n);
        else setV(String(value || 0));
      }}
    />
  );
}

function SetupAccountsPage({ book, up }) {
  const [confirmDel, setConfirmDel] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("asset");
  const [last4, setLast4] = useState("");
  const [opening, setOpening] = useState("");

  const renameAccount = (oldName, newName) =>
    up((b) => {
      if (b.bsAccounts.some((a) => a.name === newName)) return b;
      const a = b.bsAccounts.find((x) => x.name === oldName);
      if (!a) return b;
      a.name = newName;
      for (const e of b.entries) if (e.type === "transfer" && e.account === oldName) e.account = newName;
      for (const h of Object.keys(b.headClass)) if (b.headClass[h] === oldName) b.headClass[h] = newName;
      if (b.opening.accounts[oldName] != null) {
        b.opening.accounts[newName] = b.opening.accounts[oldName];
        delete b.opening.accounts[oldName];
      }
      return b;
    });

  let openingCapital = book.opening.bank || 0;
  for (const a of book.bsAccounts) {
    const o = book.opening.accounts[a.name] || 0;
    openingCapital += a.kind === "liability" ? -o : o;
  }

  return (
    <div className="cb-stagger">
      {confirmDel && (
        <div className="cb-view" style={{ background: "rgba(251,113,133,.1)", border: "1px solid rgba(251,113,133,.3)", borderRadius: 16, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.red }}>Delete {confirmDel}?</div>
          <div style={{ fontSize: 12, color: C.soft, marginTop: 4 }}>
            Past transactions keep their history; the account just stops being tracked on the balance sheet.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <GhostBtn style={{ padding: "10px 0" }} onClick={() => setConfirmDel("")}>Cancel</GhostBtn>
            <PrimaryBtn danger style={{ padding: "10px 0" }} onClick={() => {
              up((b) => {
                b.bsAccounts = b.bsAccounts.filter((a) => a.name !== confirmDel);
                for (const h of Object.keys(b.headClass)) if (b.headClass[h] === confirmDel) delete b.headClass[h];
                return b;
              });
              setConfirmDel("");
            }}>Delete</PrimaryBtn>
          </div>
        </div>
      )}

      <div style={{ ...glass(18), overflow: "hidden", background: C.glassSoft, border: C.borderSoft }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px" }}>
          <Orb size={38} radius={11} grad={C.blueGrad}><Ic name="bank" size={16} /></Orb>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>Bank</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>Primary account · opening balance</div>
          </div>
          <OpeningAmount book={book} value={book.opening.bank}
            onCommit={(n) => up((b) => ((b.opening.bank = n), b))} />
        </div>
        {book.bsAccounts.map((a) => (
          <div key={a.name} style={{ padding: "13px 16px", borderTop: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Orb size={38} radius={11} grad={a.kind === "liability" ? C.redGrad : C.amberGrad}>
                <Ic name={a.kind === "liability" ? "card" : "coins"} size={16} />
              </Orb>
              <NameEditor value={a.name} onCommit={(n) => renameAccount(a.name, n)} />
              <button className="cb-press" onClick={() =>
                up((b) => {
                  const x = b.bsAccounts.find((y) => y.name === a.name);
                  if (x) x.kind = x.kind === "asset" ? "liability" : "asset";
                  return b;
                })}
                style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,.16)", background: "rgba(255,255,255,.05)", color: C.soft, fontSize: 12, fontWeight: 700, fontFamily: F.sans, cursor: "pointer" }}>
                {a.kind}
              </button>
              <RoundBtn style={{ width: 30, height: 30 }} aria-label={`Delete ${a.name}`} onClick={() => setConfirmDel(a.name)}>
                <Ic name="trash" size={13} stroke={C.red} />
              </RoundBtn>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingLeft: 48 }}>
              <span style={{ flex: 1, fontSize: 11.5, color: C.muted }}>Opening balance</span>
              <OpeningAmount book={book} value={book.opening.accounts[a.name] || 0}
                onCommit={(n) => up((b) => ((b.opening.accounts[a.name] = n), b))} />
            </div>
          </div>
        ))}
      </div>

      {!adding ? (
        <button className="cb-press" onClick={() => setAdding(true)}
          style={{ width: "100%", marginTop: 14, padding: "13px 0", border: "1px dashed rgba(255,255,255,.25)", borderRadius: 14, background: "rgba(255,255,255,.04)", color: C.accentText, fontWeight: 700, fontSize: 13.5, fontFamily: F.sans, cursor: "pointer" }}>
          + Add Account
        </button>
      ) : (
        <div className="cb-view" style={{ ...glass(20), padding: 18, marginTop: 14 }}>
          <label style={{ ...st.label, margin: "0 0 6px" }}>Account Name</label>
          <input style={st.input} value={name} placeholder="e.g. HDFC Credit Card" onChange={(e) => setName(e.target.value)} />
          <label style={st.label}>Type</label>
          <Seg value={kind} onChange={setKind} options={[
            { v: "asset", label: "Asset / Bank" },
            { v: "liability", label: "Credit Card / Loan" },
          ]} />
          <label style={st.label}>Last 4 Digits (optional)</label>
          <input style={st.input} value={last4} maxLength={4} inputMode="numeric" placeholder="1234" onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
          <label style={st.label}>Opening Balance</label>
          <input style={{ ...st.input, fontSize: 20, fontWeight: 700 }} value={opening} inputMode="decimal" placeholder="0" onChange={(e) => setOpening(e.target.value)} />
          <PrimaryBtn
            style={{ width: "100%", marginTop: 18, opacity: name.trim() ? 1 : 0.5 }}
            disabled={!name.trim()}
            onClick={() => {
              const n = name.trim();
              const open = parseAmount(opening);
              if (!n || book.bsAccounts.some((a) => a.name === n)) return;
              up((b) => {
                b.bsAccounts.push({ name: n, kind, last4: last4 || undefined });
                if (!isNaN(open) && open) b.opening.accounts[n] = open;
                return b;
              });
              setAdding(false); setName(""); setLast4(""); setOpening("");
            }}
          >
            Add Account
          </PrimaryBtn>
        </div>
      )}

      <div style={{ ...glass(18), padding: "13px 16px", marginTop: 14, marginBottom: 8, display: "flex", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>Opening capital (derived)</div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 1 }}>Computed so the balance sheet always foots</div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.accentText }}>{money(book, openingCapital)}</div>
      </div>
    </div>
  );
}

function CategoryChips({ book, up, side, accent }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const border = accent === "green" ? "1px solid rgba(110,231,183,.3)" : "1px solid rgba(167,139,250,.3)";
  const bg = accent === "green" ? "rgba(110,231,183,.1)" : "rgba(167,139,250,.1)";
  const color = accent === "green" ? C.green : C.accentText;
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10 }}>
        {book.heads[side].map((h) => (
          <div key={h} className="cb-chip-pop" style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 8px 7px 13px", borderRadius: 999, border, background: bg, color, fontSize: 12.5, fontWeight: 700 }}>
            {h}{book.headClass[h] ? ` → ${book.headClass[h]}` : ""}
            {h !== "Suspense" && (
              <button
                className="cb-press"
                aria-label={`Remove ${h}`}
                onClick={() => up((b) => ((b.heads[side] = b.heads[side].filter((x) => x !== h)), delete b.headClass[h], delete b.budgets[h], b))}
                style={{ width: 18, height: 18, borderRadius: 999, border: "none", background: "rgba(255,255,255,.14)", color: "#fff", fontSize: 11, padding: 0, cursor: "pointer", lineHeight: "18px" }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button className="cb-press" onClick={() => setAdding(!adding)}
          style={{ padding: "7px 14px", borderRadius: 999, border: "1px dashed rgba(255,255,255,.3)", background: "none", color: C.accentText, fontSize: 12.5, fontWeight: 700, fontFamily: F.sans, cursor: "pointer" }}>
          + Add
        </button>
      </div>
      {adding && (
        <div className="cb-view" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input style={{ ...st.input, flex: 1, padding: "10px 12px", fontSize: 14 }} value={name} placeholder="Category name" onChange={(e) => setName(e.target.value)} />
          <button className="cb-press" onClick={() => {
            const n = name.trim();
            if (n && !book.heads[side].includes(n)) up((b) => (b.heads[side].push(n), b));
            setName(""); setAdding(false);
          }}
            style={{ padding: "10px 16px", border: "none", borderRadius: 10, background: C.grad, color: "#fff", fontWeight: 700, fontSize: 13, fontFamily: F.sans, cursor: "pointer" }}>
            Save
          </button>
          <button className="cb-press" onClick={() => { setAdding(false); setName(""); }}
            style={{ padding: "10px 14px", border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, background: "none", color: C.ink, fontWeight: 700, fontSize: 13, fontFamily: F.sans, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

function SetupCategoriesPage({ book, up }) {
  const [mapHead, setMapHead] = useState("");
  const [mapAcct, setMapAcct] = useState("");
  const [ruleMatch, setRuleMatch] = useState("");
  const [ruleHead, setRuleHead] = useState("");
  return (
    <div className="cb-stagger">
      <div style={st.eyebrow}>Income Categories</div>
      <CategoryChips book={book} up={up} side="income" accent="green" />
      <div style={st.eyebrow}>Expense Categories</div>
      <CategoryChips book={book} up={up} side="expense" accent="violet" />

      <div style={{ ...glass(20), padding: 16, marginTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>Post a category to an account</div>
        <div style={{ fontSize: 11.5, color: C.muted, margin: "3px 0 10px" }}>
          Mapped categories (like SIP → Investments) build the balance sheet instead of hitting the P&L.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select style={{ ...st.input, flex: 1, padding: "9px 10px", fontSize: 13 }} value={mapHead} onChange={(e) => setMapHead(e.target.value)}>
            <option value="">category…</option>
            {[...book.heads.expense, ...book.heads.income].map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <select style={{ ...st.input, flex: 1, padding: "9px 10px", fontSize: 13 }} value={mapAcct} onChange={(e) => setMapAcct(e.target.value)}>
            <option value="">P&L (none)</option>
            {book.bsAccounts.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
          <button className="cb-press" disabled={!mapHead}
            onClick={() => up((b) => ((mapAcct ? (b.headClass[mapHead] = mapAcct) : delete b.headClass[mapHead]), b))}
            style={{ padding: "9px 14px", border: "none", borderRadius: 10, background: C.grad, color: "#fff", fontWeight: 700, fontSize: 12.5, fontFamily: F.sans, cursor: "pointer", opacity: mapHead ? 1 : 0.5 }}>
            Set
          </button>
        </div>
      </div>

      <div style={{ ...glass(20), padding: 16, marginTop: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>Import rules</div>
        <div style={{ fontSize: 11.5, color: C.muted, margin: "3px 0 10px" }}>
          Keyword → category mappings the statement importer uses. It learns when you fix categories on the review screen.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(book.codingRules || []).map((r, i) => (
            <span key={`${r.match}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, border: "1px solid rgba(255,255,255,.14)", borderRadius: 999, padding: "4px 8px", color: C.soft }}>
              {r.match} → {r.head}
              <button className="cb-press" aria-label={`Remove rule ${r.match}`}
                onClick={() => up((b) => ((b.codingRules = b.codingRules.filter((x) => !(x.match === r.match && x.head === r.head))), b))}
                style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 13, padding: 0 }}>
                ✕
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input style={{ ...st.input, flex: 1, padding: "9px 10px", fontSize: 13 }} placeholder="keyword" value={ruleMatch} onChange={(e) => setRuleMatch(e.target.value)} />
          <select style={{ ...st.input, flex: 1, padding: "9px 10px", fontSize: 13 }} value={ruleHead} onChange={(e) => setRuleHead(e.target.value)}>
            <option value="">category…</option>
            {[...book.heads.expense, ...book.heads.income].map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <button className="cb-press" disabled={!ruleMatch.trim() || !ruleHead}
            onClick={() => {
              const match = ruleMatch.trim().toLowerCase();
              if (!match || !ruleHead) return;
              up((b) => {
                const ex = b.codingRules.find((x) => x.match === match);
                if (ex) ex.head = ruleHead;
                else b.codingRules.push({ match, head: ruleHead });
                return b;
              });
              setRuleMatch(""); setRuleHead("");
            }}
            style={{ padding: "9px 14px", border: "none", borderRadius: 10, background: C.grad, color: "#fff", fontWeight: 700, fontSize: 12.5, fontFamily: F.sans, cursor: "pointer", opacity: ruleMatch.trim() && ruleHead ? 1 : 0.5 }}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function SetupPartiesPage({ book, up }) {
  const [confirmDel, setConfirmDel] = useState(null);
  const [newParty, setNewParty] = useState("");
  return (
    <div className="cb-stagger">
      {confirmDel && (
        <div className="cb-view" style={{ background: "rgba(251,113,133,.1)", border: "1px solid rgba(251,113,133,.3)", borderRadius: 16, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.red }}>Remove {partyName(book, confirmDel)}?</div>
          <div style={{ fontSize: 12, color: C.soft, marginTop: 4 }}>Their past entries stay in your records.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <GhostBtn style={{ padding: "10px 0" }} onClick={() => setConfirmDel(null)}>Cancel</GhostBtn>
            <PrimaryBtn danger style={{ padding: "10px 0" }} onClick={() => {
              up((b) => ((b.parties = b.parties.filter((p) => p.id !== confirmDel)), b));
              setConfirmDel(null);
            }}>Remove</PrimaryBtn>
          </div>
        </div>
      )}
      <div style={{ ...glass(18), padding: "4px 16px", background: C.glassSoft, border: C.borderSoft }}>
        {book.parties.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
            <Avatar name={p.name} index={i} size={32} />
            <NameEditor value={p.name} onCommit={(n) => up((b) => {
              const x = b.parties.find((y) => y.id === p.id);
              if (x) x.name = n;
              return b;
            })} />
            <RoundBtn style={{ width: 32, height: 32 }} aria-label={`Remove ${p.name}`} onClick={() => setConfirmDel(p.id)}>
              <Ic name="trash" size={13} stroke={C.red} />
            </RoundBtn>
          </div>
        ))}
        {book.parties.length === 0 && <div style={{ fontSize: 13, color: C.muted, padding: "14px 0" }}>No parties yet.</div>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14, marginBottom: 8 }}>
        <input style={{ ...st.input, flex: 1 }} placeholder="New party name" value={newParty} onChange={(e) => setNewParty(e.target.value)} />
        <button className="cb-press" disabled={!newParty.trim()}
          onClick={() => {
            if (!newParty.trim()) return;
            up((b) => (b.parties.push({ id: uid(), name: newParty.trim() }), b));
            setNewParty("");
          }}
          style={{ padding: "11px 18px", border: "none", borderRadius: 12, background: C.grad, color: "#fff", fontWeight: 700, fontSize: 13.5, fontFamily: F.sans, cursor: "pointer", opacity: newParty.trim() ? 1 : 0.5 }}>
          Add
        </button>
      </div>
    </div>
  );
}

function SetupPrefsPage({ book, up }) {
  const OptBtn = ({ active, label, onClick, big }) => (
    <button className="cb-press" onClick={onClick}
      style={{
        flex: 1, padding: "11px 0", borderRadius: 12, fontFamily: F.sans, cursor: "pointer",
        border: `1px solid ${active ? "rgba(167,139,250,.5)" : "rgba(255,255,255,.16)"}`,
        background: active ? "rgba(167,139,250,.18)" : "rgba(255,255,255,.05)",
        color: active ? C.accentText : C.soft, fontSize: big ? 16 : 13.5, fontWeight: big ? 800 : 700,
      }}>
      {label}
    </button>
  );
  return (
    <div className="cb-stagger">
      <div style={{ ...glass(20), padding: 18, marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 10 }}>Currency</div>
        <div style={{ display: "flex", gap: 8 }}>
          {["₹", "$", "€", "£"].map((s) => (
            <OptBtn key={s} big active={book.prefs.currency === s} label={s}
              onClick={() => up((b) => ((b.prefs.currency = s), b))} />
          ))}
        </div>
      </div>
      <div style={{ ...glass(20), padding: 18, marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 10 }}>Date Format</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["dmy", "DD-MM-YYYY"], ["mdy", "MM-DD-YYYY"], ["ymd", "YYYY-MM-DD"]].map(([v, l]) => (
            <OptBtn key={v} active={book.prefs.dateFmt === v} label={l}
              onClick={() => up((b) => ((b.prefs.dateFmt = v), b))} />
          ))}
        </div>
      </div>
      <div style={{ ...glass(20), padding: 18, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em" }}>Preview</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginTop: 8 }}>{money(book, 125430)}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{fmtDate(book, today())}</div>
      </div>
    </div>
  );
}

function SetupNotifsPage({ book, up }) {
  const rows = [
    { key: "backup", label: "Backup reminders", sub: "Nudge when your last export is over 30 days old" },
    { key: "suspense", label: "Re-coding reminders", sub: "Show how many entries are parked in Suspense" },
    { key: "dues", label: "Dues", sub: "Surface people you owe on the dashboard and bell" },
  ];
  return (
    <div className="cb-stagger">
      <div style={{ ...glass(18), overflow: "hidden", background: C.glassSoft, border: C.borderSoft, marginBottom: 8 }}>
        {rows.map((r, i) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderTop: i ? `1px solid ${C.line}` : "none" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{r.label}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{r.sub}</div>
            </div>
            <Toggle on={!!book.prefs.notifs[r.key]} onChange={(v) => up((b) => ((b.prefs.notifs[r.key] = v), b))} />
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: C.faint, padding: "0 2px" }}>
        All alerts are computed on this phone — nothing is sent anywhere.
      </div>
    </div>
  );
}

function SetupSecurityPage({ book, up }) {
  const [pin, setPin] = useState("");
  const lock = book.prefs.lock || {};
  return (
    <div className="cb-stagger">
      <div style={{ ...glass(20), padding: 18, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>App Lock</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>Require a PIN to open the app</div>
          </div>
          <Toggle on={!!lock.on} onChange={(v) => up((b) => ((b.prefs.lock.on = v), b))} />
        </div>
        {lock.on && (
          <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 14, paddingTop: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>
              {lock.pin ? "Change PIN" : "Set a 4-digit PIN"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{ ...st.input, flex: 1, fontSize: 18, letterSpacing: 6 }}
                inputMode="numeric" maxLength={4} placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
              <button className="cb-press" disabled={pin.length !== 4}
                onClick={() => { up((b) => ((b.prefs.lock.pin = pin), b)); setPin(""); }}
                style={{ padding: "11px 18px", border: "none", borderRadius: 12, background: C.grad, color: "#fff", fontWeight: 700, fontSize: 13.5, fontFamily: F.sans, cursor: "pointer", opacity: pin.length === 4 ? 1 : 0.5 }}>
                Save
              </button>
            </div>
            {lock.pin && <div style={{ fontSize: 11.5, color: C.green, marginTop: 8, fontWeight: 700 }}>✓ PIN is set</div>}
            <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>
              Forgot it? Reinstalling clears the lock but keeps needing your backup to restore data — export one first.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SetupDataPage({ book, up }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [importMsg, setImportMsg] = useState(null); // {ok, text}
  const fileRef = useRef(null);
  const doExport = () => {
    const blob = new Blob([JSON.stringify(book, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cashbook-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    up((b) => ((b.lastBackupAt = new Date().toISOString()), b));
  };
  const doImport = (file) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result);
        if (!Array.isArray(j.entries)) throw new Error("not a cash book backup");
        if (window.confirm(`Replace this book with the backup? It has ${j.entries.length} entries.`)) {
          up(() => normalizeBook(j));
          setImportMsg({ ok: true, text: "Backup restored successfully." });
        }
      } catch (e) {
        setImportMsg({ ok: false, text: "Could not read backup: " + e.message });
      }
    };
    r.readAsText(file);
  };
  return (
    <div className="cb-stagger">
      <div style={{ ...glass(20), padding: 18, marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Export Backup</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Save a copy of everything as a JSON file. Keep it private — it's your real data.</div>
        <PrimaryBtn style={{ width: "100%" }} onClick={doExport}>Export JSON</PrimaryBtn>
        {book.lastBackupAt && (
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>
            Last export: {new Date(book.lastBackupAt).toLocaleString("en-IN")}
          </div>
        )}
      </div>
      <div style={{ ...glass(20), padding: 18, marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Import Backup</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Restore from a previously exported JSON file.</div>
        <GhostBtn style={{ width: "100%" }} onClick={() => fileRef.current && fileRef.current.click()}>Choose File</GhostBtn>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files[0]) doImport(e.target.files[0]); e.target.value = ""; }} />
        {importMsg && (
          <div style={{ color: importMsg.ok ? C.green : C.red, fontSize: 12, marginTop: 10, fontWeight: importMsg.ok ? 700 : 500 }}>
            {importMsg.text}
          </div>
        )}
      </div>
      <div style={{ ...glass(20), padding: 18, marginBottom: 8, border: "1px solid rgba(251,113,133,.25)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.red, marginBottom: 6 }}>Reset All Data</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Erase everything and start fresh. This can't be undone.</div>
        {!confirmReset ? (
          <button className="cb-press" onClick={() => setConfirmReset(true)}
            style={{ width: "100%", padding: "12px 0", border: "1px solid rgba(251,113,133,.4)", borderRadius: 12, background: "rgba(251,113,133,.1)", color: C.red, fontWeight: 700, fontSize: 14, fontFamily: F.sans, cursor: "pointer" }}>
            Reset All Data
          </button>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 10 }}>Are you absolutely sure?</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <GhostBtn style={{ padding: "11px 0" }} onClick={() => setConfirmReset(false)}>Cancel</GhostBtn>
              <PrimaryBtn danger style={{ padding: "11px 0" }} onClick={() => { up(() => defaultBook()); setConfirmReset(false); }}>
                Yes, Reset
              </PrimaryBtn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NotificationsPage({ book }) {
  const notifs = computeNotifs(book);
  return (
    <div className="cb-stagger">
      {notifs.length === 0 && (
        <div style={{ ...glass(20), padding: 24, textAlign: "center", color: C.muted, fontSize: 13.5 }}>
          All clear — nothing needs your attention. ✨
        </div>
      )}
      {notifs.length > 0 && (
        <div style={{ ...glass(18), overflow: "hidden", background: C.glassSoft, border: C.borderSoft, marginBottom: 8 }}>
          {notifs.map((n, i) => (
            <div key={n.id} className="cb-list-in" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderTop: i ? `1px solid ${C.line}` : "none", animationDelay: `${i * 0.05}s` }}>
              <Orb size={38} radius={11} grad={n.grad}><Ic name={n.icon} size={16} /></Orb>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{n.label}</div>
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{n.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: C.faint, padding: "0 2px" }}>
        Computed live from your book — tune what appears in Setup › Notifications.
      </div>
    </div>
  );
}
/* ────────────────────── add / edit entry sheet ────────────────────── */
function EntrySheet({ book, initial, onSave, onSaveSplit, onClose, onDelete }) {
  const editing = !!(initial && initial.id);
  const deletable = editing && initial.head === "Suspense";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [type, setType] = useState(initial?.type || "out");
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : "");
  const [head, setHead] = useState(initial?.head || "");
  const [refund, setRefund] = useState(false);
  const [account, setAccount] = useState(initial?.account || (book.bsAccounts[0] || {}).name || "");
  const [partyId, setPartyId] = useState(initial?.partyId || (book.parties[0] || {}).id || "");
  const [dir, setDir] = useState(initial?.dir || "out");
  const [note, setNote] = useState(initial?.note || "");
  const [date, setDate] = useState(initial?.date || today());
  const [participants, setParticipants] = useState([{ key: uid(), partyId: (book.parties[0] || {}).id || "", newName: "", amount: "" }]);

  const heads = (type === "in" && !refund) ? book.heads.income : book.heads.expense;
  const effHead = head && heads.includes(head) ? head : heads[0] || "";
  const amt = parseAmount(amount);
  const valid =
    !isNaN(amt) && amt > 0 && date &&
    (type === "transfer" ? !!account : type === "party" ? !!partyId : !!effHead);

  const save = (overrides = {}) => {
    const e = { id: editing ? initial.id : uid(), date, amount: amt, type, note: note.trim() };
    if (type === "transfer") { e.account = account; e.dir = dir; }
    else if (type === "party") { e.partyId = partyId; e.dir = dir; }
    else e.head = effHead;
    onSave({ ...e, ...overrides });
  };

  const participantSum = participants.reduce((s, p) => s + (parseAmount(p.amount) || 0), 0);
  const yourShare = amt - participantSum;
  const splitValid =
    !isNaN(amt) && amt > 0 && date && !!effHead && yourShare >= 0 &&
    participants.length > 0 &&
    participants.every((p) => (p.partyId || p.newName.trim()) && parseAmount(p.amount) > 0);

  const addParticipant = () => setParticipants((ps) => [...ps, { key: uid(), partyId: "", newName: "", amount: "" }]);
  const removeParticipant = (key) => setParticipants((ps) => ps.filter((p) => p.key !== key));
  const updateParticipant = (key, patch) => setParticipants((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const splitEqually = () => {
    if (!participants.length || isNaN(amt) || amt <= 0) return;
    const each = Math.floor(amt / (participants.length + 1));
    setParticipants((ps) => ps.map((p) => ({ ...p, amount: String(each) })));
  };

  const saveSplit = () => {
    if (!splitValid) return;
    onSaveSplit({
      date, note: note.trim(), head: effHead, yourShare,
      participants: participants.map((p) => ({
        partyId: p.partyId || null,
        newName: p.partyId ? null : p.newName.trim(),
        amount: parseAmount(p.amount),
      })),
    });
  };

  const DirSeg = ({ options }) => (
    <Seg value={dir} onChange={setDir} options={options} />
  );

  return (
    <Sheet title={editing ? "Re-code entry" : "New entry"} onClose={onClose}>
      {confirmDelete && (
        <div style={{ background: "rgba(251,113,133,.1)", border: "1px solid rgba(251,113,133,.3)", borderRadius: 16, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.red }}>Delete this entry?</div>
          <div style={{ fontSize: 12, color: C.soft, marginTop: 4 }}>
            It's still unexplained (Suspense), so this is the one case entries
            can be removed. Explained entries can never be deleted.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <GhostBtn style={{ padding: "10px 0" }} onClick={() => setConfirmDelete(false)}>Cancel</GhostBtn>
            <PrimaryBtn danger style={{ padding: "10px 0" }} onClick={() => onDelete(initial.id)}>Delete</PrimaryBtn>
          </div>
        </div>
      )}
      <label style={st.label}>{type === "split" ? "Total amount" : "Amount"}</label>
      <AmountField book={book} value={amount} onChange={setAmount} />
      <label style={st.label}>Kind</label>
      <Seg
        value={type}
        onChange={(v) => { setType(v); if (v !== "in") setRefund(false); }}
        options={[
          { v: "out", label: "Out" },
          { v: "in", label: "In" },
          { v: "transfer", label: "Transfer" },
          { v: "party", label: "Party" },
          ...(editing ? [] : [{ v: "split", label: "Split" }]),
        ]}
      />
      {type === "in" && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5, color: C.soft, cursor: "pointer" }}>
          <Toggle on={refund} onChange={setRefund} />
          This is a refund against something you already spent
        </label>
      )}
      {(type === "in" || type === "out" || type === "split") && (
        <>
          <label style={st.label}>{type === "split" ? "Your share's category" : refund ? "Refund against" : "Head"}</label>
          <Chips
            options={heads}
            value={effHead}
            onChange={setHead}
            render={(h) => (book.headClass[h] ? `${h} → ${book.headClass[h]}` : h)}
          />
        </>
      )}
      {type === "split" && (
        <>
          <label style={st.label}>Split with</label>
          {participants.map((p, i) => (
            <div key={p.key} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              {book.parties.length > 0 && (
                <select
                  style={{ ...st.input, flex: 1, padding: "9px 10px", fontSize: 13 }}
                  value={p.partyId}
                  onChange={(e) => updateParticipant(p.key, { partyId: e.target.value })}
                >
                  <option value="">+ New person…</option>
                  {book.parties.map((party) => (
                    <option key={party.id} value={party.id}>{party.name}</option>
                  ))}
                </select>
              )}
              {!p.partyId && (
                <input
                  style={{ ...st.input, flex: 1, padding: "9px 10px", fontSize: 13 }}
                  placeholder="Name"
                  value={p.newName}
                  onChange={(e) => updateParticipant(p.key, { newName: e.target.value })}
                />
              )}
              <input
                style={{ ...st.input, width: 90, textAlign: "right", padding: "9px 10px", fontSize: 13, fontWeight: 700 }}
                inputMode="decimal"
                placeholder="Amount"
                value={p.amount}
                onChange={(e) => updateParticipant(p.key, { amount: e.target.value })}
              />
              {participants.length > 1 && (
                <button className="cb-press" onClick={() => removeParticipant(p.key)}
                  style={{ border: "none", background: "none", color: C.faint, fontSize: 18, cursor: "pointer", padding: "0 2px" }}>
                  ×
                </button>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <GhostBtn style={{ padding: "8px 12px", fontSize: 12.5 }} onClick={addParticipant}>+ Add person</GhostBtn>
            <GhostBtn style={{ padding: "8px 12px", fontSize: 12.5 }} onClick={splitEqually}>Split equally</GhostBtn>
          </div>
          <div style={{
            fontSize: 13, fontWeight: 700, marginTop: 12, padding: "10px 12px", borderRadius: 12,
            background: yourShare < 0 ? "rgba(251,113,133,.12)" : "rgba(255,255,255,.05)",
            color: yourShare < 0 ? C.red : C.soft,
          }}>
            Your share: {money(book, Math.max(0, isNaN(yourShare) ? 0 : yourShare))}
            {yourShare < 0 && " — participants' shares exceed the total"}
          </div>
        </>
      )}
      {type === "transfer" && (
        <>
          <label style={st.label}>Account</label>
          <select style={st.input} value={account} onChange={(e) => setAccount(e.target.value)}>
            {book.bsAccounts.map((a) => (
              <option key={a.name} value={a.name}>{a.name} ({a.kind})</option>
            ))}
          </select>
          <label style={st.label}>Direction</label>
          <DirSeg options={[{ v: "out", label: "Out of bank" }, { v: "in", label: "Into bank" }]} />
        </>
      )}
      {type === "party" && (
        <>
          <label style={st.label}>Party</label>
          <select style={st.input} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            {book.parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <label style={st.label}>Direction</label>
          <DirSeg options={[{ v: "out", label: "Paid them" }, { v: "in", label: "They paid me" }]} />
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
            Party entries update Owed automatically and never touch the P&L.
          </div>
        </>
      )}
      <label style={st.label}>Note</label>
      <input style={st.input} value={note} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
      <label style={st.label}>Date</label>
      <input style={st.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        {type === "split" ? (
          <PrimaryBtn disabled={!splitValid} style={{ flex: 1, opacity: splitValid ? 1 : 0.5 }} onClick={saveSplit}>
            Add split
          </PrimaryBtn>
        ) : (
          <PrimaryBtn disabled={!valid} style={{ flex: 1, opacity: valid ? 1 : 0.5 }} onClick={() => valid && save()}>
            {editing ? "Save changes" : "Add entry"}
          </PrimaryBtn>
        )}
        {editing && (
          <GhostBtn
            disabled={!valid}
            style={{ padding: "13px 12px", opacity: valid ? 1 : 0.5 }}
            onClick={() => valid && save({ id: uid(), date: today() })}
            title="Add a fresh copy of this entry dated today"
          >
            ↻ Repeat
          </GhostBtn>
        )}
        {editing && !deletable && (initial.type === "in" || initial.type === "out") && (
          <GhostBtn
            style={{ padding: "13px 12px" }}
            onClick={() => save({ head: "Suspense", type: initial.type, account: undefined, partyId: undefined, dir: undefined })}
            title="Entries are never deleted — park it in Suspense and re-code later"
          >
            → Suspense
          </GhostBtn>
        )}
        {deletable && (
          <GhostBtn
            style={{ padding: "13px 12px", color: C.red }}
            onClick={() => setConfirmDelete(true)}
            title="Unexplained entries can be deleted"
          >
            Delete
          </GhostBtn>
        )}
      </div>
      {editing && (
        <div style={{ fontSize: 12, color: C.faint, marginTop: 10 }}>
          {deletable
            ? "This entry is still unexplained, so it can be deleted. Once re-coded, entries can never be deleted."
            : "Entries are never deleted. Re-code them, or park unexplained ones in Suspense."}
        </div>
      )}
    </Sheet>
  );
}

function MemoSheet({ book, party, presetKind, onSave, onClose }) {
  const [kind, setKind] = useState(presetKind || "debtor");
  const [partyId, setPartyId] = useState(party ? party.id : (book.parties[0] || {}).id || "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());
  const amt = parseAmount(amount);
  const valid = !isNaN(amt) && amt > 0 && date && partyId;
  return (
    <Sheet title={party ? `Memo — ${party.name}` : "Add memo"} onClose={onClose}>
      <div style={{ fontSize: 13, color: C.muted }}>
        For amounts that never moved through the bank (pending bill, informal IOU).
      </div>
      {!party && (
        <>
          <label style={st.label}>Party</label>
          <select style={st.input} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            {book.parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </>
      )}
      <label style={st.label}>Which way</label>
      <Seg value={kind} onChange={setKind} options={[
        { v: "debtor", label: "They owe me" },
        { v: "creditor", label: "I owe them" },
      ]} />
      <label style={st.label}>Amount</label>
      <AmountField book={book} value={amount} onChange={setAmount} />
      <label style={st.label}>Note</label>
      <input style={st.input} value={note} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
      <label style={st.label}>Date</label>
      <input style={st.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <PrimaryBtn
        disabled={!valid}
        style={{ width: "100%", marginTop: 18, opacity: valid ? 1 : 0.5 }}
        onClick={() =>
          valid &&
          onSave({ id: uid(), partyId, date, note: note.trim(), amount: kind === "debtor" ? amt : -amt })
        }
      >
        Add memo
      </PrimaryBtn>
    </Sheet>
  );
}

/* ─────────────────── statement import sheet (violet) ─────────────────── */
function ImportSheet({ book, onDone, onClose }) {
  const [stage, setStage] = useState("pick"); // pick | busy | review | done
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);
  const [progress, setProgress] = useState("");
  const [learned, setLearned] = useState({});
  const fileRef = useRef(null);

  const codeRows = (raw) =>
    raw.map((r) => ({ ...r, head: r.head && r.head !== "Suspense" ? r.head : suggestHead(book, r.note), include: true }));

  const runLocal = async (file) => {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) {
      const pages = await extractPdfPages(file);
      const tableRows = parsePdfTable(pages);
      if (tableRows.length) return tableRows;
      const text = pages.map((items) => pdfGroupLines(items).map((l) => l.text).join("\n")).join("\n");
      return parseStatementText(text);
    }
    let text;
    if (name.endsWith(".csv")) text = await file.text();
    else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const wb = XLSX.read(await file.arrayBuffer());
      text = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n");
    } else return null;
    return parseStatementText(text);
  };

  const runOcr = async (file) => {
    setProgress("Preparing the reader — first time needs a one-off download…");
    const worker = await getOcrWorker((pct) => setProgress(`Recognising… ${pct}%`));
    try {
      let text = "";
      if (file.type.startsWith("image/")) {
        text = await ocrRecognize(worker, file);
      } else {
        const canvases = await pdfPagesToCanvases(file, (p, n) => setProgress(`Rendering page ${p}/${n}…`));
        for (let i = 0; i < canvases.length; i++) {
          setProgress(`Recognising page ${i + 1}/${canvases.length}…`);
          text += "\n" + (await ocrRecognize(worker, canvases[i]));
        }
      }
      return parseStatementText(text);
    } finally {
      await worker.terminate();
    }
  };

  const run = async (file) => {
    setErr("");
    setStage("busy");
    setProgress("Reading…");
    try {
      let parsed;
      if (file.type.startsWith("image/")) {
        parsed = await runOcr(file);
      } else {
        parsed = await runLocal(file);
        if (parsed && !parsed.length && file.name.toLowerCase().endsWith(".pdf")) {
          parsed = await runOcr(file);
        }
      }
      if (!parsed || !parsed.length) {
        throw new Error("Couldn't find transactions in that file. A cleaner export (CSV/Excel) usually parses best.");
      }
      setRows(codeRows(parsed));
      setStage("review");
    } catch (e) {
      setErr(e.message);
      setStage("pick");
    }
  };

  const setRow = (i, patch) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    if (patch.head) {
      const kw = keywordOf(rows[i] && rows[i].note);
      if (kw) setLearned((l) => ({ ...l, [kw]: patch.head }));
    }
  };
  const picked = rows.filter((r) => r.include);

  return (
    <Sheet title="Import statement" onClose={onClose}>
      {stage === "pick" && (
        <>
          <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 14px" }}>
            Upload a bank statement — PDF, Excel, CSV, or a photo/scan. Every
            format is read entirely on this phone, and you review each
            transaction before it enters the book.
          </div>
          {err && <div style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>{err}</div>}
          <PrimaryBtn style={{ width: "100%" }} onClick={() => fileRef.current && fileRef.current.click()}>
            Choose file…
          </PrimaryBtn>
          <input
            ref={fileRef} type="file" style={{ display: "none" }}
            accept=".pdf,.csv,.xlsx,.xls,image/*"
            onChange={(e) => {
              if (e.target.files[0]) run(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </>
      )}
      {stage === "busy" && (
        <div style={{ textAlign: "center", padding: "36px 10px", color: C.muted }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.accentText }}>Reading statement…</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>{progress || "Extracting transactions"}</div>
        </div>
      )}
      {stage === "review" && (
        <>
          <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 10px" }}>
            {rows.length} found (read on-device) — untick anything you don't want,
            fix categories, then add. Fixes are remembered for next time.
          </div>
          {rows.map((r, i) => (
            <div key={i} className="cb-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderTop: "1px solid rgba(255,255,255,.1)", opacity: r.include ? 1 : 0.45 }}>
              <input type="checkbox" checked={r.include}
                onChange={(e) => setRow(i, { include: e.target.checked })}
                style={{ width: 18, height: 18, accentColor: C.accent }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.note || "(no description)"}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{fmtDate(book, r.date)}</span>
                  <select
                    style={{ ...st.input, width: "auto", padding: "2px 6px", fontSize: 12 }}
                    value={(r.type === "in" ? book.heads.income : book.heads.expense).includes(r.head) ? r.head : "Suspense"}
                    onChange={(e) => setRow(i, { head: e.target.value })}
                  >
                    {(r.type === "in" ? book.heads.income : book.heads.expense).map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, color: r.type === "in" ? C.green : C.red, whiteSpace: "nowrap" }}>
                {r.type === "in" ? "+" : "−"}{money(book, r.amount)}
              </div>
            </div>
          ))}
          <PrimaryBtn
            disabled={!picked.length}
            style={{ width: "100%", marginTop: 16, opacity: picked.length ? 1 : 0.5 }}
            onClick={() => { onDone(picked, learned); setStage("done"); }}
          >
            Add {picked.length} {picked.length === 1 ? "entry" : "entries"}
          </PrimaryBtn>
        </>
      )}
      {stage === "done" && (
        <div style={{ textAlign: "center", padding: "30px 10px 20px" }}>
          <div className="cb-check-pop" style={{
            width: 74, height: 74, borderRadius: 999, background: C.greenGrad,
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto",
            boxShadow: "0 14px 30px -8px rgba(4,120,87,.6)",
          }}>
            <Ic name="check" size={34} sw={3} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, marginTop: 14 }}>
            {picked.length} {picked.length === 1 ? "entry" : "entries"} added
          </div>
          <GhostBtn style={{ width: "100%", marginTop: 16 }} onClick={onClose}>Done</GhostBtn>
        </div>
      )}
    </Sheet>
  );
}

/* ────────────────────────── splash & lock ────────────────────────── */
function Splash({ leaving }) {
  return (
    <div
      className={leaving ? "cb-splash-out" : ""}
      style={{
        position: "fixed", inset: 0, zIndex: 50, background: C.bg,
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 14,
      }}
    >
      <div
        className="cb-splash-glyph"
        style={{
          width: 96, height: 96, borderRadius: 26, background: C.grad,
          border: "1px solid rgba(255,255,255,.2)",
          boxShadow: "0 24px 50px -16px rgba(109,40,217,.7)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 48, fontWeight: 800, color: "#fff", fontFamily: F.sans,
        }}
      >
        ₹
      </div>
      <div className="cb-splash-name" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink }}>Cash Book</div>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginTop: 3 }}>Your Financial Command Center</div>
      </div>
    </div>
  );
}

function LockScreen({ pin, onUnlock }) {
  const [entered, setEntered] = useState("");
  const [wrong, setWrong] = useState(false);
  const tryPin = (v) => {
    setEntered(v);
    setWrong(false);
    if (v.length === 4) {
      if (v === pin) onUnlock();
      else { setWrong(true); setEntered(""); }
    }
  };
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 60, background: C.bg, display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: 24,
    }}>
      <Orb size={64} radius={18} grad={C.grad}><Ic name="shield" size={26} /></Orb>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.ink }}>Enter your PIN</div>
      <input
        autoFocus
        style={{ ...st.input, maxWidth: 200, textAlign: "center", fontSize: 26, letterSpacing: 14, fontWeight: 800 }}
        inputMode="numeric" maxLength={4} type="password"
        value={entered}
        onChange={(e) => tryPin(e.target.value.replace(/\D/g, ""))}
      />
      {wrong && <div style={{ fontSize: 13, color: C.red, fontWeight: 700 }}>Wrong PIN — try again.</div>}
    </div>
  );
}

/* ────────────────────────── app shell ────────────────────────── */
const TABS = [
  { id: "dash", label: "Dashboard", icon: "home" },
  { id: "owed", label: "Owed", icon: "people" },
  { id: "tx", label: "Transactions", icon: "swap" },
  { id: "reports", label: "Reports", icon: "pie" },
  { id: "setup", label: "Setup", icon: "gear" },
];

const PAGE_TITLES = {
  networth: "Net Worth",
  assets: "Total Assets",
  liabilities: "Total Liabilities",
  party: "Party",
  recvDetail: "Receivables",
  payDetail: "Payables",
  pl: "Profit & Loss",
  bs: "Balance Sheet",
  catspend: "Category Spending",
  cashflow: "Cash Flow",
  budget: "Budget",
  bankbalances: "Bank Balances",
  account: "Account",
  notifications: "Notifications",
  setupAccounts: "Accounts",
  setupCategories: "Categories",
  setupParties: "Parties",
  setupPrefs: "Currency & Date",
  setupNotifs: "Notifications",
  setupSecurity: "Security",
  setupData: "Backup & Data",
};

export default function CashBook() {
  const [book, setBook] = useState(null);
  const [tab, setTab] = useState("dash");
  const [page, setPage] = useState(null); // {name, arg} | null
  const [txFilter, setTxFilter] = useState(null);
  const [entrySheet, setEntrySheet] = useState(null);
  const [memoSheet, setMemoSheet] = useState(null); // {party?, presetKind?}
  const [importOpen, setImportOpen] = useState(false);
  const [splash, setSplash] = useState("on");
  const [locked, setLocked] = useState(false);
  const skipSave = useRef(true);

  useEffect(() => {
    loadBook().then((b) => {
      const nb = b ? normalizeBook(b) : defaultBook();
      setBook(nb);
      if (nb.prefs.lock && nb.prefs.lock.on && nb.prefs.lock.pin) setLocked(true);
    });
    const min = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 800;
    const t1 = setTimeout(() => setSplash("leaving"), min);
    const t2 = setTimeout(() => setSplash("done"), min + 400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  useEffect(() => {
    if (!book) return;
    if (skipSave.current) { skipSave.current = false; return; }
    saveBook(book);
  }, [book]);

  const up = (fn) => setBook((b) => fn(clone(b)));
  const go = (name, arg) => setPage(name ? { name, arg } : null);
  const switchTab = (t2, filter) => {
    setTab(t2);
    setPage(null);
    setTxFilter(filter || null);
    window.scrollTo(0, 0);
  };

  // Android share-target: a bank SMS shared to the app arrives as ?text=…
  useEffect(() => {
    if (!book) return;
    const params = new URLSearchParams(window.location.search);
    const shared = [params.get("title"), params.get("text"), params.get("url")]
      .filter(Boolean).join(" ");
    if (!shared) return;
    window.history.replaceState(null, "", window.location.pathname);
    const parsed = parseBankSms(shared);
    if (parsed) {
      setEntrySheet({
        initial: {
          type: parsed.type, amount: parsed.amount, date: parsed.date,
          note: parsed.note, head: suggestHead(book, parsed.note),
        },
      });
    }
  }, [!!book]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!book) return <Splash leaving={false} />;
  if (locked) return <LockScreen pin={book.prefs.lock.pin} onUnlock={() => setLocked(false)} />;

  const saveEntry = (e) => {
    up((b) => {
      const i = b.entries.findIndex((x) => x.id === e.id);
      const cleaned = JSON.parse(JSON.stringify(e));
      if (i >= 0) b.entries[i] = cleaned;
      else b.entries.push(cleaned);
      return b;
    });
    setEntrySheet(null);
  };

  // Entries are never deleted once explained — this only ever removes
  // still-Suspense rows (bad imports, duplicates), enforced here as well as
  // in the UI that offers the button.
  const deleteEntries = (ids) => {
    const idSet = new Set(ids);
    up((b) => {
      b.entries = b.entries.filter((x) => !(idSet.has(x.id) && x.head === "Suspense"));
      return b;
    });
  };

  // One shared expense: your share posts as a normal expense entry, each
  // participant's share posts as a party "paid them" entry (money you
  // fronted for them) — so it hits Owed as a receivable and never touches
  // your P&L. New-name participants become real parties first.
  const saveSplitExpense = ({ date, note, head, yourShare, participants }) => {
    up((b) => {
      if (yourShare > 0) {
        b.entries.push({ id: uid(), date, amount: yourShare, type: "out", head, note });
      }
      for (const p of participants) {
        let partyId = p.partyId;
        if (!partyId && p.newName) {
          const party = { id: uid(), name: p.newName };
          b.parties.push(party);
          partyId = party.id;
        }
        if (!partyId) continue;
        b.entries.push({
          id: uid(), date, amount: p.amount, type: "party", partyId, dir: "out",
          note: note ? `${note} — split` : "Split expense",
        });
      }
      return b;
    });
    setEntrySheet(null);
  };

  const notifCount = computeNotifs(book).length;
  const showBack = !!page;
  const title = page ? (page.name === "party" ? partyName(book, page.arg) : PAGE_TITLES[page.name] || "Cash Book") : null;
  const backTarget = page && { assets: "networth", liabilities: "networth" }[page.name];

  const openRecordPayment = (p, dirDefault) =>
    setEntrySheet({
      initial: {
        type: "party",
        partyId: p ? p.id : (book.parties[0] || {}).id,
        dir: p ? (p.balance > 0 ? "in" : "out") : dirDefault || "in",
        date: today(),
        note: "Payment",
      },
    });
  const openSettle = (p) =>
    setEntrySheet({
      initial: {
        type: "party", partyId: p.id, amount: Math.abs(p.balance),
        dir: p.balance > 0 ? "in" : "out", date: today(), note: "Settlement",
      },
    });

  const pageEl = page && (
    page.name === "networth" ? <NetWorthPage book={book} go={go} />
    : page.name === "assets" ? <AllocationPage book={book} kind="assets" />
    : page.name === "liabilities" ? <AllocationPage book={book} kind="liabilities" />
    : page.name === "party" ? (
      <PartyProfilePage
        book={book} partyId={page.arg} up={up}
        onRecordPayment={openRecordPayment}
        onSettle={openSettle}
        onAddMemo={(presetKind, partyId) =>
          setMemoSheet({ party: book.parties.find((x) => x.id === partyId) || null, presetKind })}
      />
    )
    : page.name === "recvDetail" ? <OwedDetailPage book={book} kind="recv" go={go} />
    : page.name === "payDetail" ? <OwedDetailPage book={book} kind="pay" go={go} />
    : page.name === "pl" ? <PLPage book={book} />
    : page.name === "bs" ? <BSPage book={book} />
    : page.name === "catspend" ? <CatSpendPage book={book} />
    : page.name === "cashflow" ? <CashFlowPage book={book} />
    : page.name === "budget" ? <BudgetPage book={book} up={up} />
    : page.name === "bankbalances" ? <BankBalancesPage book={book} go={go} />
    : page.name === "account" ? <AccountDetailPage book={book} accId={page.arg} onEdit={(e) => setEntrySheet({ initial: e })} />
    : page.name === "notifications" ? <NotificationsPage book={book} />
    : page.name === "setupAccounts" ? <SetupAccountsPage book={book} up={up} />
    : page.name === "setupCategories" ? <SetupCategoriesPage book={book} up={up} />
    : page.name === "setupParties" ? <SetupPartiesPage book={book} up={up} />
    : page.name === "setupPrefs" ? <SetupPrefsPage book={book} up={up} />
    : page.name === "setupNotifs" ? <SetupNotifsPage book={book} up={up} />
    : page.name === "setupSecurity" ? <SetupSecurityPage book={book} up={up} />
    : page.name === "setupData" ? <SetupDataPage book={book} up={up} />
    : null
  );

  return (
    <div style={{
      fontFamily: F.sans, color: C.ink, background: C.bg, minHeight: "100vh",
      maxWidth: 480, margin: "0 auto",
      paddingBottom: "calc(112px + env(safe-area-inset-bottom))",
    }}>
      <style>{ANIM_CSS}</style>

      <div className="cb-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px 12px", maxWidth: 480, margin: "0 auto" }}>
          {showBack ? (
            <>
              <button
                className="cb-press"
                onClick={() => go(backTarget || null)}
                style={{ background: "none", border: "none", color: C.accentText, fontSize: 15, fontWeight: 700, padding: 0, marginRight: 2, cursor: "pointer", fontFamily: F.sans }}
              >
                ← Back
              </button>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.ink, flex: 1 }}>{title}</div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 14, background: C.grad, display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800,
                  color: "#fff", boxShadow: "0 6px 14px -4px rgba(109,40,217,.6)", flexShrink: 0,
                }}>
                  ₹
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: C.ink }}>Cash Book</div>
                  <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Your Financial Command Center
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <RoundBtn aria-label="Search transactions" onClick={() => switchTab("tx")}>
                  <Ic name="search" size={15} stroke={C.soft} />
                </RoundBtn>
                <RoundBtn aria-label="Notifications" style={{ position: "relative" }} onClick={() => go("notifications")}>
                  <Ic name="bell" size={15} stroke={C.soft} />
                  {notifCount > 0 && (
                    <span style={{
                      position: "absolute", top: -3, right: -3, minWidth: 15, height: 15, padding: "0 3px",
                      borderRadius: 999, background: C.grad, border: "1.5px solid #0c0716",
                      fontSize: 9, fontWeight: 800, color: "#fff", display: "flex",
                      alignItems: "center", justifyContent: "center",
                    }}>
                      {notifCount}
                    </span>
                  )}
                </RoundBtn>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ padding: "18px 16px 0" }}>
        <div className={page ? "cb-subpage" : "cb-view"} key={tab + (page ? page.name + (page.arg || "") : "")}>
          {page ? pageEl : (
            tab === "dash" ? (
              <DashHome
                book={book} go={go}
                onImport={() => setImportOpen(true)}
                onAdd={() => setEntrySheet({ initial: null })}
                setTab={switchTab}
              />
            )
            : tab === "owed" ? (
              <OwedView
                book={book} go={go}
                onAddMemo={(presetKind) => setMemoSheet({ party: null, presetKind })}
                onRecordPayment={openRecordPayment}
              />
            )
            : tab === "tx" ? (
              <TxView book={book} up={up} onEdit={(e) => setEntrySheet({ initial: e })} initialFilter={txFilter} />
            )
            : tab === "reports" ? <ReportsHub book={book} go={go} />
            : <SetupHub book={book} go={go} />
          )}
        </div>
      </div>

      {(tab === "dash" || tab === "tx") && !page && (
        <button
          onClick={() => setEntrySheet({ initial: null })}
          aria-label="Add entry"
          className="cb-fab cb-noprint"
          style={{
            position: "fixed", right: 18, bottom: "calc(92px + env(safe-area-inset-bottom))",
            width: 58, height: 58, borderRadius: 29, border: "1px solid rgba(255,255,255,.3)",
            background: C.grad, color: "#fff", fontSize: 28, lineHeight: "54px", fontWeight: 700,
            boxShadow: "0 14px 30px -8px rgba(109,40,217,.7)", cursor: "pointer", zIndex: 20,
          }}
        >
          +
        </button>
      )}

      <div className="cb-noprint" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 25 }}>
        <div style={{
          maxWidth: 480, margin: "0 auto",
          background: C.navBg, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          borderTop: "1px solid rgba(255,255,255,.1)", borderRadius: "20px 20px 0 0",
          padding: "10px 6px calc(10px + env(safe-area-inset-bottom))",
          display: "flex", boxShadow: "0 -12px 30px -14px rgba(0,0,0,.5)",
        }}>
          {TABS.map((tb) => {
            const active = tab === tb.id && !page;
            return (
              <button
                key={tb.id}
                className="cb-tab"
                onClick={() => switchTab(tb.id)}
                style={{ flex: 1, border: "none", background: "none", padding: "6px 0", cursor: "pointer", fontFamily: F.sans }}
              >
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <Ic name={tb.icon} size={19} stroke={active ? C.accentText : C.faint} sw={2} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: active ? C.accentText : C.faint, marginTop: 5 }}>
                  {tb.label}
                </div>
                <span style={{ display: "block", margin: "4px auto 0", width: 14, height: 3, borderRadius: 999, background: C.accentText, opacity: active ? 1 : 0 }} />
              </button>
            );
          })}
        </div>
      </div>

      {entrySheet && (
        <EntrySheet
          book={book} initial={entrySheet.initial} onSave={saveEntry} onClose={() => setEntrySheet(null)}
          onDelete={(id) => { deleteEntries([id]); setEntrySheet(null); }}
          onSaveSplit={saveSplitExpense}
        />
      )}
      {memoSheet && (
        <MemoSheet
          book={book} party={memoSheet.party} presetKind={memoSheet.presetKind}
          onClose={() => setMemoSheet(null)}
          onSave={(m) => {
            up((b) => (b.owedMemos.push(m), b));
            setMemoSheet(null);
          }}
        />
      )}
      {importOpen && (
        <ImportSheet
          book={book}
          onClose={() => setImportOpen(false)}
          onDone={(picked, learned) => {
            up((b) => {
              for (const r of picked) {
                const heads = r.type === "in" ? b.heads.income : b.heads.expense;
                b.entries.push({
                  id: uid(), date: r.date, amount: r.amount, type: r.type,
                  head: heads.includes(r.head) ? r.head : "Suspense",
                  note: r.note,
                });
              }
              for (const [match, head] of Object.entries(learned || {})) {
                const ex = b.codingRules.find((x) => x.match === match);
                if (ex) ex.head = head;
                else b.codingRules.push({ match, head });
              }
              return b;
            });
          }}
        />
      )}

      {splash !== "done" && <Splash leaving={splash === "leaving"} />}
    </div>
  );
}
