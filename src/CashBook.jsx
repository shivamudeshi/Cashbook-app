import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { loadBook, saveBook, loadApiKey, saveApiKey } from "./storage.js";
import { askClaude, askClaudeContent } from "./api.js";

/* ────────────────────────── palette & type ──────────────────────────
   Emerald fintech, dark: near-black charcoal surfaces, emerald for the
   balance and money-in, warm coral for money-out. `olive` keeps its name
   as the primary-action slot; `paper` is the app background; `creamText`
   is the on-primary text color. */
export const C = {
  olive: "#34d399", // primary action — emerald
  oliveDeep: "#a7f3d0", // bright tint for headings on dark
  oliveSoft: "#1f4e3b",
  paper: "#0e1210",
  card: "#161c18",
  line: "#242d27",
  ink: "#e9efe9",
  faint: "#8b9c92",
  credit: "#34d399",
  debit: "#ff7a6b",
  creamText: "#05130c", // text on emerald
  heroFrom: "#143528",
  heroTo: "#0f231a",
  input: "#131916",
  glow: "0 8px 30px rgba(52,211,153,.18)",
};
// Display face (amounts, balances, headings) vs body face. The families are
// self-hosted woff2 in public/fonts and precached by the service worker.
export const F = {
  serif: '"Space Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  sans: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

/* Keyframes and state-driven styles (:active, :focus) can't be inline —
   this sheet is injected once at the app root. */
const ANIM_CSS = `
@keyframes cbFadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes cbSlideUp { from { transform: translateY(48px); opacity: .4; } to { transform: none; opacity: 1; } }
@keyframes cbFadeIn { from { opacity: 0; } to { opacity: 1; } }
.cb-view { animation: cbFadeUp .28s ease both; }
.cb-row { animation: cbFadeIn .3s ease both; }
.cb-sheet-overlay { animation: cbFadeIn .2s ease both; }
.cb-sheet { animation: cbSlideUp .3s cubic-bezier(.2,.9,.3,1) both; }
.cb-press { transition: transform .12s ease, filter .15s ease, background .2s ease, color .2s ease; }
.cb-press:active { transform: scale(.96); }
.cb-fab { transition: transform .15s ease, box-shadow .2s ease; }
.cb-fab:active { transform: scale(.9); }
input, select { transition: border-color .18s ease, box-shadow .18s ease; }
input:focus, select:focus { outline: none; border-color: #34d399 !important; box-shadow: 0 0 0 3px rgba(52,211,153,.15); }
.cb-tab { transition: color .2s ease, transform .15s ease; }
.cb-tab:active { transform: translateY(1px); }
@media (prefers-reduced-motion: reduce) {
  .cb-view, .cb-row, .cb-sheet, .cb-sheet-overlay { animation: none; }
  .cb-press, .cb-fab, .cb-tab, input, select { transition: none; }
}
`;

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

export function computePL(db, from, to) {
  const income = {}, expense = {};
  for (const e of db.entries) {
    if (e.type !== "in" && e.type !== "out") continue;
    if (e.date < from || e.date > to) continue;
    if (db.headClass && db.headClass[e.head]) continue; // posts to a BS account
    const bag = e.type === "in" ? income : expense;
    bag[e.head] = (bag[e.head] || 0) + e.amount;
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
      if (e.type === "party" && e.partyId === p.id && e.date <= asOf) {
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
  };
}

function normalizeBook(j) {
  const d = defaultBook();
  const b = { ...d, ...j };
  b.heads = { ...d.heads, ...(j.heads || {}) };
  b.opening = { ...d.opening, ...(j.opening || {}) };
  if (!b.opening.accounts) b.opening.accounts = {};
  for (const k of ["entries", "bsAccounts", "parties", "owedMemos"]) {
    if (!Array.isArray(b[k])) b[k] = d[k];
  }
  if (!b.headClass) b.headClass = {};
  return b;
}

// Exposed so npm test can assert the engine on the REAL production bundle.
if (typeof window !== "undefined") {
  window.__cashbookEngine = {
    inr, parseAmount, fyOf, quarterOf, fyRange, monthRange,
    computePL, balancesAsOf, owedAsOf, computeBS, defaultBook,
  };
}

/* ────────────────────────── shared UI bits ────────────────────────── */
const clone = (o) => JSON.parse(JSON.stringify(o));

const st = {
  input: {
    width: "100%", boxSizing: "border-box", padding: "10px 12px",
    borderRadius: 10, border: `1px solid ${C.line}`, background: C.input,
    fontSize: 16, fontFamily: F.sans, color: C.ink, colorScheme: "dark",
  },
  label: {
    display: "block", fontSize: 12, color: C.faint, margin: "12px 0 4px",
    textTransform: "uppercase", letterSpacing: "0.06em",
  },
  card: {
    background: C.card, border: `1px solid ${C.line}`, borderRadius: 16,
    padding: 14, margin: "10px 12px",
  },
};

function Btn({ primary, danger, style, ...props }) {
  return (
    <button
      className="cb-press"
      style={{
        padding: "10px 16px", borderRadius: 10, fontSize: 15, fontWeight: 600,
        fontFamily: F.sans, cursor: "pointer",
        border: primary || danger ? "none" : `1px solid ${C.line}`,
        background: danger ? C.debit : primary ? C.olive : "transparent",
        color: primary || danger ? C.creamText : C.ink,
        ...style,
      }}
      {...props}
    />
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div style={{
      display: "flex", border: `1px solid ${C.line}`, borderRadius: 12,
      overflow: "hidden", background: C.input,
    }}>
      {options.map((o) => (
        <button
          key={o.v}
          className="cb-press"
          onClick={() => onChange(o.v)}
          style={{
            flex: 1, padding: "9px 4px", fontSize: 14, fontFamily: F.sans,
            border: "none", cursor: "pointer", fontWeight: 600,
            background: value === o.v ? C.olive : "transparent",
            color: value === o.v ? C.creamText : C.faint,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      className="cb-sheet-overlay"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
        display: "flex", alignItems: "flex-end", zIndex: 30,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cb-sheet"
        style={{
          background: C.paper, borderRadius: "16px 16px 0 0", width: "100%",
          maxWidth: 480, margin: "0 auto", maxHeight: "88vh", overflowY: "auto",
          padding: "14px 16px calc(20px + env(safe-area-inset-bottom))",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: F.serif, fontSize: 19, fontWeight: 700, flex: 1 }}>
            {title}
          </div>
          <Btn onClick={onClose} style={{ padding: "6px 12px" }}>Close</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

function AmountField({ value, onChange, autoFocus }) {
  const parsed = parseAmount(value);
  return (
    <div>
      <input
        style={{ ...st.input, fontSize: 22, fontFamily: F.serif }}
        inputMode="decimal"
        placeholder="Amount — 500, 2k, 1.2L"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <div style={{ fontSize: 13, color: isNaN(parsed) ? C.debit : C.faint, marginTop: 4 }}>
          {isNaN(parsed) ? "Can't read that amount" : `= ${inr(parsed)}`}
        </div>
      )}
    </div>
  );
}

function prettyDate(d) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
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

/* ────────────────────────── Book (ledger) ────────────────────────── */
function BookView({ book, onEdit, onImport }) {
  const t = today();
  const { bank } = balancesAsOf(book, t);
  const monthStart = t.slice(0, 8) + "01";
  let mIn = 0, mOut = 0;
  for (const e of book.entries) {
    if (e.date < monthStart || e.date > t) continue;
    entrySign(e) > 0 ? (mIn += e.amount) : (mOut += e.amount);
  }
  const sorted = [...book.entries].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1)
  );
  const groups = [];
  for (const e of sorted) {
    const g = groups[groups.length - 1];
    if (g && g.date === e.date) g.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  return (
    <div>
      <div style={{
        ...st.card,
        background: `linear-gradient(135deg, ${C.heroFrom}, ${C.heroTo})`,
        border: `1px solid ${C.oliveSoft}`, boxShadow: C.glow,
        color: C.ink, padding: 18,
      }}>
        <div style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: C.oliveDeep }}>
          Bank balance
        </div>
        <div style={{ fontSize: 36, fontWeight: 800, margin: "4px 0 10px", color: C.olive, fontVariantNumeric: "tabular-nums" }}>
          {inr(bank)}
        </div>
        <div style={{ display: "flex", gap: 18, fontSize: 13, color: C.faint, alignItems: "center" }}>
          <span>This month in <b style={{ color: C.credit }}>{inr(mIn)}</b></span>
          <span style={{ flex: 1 }}>out <b style={{ color: C.debit }}>{inr(mOut)}</b></span>
          <Btn onClick={onImport} style={{ padding: "6px 12px", fontSize: 13, borderColor: C.oliveSoft, color: C.olive }}>
            ⤓ Import
          </Btn>
        </div>
      </div>
      {groups.length === 0 && (
        <div style={{ ...st.card, textAlign: "center", color: C.faint, padding: 28 }}>
          No entries yet — tap <b>+</b> to record the first one.
        </div>
      )}
      {groups.map((g) => (
        <div key={g.date} style={{ margin: "14px 12px 0" }}>
          <div style={{ fontSize: 12, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 2px 6px" }}>
            {prettyDate(g.date)}
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
            {g.items.map((e, i) => (
              <div
                key={e.id}
                className="cb-row cb-press"
                onClick={() => onEdit(e)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "11px 14px",
                  borderTop: i ? `1px solid ${C.line}` : "none", cursor: "pointer",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    {entryLabel(book, e)}
                    {e.head === "Suspense" && (
                      <span style={{ color: C.debit, fontSize: 12, marginLeft: 6 }}>● re-code</span>
                    )}
                  </div>
                  {e.note && (
                    <div style={{ fontSize: 13, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.note}
                    </div>
                  )}
                </div>
                <div style={{
                  fontFamily: F.serif, fontSize: 16, fontWeight: 700, whiteSpace: "nowrap",
                  color: entrySign(e) > 0 ? C.credit : C.debit,
                }}>
                  {entrySign(e) > 0 ? "+" : "−"}{inr(e.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────── add / edit entry sheet ────────────────────── */
function EntrySheet({ book, initial, onSave, onClose }) {
  const editing = !!(initial && initial.id);
  const [type, setType] = useState(initial?.type || "out");
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : "");
  const [head, setHead] = useState(initial?.head || "");
  const [account, setAccount] = useState(initial?.account || (book.bsAccounts[0] || {}).name || "");
  const [partyId, setPartyId] = useState(initial?.partyId || (book.parties[0] || {}).id || "");
  const [dir, setDir] = useState(initial?.dir || "out");
  const [note, setNote] = useState(initial?.note || "");
  const [date, setDate] = useState(initial?.date || today());

  const heads = type === "in" ? book.heads.income : book.heads.expense;
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

  return (
    <Sheet title={editing ? "Re-code entry" : "New entry"} onClose={onClose}>
      <label style={st.label}>Amount</label>
      <AmountField value={amount} onChange={setAmount} autoFocus={!editing} />

      <label style={st.label}>Kind</label>
      <Seg
        value={type}
        onChange={(v) => setType(v)}
        options={[
          { v: "out", label: "Out" },
          { v: "in", label: "In" },
          { v: "transfer", label: "Transfer" },
          { v: "party", label: "Party" },
        ]}
      />

      {(type === "in" || type === "out") && (
        <>
          <label style={st.label}>Head</label>
          <select style={st.input} value={effHead} onChange={(e) => setHead(e.target.value)}>
            {heads.map((h) => (
              <option key={h} value={h}>
                {h}{book.headClass[h] ? ` → ${book.headClass[h]}` : ""}
              </option>
            ))}
          </select>
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
          <Seg
            value={dir}
            onChange={setDir}
            options={[
              { v: "out", label: "Out of bank" },
              { v: "in", label: "Into bank" },
            ]}
          />
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
          <Seg
            value={dir}
            onChange={setDir}
            options={[
              { v: "out", label: "Paid them" },
              { v: "in", label: "They paid me" },
            ]}
          />
          <div style={{ fontSize: 13, color: C.faint, marginTop: 6 }}>
            Party entries update Debtors/Creditors automatically and never touch the P&L.
          </div>
        </>
      )}

      <label style={st.label}>Note</label>
      <input style={st.input} value={note} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />

      <label style={st.label}>Date</label>
      <input style={st.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <Btn primary disabled={!valid} style={{ flex: 1, opacity: valid ? 1 : 0.5 }} onClick={() => valid && save()}>
          {editing ? "Save changes" : "Add entry"}
        </Btn>
        {editing && (initial.type === "in" || initial.type === "out") && (
          <Btn
            onClick={() => save({ head: "Suspense", type: initial.type, account: undefined, partyId: undefined, dir: undefined })}
            title="Entries are never deleted — park it in Suspense and re-code later"
          >
            → Suspense
          </Btn>
        )}
      </div>
      {editing && (
        <div style={{ fontSize: 12, color: C.faint, marginTop: 10 }}>
          Entries are never deleted. Re-code them, or park unexplained ones in Suspense.
        </div>
      )}
    </Sheet>
  );
}

/* ─────────────────── statement import (PDF / image / Excel) ───────────────────
   The file is read on-device; PDF and images go to the Claude API as document/
   image blocks, Excel/CSV are converted to CSV text locally first. Claude
   returns a JSON list of transactions which the user reviews before anything
   is added to the book. */

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

async function fileToContentBlock(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: await fileToBase64(file) },
    };
  }
  if (file.type.startsWith("image/")) {
    return {
      type: "image",
      source: { type: "base64", media_type: file.type, data: await fileToBase64(file) },
    };
  }
  if (name.endsWith(".csv")) {
    return { type: "text", text: `Statement (CSV):\n${await file.text()}` };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const wb = XLSX.read(await file.arrayBuffer());
    const csv = wb.SheetNames
      .map((n) => `--- sheet: ${n} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`)
      .join("\n");
    return { type: "text", text: `Statement (from Excel):\n${csv}` };
  }
  throw new Error("Unsupported file — use PDF, an image, Excel or CSV.");
}

function parseTxJson(text) {
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a < 0 || b < a) throw new Error("Couldn't find transactions in the reply.");
  const rows = JSON.parse(text.slice(a, b + 1));
  return rows
    .filter(
      (r) =>
        r && /^\d{4}-\d{2}-\d{2}$/.test(r.date || "") &&
        Number.isFinite(+r.amount) && +r.amount > 0 &&
        (r.type === "in" || r.type === "out")
    )
    .map((r) => ({
      date: r.date,
      amount: Math.round(+r.amount),
      type: r.type,
      head: typeof r.head === "string" ? r.head : "Suspense",
      note: typeof r.note === "string" ? r.note.slice(0, 80) : "",
      include: true,
    }));
}

function ImportSheet({ book, hasKey, onDone, onClose }) {
  const [stage, setStage] = useState("pick"); // pick | busy | review
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);
  const fileRef = useRef(null);

  const run = async (file) => {
    setErr("");
    setStage("busy");
    try {
      const block = await fileToContentBlock(file);
      const heads = [...book.heads.expense, ...book.heads.income];
      const sys =
        "You extract bank transactions from statements and receipts. Reply with ONLY a JSON " +
        'array, no prose: [{"date":"YYYY-MM-DD","amount":<positive integer rupees>,' +
        '"type":"in" (money into the account) or "out","head":<best-fitting category from ' +
        'the provided list, else "Suspense">,"note":<short description, max 8 words>}]. ' +
        "Skip opening/closing balance lines, totals, and duplicates.";
      const text = await askClaudeContent(sys, [
        { type: "text", text: `Category heads: ${heads.join(", ")}` },
        block,
      ]);
      const parsed = parseTxJson(text);
      if (!parsed.length) throw new Error("No transactions found in that file.");
      setRows(parsed);
      setStage("review");
    } catch (e) {
      setErr(e.message);
      setStage("pick");
    }
  };

  const setRow = (i, patch) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const picked = rows.filter((r) => r.include);

  return (
    <Sheet title="Import statement" onClose={onClose}>
      {stage === "pick" && (
        <>
          <div style={{ fontSize: 13, color: C.faint, margin: "4px 0 12px" }}>
            Upload a bank statement or receipt — PDF, photo, Excel or CSV. It's
            read with your API key (sent only to api.anthropic.com), then you
            review every transaction before it enters the book.
          </div>
          {!hasKey && (
            <div style={{ fontSize: 13, color: C.debit, marginBottom: 10 }}>
              Needs your Anthropic API key — add it in Setup first.
            </div>
          )}
          {err && <div style={{ fontSize: 13, color: C.debit, marginBottom: 10 }}>{err}</div>}
          <Btn
            primary disabled={!hasKey}
            style={{ width: "100%", opacity: hasKey ? 1 : 0.5 }}
            onClick={() => fileRef.current && fileRef.current.click()}
          >
            Choose file…
          </Btn>
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
        <div style={{ textAlign: "center", padding: 30, color: C.faint }}>
          <div style={{ fontFamily: F.serif, fontSize: 18, fontWeight: 700, color: C.olive }}>
            Reading statement…
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Extracting transactions with Claude</div>
        </div>
      )}

      {stage === "review" && (
        <>
          <div style={{ fontSize: 13, color: C.faint, margin: "4px 0 10px" }}>
            {rows.length} found — untick anything you don't want, fix heads, then add.
          </div>
          {rows.map((r, i) => (
            <div
              key={i}
              className="cb-row"
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 0",
                borderTop: i ? `1px solid ${C.line}` : "none",
                opacity: r.include ? 1 : 0.45,
              }}
            >
              <input
                type="checkbox" checked={r.include}
                onChange={(e) => setRow(i, { include: e.target.checked })}
                style={{ width: 18, height: 18, accentColor: C.olive }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.note || "(no description)"}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
                  <span style={{ fontSize: 11, color: C.faint }}>{r.date}</span>
                  <select
                    style={{ ...st.input, width: "auto", padding: "2px 6px", fontSize: 12 }}
                    value={
                      (r.type === "in" ? book.heads.income : book.heads.expense).includes(r.head)
                        ? r.head : "Suspense"
                    }
                    onChange={(e) => setRow(i, { head: e.target.value })}
                  >
                    {(r.type === "in" ? book.heads.income : book.heads.expense).map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{
                fontFamily: F.serif, fontWeight: 700, fontSize: 14, whiteSpace: "nowrap",
                color: r.type === "in" ? C.credit : C.debit,
              }}>
                {r.type === "in" ? "+" : "−"}{inr(r.amount)}
              </div>
            </div>
          ))}
          <Btn
            primary disabled={!picked.length}
            style={{ width: "100%", marginTop: 14, opacity: picked.length ? 1 : 0.5 }}
            onClick={() => onDone(picked)}
          >
            Add {picked.length} {picked.length === 1 ? "entry" : "entries"}
          </Btn>
        </>
      )}
    </Sheet>
  );
}

/* ────────────────────────── Owed ────────────────────────── */
function OwedView({ book, onSettle, onAddMemo }) {
  const [openId, setOpenId] = useState(null);
  const owed = owedAsOf(book, today());
  const debtors = owed.perParty.filter((p) => p.balance > 0);
  const creditors = owed.perParty.filter((p) => p.balance < 0);
  const clear = owed.perParty.filter((p) => p.balance === 0);

  const PartyCard = ({ p }) => {
    const open = openId === p.id;
    const items = [
      ...book.entries
        .filter((e) => e.type === "party" && e.partyId === p.id)
        .map((e) => ({
          date: e.date, note: e.note,
          label: e.dir === "out" ? "Paid via bank" : "Received via bank",
          delta: e.dir === "out" ? e.amount : -e.amount,
        })),
      ...book.owedMemos
        .filter((m) => m.partyId === p.id)
        .map((m) => ({
          date: m.date, note: m.note,
          label: m.amount >= 0 ? "Memo — they owe" : "Memo — I owe",
          delta: m.amount,
        })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    return (
      <div style={{ ...st.card, margin: "8px 12px" }}>
        <div
          onClick={() => setOpenId(open ? null : p.id)}
          style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{p.name}</div>
            <div style={{ fontSize: 12, color: C.faint }}>
              {p.balance > 0 ? "owes you" : p.balance < 0 ? "you owe" : "settled"}
              {p.memo !== 0 && ` · incl. ${inr(p.memo)} on memo`}
            </div>
          </div>
          <div style={{
            fontFamily: F.serif, fontSize: 18, fontWeight: 700,
            color: p.balance > 0 ? C.credit : p.balance < 0 ? C.debit : C.faint,
          }}>
            {inr(Math.abs(p.balance))}
          </div>
        </div>
        {open && (
          <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
            {items.length === 0 && (
              <div style={{ fontSize: 13, color: C.faint }}>No activity yet.</div>
            )}
            {items.map((it, i) => (
              <div key={i} style={{ display: "flex", fontSize: 13, padding: "4px 0", gap: 8 }}>
                <span style={{ color: C.faint, width: 66, flexShrink: 0 }}>{prettyDate(it.date)}</span>
                <span style={{ flex: 1 }}>{it.label}{it.note ? ` · ${it.note}` : ""}</span>
                <span style={{ fontFamily: F.serif, color: it.delta >= 0 ? C.credit : C.debit }}>
                  {it.delta >= 0 ? "+" : "−"}{inr(Math.abs(it.delta))}
                </span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {p.balance !== 0 && (
                <Btn primary style={{ flex: 1 }} onClick={() => onSettle(p)}>
                  Settle via bank
                </Btn>
              )}
              <Btn style={{ flex: 1 }} onClick={() => onAddMemo(p)}>Add memo</Btn>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ ...st.card, display: "flex", textAlign: "center" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Debtors</div>
          <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: C.credit }}>{inr(owed.debtors)}</div>
          <div style={{ fontSize: 11, color: C.faint }}>owe you</div>
        </div>
        <div style={{ width: 1, background: C.line }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Creditors</div>
          <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: C.debit }}>{inr(owed.creditors)}</div>
          <div style={{ fontSize: 11, color: C.faint }}>you owe</div>
        </div>
      </div>
      <div style={{ margin: "4px 14px", fontSize: 12, color: C.faint }}>
        Filled automatically from bank entries tagged to a party, plus manual memos.
      </div>
      {debtors.length > 0 && <div style={{ ...st.label, margin: "14px 14px 0" }}>Debtors</div>}
      {debtors.map((p) => <PartyCard key={p.id} p={p} />)}
      {creditors.length > 0 && <div style={{ ...st.label, margin: "14px 14px 0" }}>Creditors</div>}
      {creditors.map((p) => <PartyCard key={p.id} p={p} />)}
      {clear.length > 0 && <div style={{ ...st.label, margin: "14px 14px 0" }}>No balance</div>}
      {clear.map((p) => <PartyCard key={p.id} p={p} />)}
    </div>
  );
}

function MemoSheet({ party, onSave, onClose }) {
  const [kind, setKind] = useState("debtor");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());
  const amt = parseAmount(amount);
  const valid = !isNaN(amt) && amt > 0 && date;
  return (
    <Sheet title={`Memo — ${party.name}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: C.faint }}>
        For amounts that never moved through the bank (pending bill, informal IOU).
      </div>
      <label style={st.label}>Which way</label>
      <Seg
        value={kind}
        onChange={setKind}
        options={[
          { v: "debtor", label: "They owe me" },
          { v: "creditor", label: "I owe them" },
        ]}
      />
      <label style={st.label}>Amount</label>
      <AmountField value={amount} onChange={setAmount} autoFocus />
      <label style={st.label}>Note</label>
      <input style={st.input} value={note} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
      <label style={st.label}>Date</label>
      <input style={st.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <Btn
        primary disabled={!valid}
        style={{ width: "100%", marginTop: 18, opacity: valid ? 1 : 0.5 }}
        onClick={() =>
          valid &&
          onSave({
            id: uid(), partyId: party.id, date, note: note.trim(),
            amount: kind === "debtor" ? amt : -amt,
          })
        }
      >
        Add memo
      </Btn>
    </Sheet>
  );
}

/* ────────────────────────── Reports ────────────────────────── */
function ReportsView({ book }) {
  const [mode, setMode] = useState("pl");
  const t = today();
  const fys = useMemo(() => {
    const s = new Set([fyOf(t)]);
    for (const e of book.entries) s.add(fyOf(e.date));
    return [...s].sort((a, b) => b - a);
  }, [book.entries, t]);
  const [fy, setFy] = useState(fyOf(t));
  const [span, setSpan] = useState("year"); // year | q1..q4 | m0..m11
  const [asOf, setAsOf] = useState(t);

  const [from, to] =
    span === "year" ? fyRange(fy)
    : span.startsWith("q") ? fyRange(fy, +span[1])
    : monthRange(fy, +span.slice(1));
  const pl = computePL(book, from, to);
  const bs = computeBS(book, asOf || t);

  const RowLine = ({ name, amount, strong, color }) => (
    <div style={{ display: "flex", padding: "5px 0", fontSize: strong ? 15 : 14, fontWeight: strong ? 700 : 400 }}>
      <span style={{ flex: 1 }}>{name}</span>
      <span style={{ fontFamily: F.serif, color: color || C.ink }}>{inr(amount)}</span>
    </div>
  );

  return (
    <div>
      <div style={{ margin: "10px 12px" }}>
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { v: "pl", label: "P&L" },
            { v: "bs", label: "Balance sheet" },
          ]}
        />
      </div>

      {mode === "pl" && (
        <>
          <div style={{ display: "flex", gap: 8, margin: "10px 12px" }}>
            <select style={{ ...st.input, flex: "0 0 130px" }} value={fy} onChange={(e) => setFy(+e.target.value)}>
              {fys.map((y) => (
                <option key={y} value={y}>FY {y}–{String(y + 1).slice(2)}</option>
              ))}
            </select>
            <select style={st.input} value={span} onChange={(e) => setSpan(e.target.value)}>
              <option value="year">Full year</option>
              <option value="q1">Q1 · Apr–Jun</option>
              <option value="q2">Q2 · Jul–Sep</option>
              <option value="q3">Q3 · Oct–Dec</option>
              <option value="q4">Q4 · Jan–Mar</option>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={`m${i}`}>{m} {i < 9 ? fy : fy + 1}</option>
              ))}
            </select>
          </div>
          <div style={st.card}>
            <div style={{ fontFamily: F.serif, fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Income</div>
            {Object.entries(pl.income).map(([h, a]) => <RowLine key={h} name={h} amount={a} />)}
            {Object.keys(pl.income).length === 0 && <div style={{ fontSize: 13, color: C.faint }}>Nothing in this period.</div>}
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 4 }}>
              <RowLine name="Total income" amount={pl.totalIncome} strong color={C.credit} />
            </div>
          </div>
          <div style={st.card}>
            <div style={{ fontFamily: F.serif, fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Expenses</div>
            {Object.entries(pl.expense).map(([h, a]) => <RowLine key={h} name={h} amount={a} />)}
            {Object.keys(pl.expense).length === 0 && <div style={{ fontSize: 13, color: C.faint }}>Nothing in this period.</div>}
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 4 }}>
              <RowLine name="Total expenses" amount={pl.totalExpense} strong color={C.debit} />
            </div>
          </div>
          <div style={{
            ...st.card,
            background: `linear-gradient(135deg, ${C.heroFrom}, ${C.heroTo})`,
            border: `1px solid ${C.oliveSoft}`, boxShadow: C.glow,
          }}>
            <div style={{ display: "flex", color: C.ink }}>
              <span style={{ flex: 1, fontWeight: 700 }}>Net {pl.net >= 0 ? "surplus" : "deficit"}</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: pl.net >= 0 ? C.credit : C.debit }}>{inr(pl.net)}</span>
            </div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>
              Cash basis · transfers, party entries and SIP-type heads excluded
            </div>
          </div>
        </>
      )}

      {mode === "bs" && (
        <>
          <div style={{ margin: "10px 12px" }}>
            <label style={{ ...st.label, margin: "0 0 4px" }}>As of</label>
            <input style={st.input} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          <div style={st.card}>
            <div style={{ fontFamily: F.serif, fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Assets</div>
            {bs.assets.map((r) => <RowLine key={r.name} name={r.name} amount={r.amount} />)}
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 4 }}>
              <RowLine name="Total assets" amount={bs.totalAssets} strong />
            </div>
          </div>
          <div style={st.card}>
            <div style={{ fontFamily: F.serif, fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Liabilities</div>
            {bs.liabilities.map((r) => <RowLine key={r.name} name={r.name} amount={r.amount} />)}
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 4 }}>
              <RowLine name="Total liabilities" amount={bs.totalLiabilities} strong />
            </div>
          </div>
          <div style={st.card}>
            <div style={{ fontFamily: F.serif, fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Equity</div>
            {bs.equity.map((r) => <RowLine key={r.name} name={r.name} amount={r.amount} />)}
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 4 }}>
              <RowLine name="Total equity" amount={bs.totalEquity} strong />
            </div>
          </div>
          <div style={{ ...st.card, textAlign: "center", fontSize: 14 }}>
            Assets {inr(bs.totalAssets)} = Liabilities {inr(bs.totalLiabilities)} + Equity {inr(bs.totalEquity)}{" "}
            <b style={{ color: bs.balanced ? C.credit : C.debit }}>
              {bs.balanced ? "✓ balanced" : "✗ OUT OF BALANCE"}
            </b>
          </div>
        </>
      )}
    </div>
  );
}

/* ────────────────────────── Plan (AI) ────────────────────────── */
function bookSummary(book) {
  const t = today();
  const fy = fyOf(t);
  const [from] = fyRange(fy);
  const pl = computePL(book, from, t);
  const bal = balancesAsOf(book, t);
  const owed = owedAsOf(book, t);
  const lines = [
    `Cash book summary, FY ${fy}-${String(fy + 1).slice(2)} to date (${from} → ${t}). Amounts in INR.`,
    `Income: ${Object.entries(pl.income).map(([h, a]) => `${h} ${a}`).join(", ") || "none"} (total ${pl.totalIncome})`,
    `Expenses: ${Object.entries(pl.expense).map(([h, a]) => `${h} ${a}`).join(", ") || "none"} (total ${pl.totalExpense})`,
    `Net surplus: ${pl.net}`,
    `Bank balance: ${bal.bank}`,
    ...book.bsAccounts.map((a) => `${a.kind === "liability" ? "Liability" : "Asset"} — ${a.name}: ${bal.accounts[a.name]}`),
    `Debtors (owed to me): ${owed.debtors}; Creditors (I owe): ${owed.creditors}`,
  ];
  return lines.join("\n");
}

function PlanView({ book, hasKey }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState("");
  const [err, setErr] = useState("");

  if (!hasKey) {
    return (
      <div style={{ ...st.card, textAlign: "center", padding: 28 }}>
        <div style={{ fontFamily: F.serif, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Plan needs a key</div>
        <div style={{ fontSize: 14, color: C.faint }}>
          Add your Anthropic API key in <b>Setup</b> to get spending insights and a
          month plan. Only the totals above are sent — never your notes or names.
        </div>
      </div>
    );
  }

  const run = async () => {
    setBusy(true); setErr(""); setOut("");
    try {
      const sys =
        "You are a careful personal-finance assistant reviewing an Indian household cash book " +
        "(amounts in ₹, financial year Apr–Mar, cash basis). Be concrete and concise: assess the " +
        "position, flag anything unusual, and give a simple plan for the coming month with 3–5 " +
        "actionable items. Plain text, no markdown tables.";
      setOut(await askClaude(sys, bookSummary(book) + (q.trim() ? `\n\nQuestion: ${q.trim()}` : "")));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={st.card}>
        <div style={{ fontSize: 13, color: C.faint, marginBottom: 10 }}>
          Sends only this FY's totals (heads, balances, owed totals — no notes, no
          names) to Claude and returns a plan.
        </div>
        <input
          style={st.input}
          value={q}
          placeholder="Optional question — e.g. can I raise my SIP?"
          onChange={(e) => setQ(e.target.value)}
        />
        <Btn primary disabled={busy} style={{ width: "100%", marginTop: 10, opacity: busy ? 0.6 : 1 }} onClick={run}>
          {busy ? "Thinking…" : "Get my plan"}
        </Btn>
      </div>
      {err && <div style={{ ...st.card, color: C.debit, fontSize: 14 }}>{err}</div>}
      {out && (
        <div style={{ ...st.card, fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{out}</div>
      )}
    </div>
  );
}

/* ────────────────────────── Setup ────────────────────────── */
function NameEditor({ value, onCommit, placeholder }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      style={{ ...st.input, flex: 1 }}
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

function OpeningAmount({ value, onCommit }) {
  const [v, setV] = useState(String(value || 0));
  useEffect(() => setV(String(value || 0)), [value]);
  return (
    <input
      style={{ ...st.input, width: 110, textAlign: "right", fontFamily: F.serif }}
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

function Section({ title, children, hint }) {
  return (
    <div style={st.card}>
      <div style={{ fontFamily: F.serif, fontSize: 17, fontWeight: 700 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: C.faint, margin: "3px 0 6px" }}>{hint}</div>}
      {children}
    </div>
  );
}

function SetupView({ book, up, hasKey, onKeySaved }) {
  const [keyInput, setKeyInput] = useState("");
  const [newAcct, setNewAcct] = useState("");
  const [newAcctKind, setNewAcctKind] = useState("asset");
  const [newParty, setNewParty] = useState("");
  const [newHead, setNewHead] = useState("");
  const [newHeadSide, setNewHeadSide] = useState("expense");
  const [mapHead, setMapHead] = useState("");
  const [mapAcct, setMapAcct] = useState("");
  const fileRef = useRef(null);

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

  const doExport = () => {
    const blob = new Blob([JSON.stringify(book, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cashbook-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = (file) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result);
        if (!Array.isArray(j.entries)) throw new Error("not a cash book backup");
        if (window.confirm(`Replace this book with the backup? It has ${j.entries.length} entries.`)) {
          up(() => normalizeBook(j));
        }
      } catch (e) {
        window.alert("Could not read backup: " + e.message);
      }
    };
    r.readAsText(file);
  };

  return (
    <div>
      <Section title="Claude API key" hint="Stored only on this device; used only for the Plan tab.">
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            style={{ ...st.input, flex: 1 }}
            type="password"
            placeholder={hasKey ? "Key saved — paste to replace" : "sk-ant-…"}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <Btn
            primary disabled={!keyInput.trim()}
            style={{ opacity: keyInput.trim() ? 1 : 0.5 }}
            onClick={async () => {
              await saveApiKey(keyInput.trim());
              setKeyInput("");
              onKeySaved();
            }}
          >
            Save
          </Btn>
        </div>
        {hasKey && <div style={{ fontSize: 12, color: C.credit, marginTop: 6 }}>✓ key on device</div>}
      </Section>

      <Section
        title="Opening balances"
        hint="Position on the day you started the book. Opening capital is derived so the sheet always balances."
      >
        <label style={st.label}>As of</label>
        <input
          style={st.input} type="date" value={book.opening.asOf}
          onChange={(e) => up((b) => ((b.opening.asOf = e.target.value), b))}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span style={{ flex: 1, fontSize: 14 }}>Bank</span>
          <OpeningAmount value={book.opening.bank} onCommit={(n) => up((b) => ((b.opening.bank = n), b))} />
        </div>
        {book.bsAccounts.map((a) => (
          <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ flex: 1, fontSize: 14 }}>{a.name} <span style={{ color: C.faint }}>({a.kind})</span></span>
            <OpeningAmount
              value={book.opening.accounts[a.name] || 0}
              onCommit={(n) => up((b) => ((b.opening.accounts[a.name] = n), b))}
            />
          </div>
        ))}
        <div style={{ display: "flex", marginTop: 12, paddingTop: 8, borderTop: `1px solid ${C.line}`, fontSize: 14 }}>
          <span style={{ flex: 1, fontWeight: 700 }}>Opening capital (derived)</span>
          <span style={{ fontFamily: F.serif, fontWeight: 700 }}>{inr(openingCapital)}</span>
        </div>
      </Section>

      <Section title="Balance-sheet accounts" hint="Where transfers and classed heads (like SIP) post.">
        {book.bsAccounts.map((a) => (
          <div key={a.name} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <NameEditor value={a.name} onCommit={(n) => renameAccount(a.name, n)} />
            <Btn
              style={{ padding: "8px 10px", fontSize: 13 }}
              onClick={() =>
                up((b) => {
                  const x = b.bsAccounts.find((y) => y.name === a.name);
                  if (x) x.kind = x.kind === "asset" ? "liability" : "asset";
                  return b;
                })
              }
            >
              {a.kind}
            </Btn>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input style={{ ...st.input, flex: 1 }} placeholder="New account" value={newAcct} onChange={(e) => setNewAcct(e.target.value)} />
          <Btn style={{ padding: "8px 10px", fontSize: 13 }} onClick={() => setNewAcctKind(newAcctKind === "asset" ? "liability" : "asset")}>
            {newAcctKind}
          </Btn>
          <Btn
            primary disabled={!newAcct.trim()}
            style={{ opacity: newAcct.trim() ? 1 : 0.5 }}
            onClick={() =>
              up((b) => {
                const n = newAcct.trim();
                if (n && !b.bsAccounts.some((a) => a.name === n)) {
                  b.bsAccounts.push({ name: n, kind: newAcctKind });
                  setNewAcct("");
                }
                return b;
              })
            }
          >
            Add
          </Btn>
        </div>
      </Section>

      <Section title="Parties — debtors & creditors" hint="Tag bank entries to a party and Owed fills itself. Rename the placeholders to real names.">
        {book.parties.map((p) => (
          <div key={p.id} style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <NameEditor
              value={p.name}
              onCommit={(n) =>
                up((b) => {
                  const x = b.parties.find((y) => y.id === p.id);
                  if (x) x.name = n;
                  return b;
                })
              }
            />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input style={{ ...st.input, flex: 1 }} placeholder="New party" value={newParty} onChange={(e) => setNewParty(e.target.value)} />
          <Btn
            primary disabled={!newParty.trim()}
            style={{ opacity: newParty.trim() ? 1 : 0.5 }}
            onClick={() =>
              up((b) => {
                if (newParty.trim()) {
                  b.parties.push({ id: uid(), name: newParty.trim() });
                  setNewParty("");
                }
                return b;
              })
            }
          >
            Add
          </Btn>
        </div>
      </Section>

      <Section title="Heads" hint="P&L categories. Heads mapped to an account post to the balance sheet instead (SIP → Investments).">
        <label style={st.label}>Income</label>
        <div style={{ fontSize: 14, lineHeight: 1.8 }}>{book.heads.income.join(" · ")}</div>
        <label style={st.label}>Expense</label>
        <div style={{ fontSize: 14, lineHeight: 1.8 }}>
          {book.heads.expense.map((h) => (book.headClass[h] ? `${h} → ${book.headClass[h]}` : h)).join(" · ")}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input style={{ ...st.input, flex: 1 }} placeholder="New head" value={newHead} onChange={(e) => setNewHead(e.target.value)} />
          <Btn style={{ padding: "8px 10px", fontSize: 13 }} onClick={() => setNewHeadSide(newHeadSide === "expense" ? "income" : "expense")}>
            {newHeadSide}
          </Btn>
          <Btn
            primary disabled={!newHead.trim()}
            style={{ opacity: newHead.trim() ? 1 : 0.5 }}
            onClick={() =>
              up((b) => {
                const n = newHead.trim();
                if (n && !b.heads[newHeadSide].includes(n)) {
                  b.heads[newHeadSide].push(n);
                  setNewHead("");
                }
                return b;
              })
            }
          >
            Add
          </Btn>
        </div>
        <label style={st.label}>Map a head to an account</label>
        <div style={{ display: "flex", gap: 8 }}>
          <select style={{ ...st.input, flex: 1 }} value={mapHead} onChange={(e) => setMapHead(e.target.value)}>
            <option value="">head…</option>
            {[...book.heads.expense, ...book.heads.income].map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <select style={{ ...st.input, flex: 1 }} value={mapAcct} onChange={(e) => setMapAcct(e.target.value)}>
            <option value="">account… (or P&L)</option>
            {book.bsAccounts.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
          <Btn
            primary disabled={!mapHead}
            style={{ opacity: mapHead ? 1 : 0.5 }}
            onClick={() =>
              up((b) => {
                if (!mapHead) return b;
                if (mapAcct) b.headClass[mapHead] = mapAcct;
                else delete b.headClass[mapHead];
                return b;
              })
            }
          >
            Set
          </Btn>
        </div>
      </Section>

      <Section title="Backup" hint="Everything lives only on this phone — export regularly. Never commit backups anywhere shared.">
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn primary style={{ flex: 1 }} onClick={doExport}>Export JSON</Btn>
          <Btn style={{ flex: 1 }} onClick={() => fileRef.current && fileRef.current.click()}>Import…</Btn>
          <input
            ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files[0]) doImport(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </div>
      </Section>
    </div>
  );
}

/* ────────────────────────── app shell ────────────────────────── */
const TABS = [
  { id: "book", label: "Book", icon: "▤" },
  { id: "owed", label: "Owed", icon: "⇄" },
  { id: "reports", label: "Reports", icon: "∑" },
  { id: "plan", label: "Plan", icon: "✦" },
  { id: "setup", label: "Setup", icon: "⚙" },
];

export default function CashBook() {
  const [book, setBook] = useState(null);
  const [tab, setTab] = useState("book");
  const [entrySheet, setEntrySheet] = useState(null); // {initial} | null
  const [memoParty, setMemoParty] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const skipSave = useRef(true);

  useEffect(() => {
    loadBook().then((b) => setBook(b ? normalizeBook(b) : defaultBook()));
    loadApiKey().then((k) => setHasKey(!!k));
  }, []);
  useEffect(() => {
    if (!book) return;
    if (skipSave.current) { skipSave.current = false; return; }
    saveBook(book);
  }, [book]);

  const up = (fn) => setBook((b) => fn(clone(b)));

  if (!book) {
    return (
      <div style={{
        minHeight: "100vh", background: C.paper, display: "flex",
        alignItems: "center", justifyContent: "center",
        fontFamily: F.serif, fontSize: 20, color: C.olive,
      }}>
        Cash Book
      </div>
    );
  }

  const saveEntry = (e) => {
    up((b) => {
      const i = b.entries.findIndex((x) => x.id === e.id);
      const cleaned = JSON.parse(JSON.stringify(e)); // drops undefined fields
      if (i >= 0) b.entries[i] = cleaned;
      else b.entries.push(cleaned);
      return b;
    });
    setEntrySheet(null);
  };

  return (
    <div style={{
      fontFamily: F.sans, color: C.ink, background: C.paper, minHeight: "100vh",
      maxWidth: 480, margin: "0 auto",
      paddingBottom: "calc(92px + env(safe-area-inset-bottom))",
    }}>
      <style>{ANIM_CSS}</style>
      <div style={{
        display: "flex", alignItems: "baseline", padding: "16px 16px 4px",
      }}>
        <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: C.oliveDeep, flex: 1 }}>
          Cash Book
        </div>
        <div style={{ fontSize: 12, color: C.faint }}>
          FY {fyOf(today())}–{String(fyOf(today()) + 1).slice(2)} · Q{quarterOf(today())}
        </div>
      </div>

      <div className="cb-view" key={tab}>
        {tab === "book" && (
          <BookView
            book={book}
            onEdit={(e) => setEntrySheet({ initial: e })}
            onImport={() => setImportOpen(true)}
          />
        )}
        {tab === "owed" && (
          <OwedView
            book={book}
            onSettle={(p) =>
              setEntrySheet({
                initial: {
                  type: "party", partyId: p.id, amount: Math.abs(p.balance),
                  dir: p.balance > 0 ? "in" : "out", date: today(), note: "Settlement",
                },
              })
            }
            onAddMemo={(p) => setMemoParty(p)}
          />
        )}
        {tab === "reports" && <ReportsView book={book} />}
        {tab === "plan" && <PlanView book={book} hasKey={hasKey} />}
        {tab === "setup" && <SetupView book={book} up={up} hasKey={hasKey} onKeySaved={() => setHasKey(true)} />}
      </div>

      {tab === "book" && (
        <button
          onClick={() => setEntrySheet({ initial: null })}
          aria-label="Add entry"
          className="cb-fab"
          style={{
            position: "fixed", right: 18, bottom: "calc(76px + env(safe-area-inset-bottom))",
            width: 58, height: 58, borderRadius: 29, border: "none",
            background: C.olive, color: C.creamText, fontSize: 30, lineHeight: "58px",
            fontWeight: 700, boxShadow: C.glow, cursor: "pointer", zIndex: 20,
          }}
        >
          +
        </button>
      )}

      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 25,
        background: C.card, borderTop: `1px solid ${C.line}`,
      }}>
        <div style={{
          display: "flex", maxWidth: 480, margin: "0 auto",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}>
          {TABS.map((tb) => (
            <button
              key={tb.id}
              className="cb-tab"
              onClick={() => setTab(tb.id)}
              style={{
                flex: 1, padding: "9px 0 7px", border: "none", background: "none",
                cursor: "pointer", color: tab === tb.id ? C.olive : C.faint,
                fontFamily: F.sans,
              }}
            >
              <div style={{ fontSize: 17, lineHeight: 1 }}>{tb.icon}</div>
              <div style={{ fontSize: 11, fontWeight: tab === tb.id ? 700 : 500, marginTop: 3 }}>
                {tb.label}
              </div>
            </button>
          ))}
        </div>
      </div>

      {entrySheet && (
        <EntrySheet
          book={book}
          initial={entrySheet.initial}
          onSave={saveEntry}
          onClose={() => setEntrySheet(null)}
        />
      )}
      {importOpen && (
        <ImportSheet
          book={book}
          hasKey={hasKey}
          onClose={() => setImportOpen(false)}
          onDone={(picked) => {
            up((b) => {
              for (const r of picked) {
                const heads = r.type === "in" ? b.heads.income : b.heads.expense;
                b.entries.push({
                  id: uid(), date: r.date, amount: r.amount, type: r.type,
                  head: heads.includes(r.head) ? r.head : "Suspense",
                  note: r.note,
                });
              }
              return b;
            });
            setImportOpen(false);
          }}
        />
      )}
      {memoParty && (
        <MemoSheet
          party={memoParty}
          onClose={() => setMemoParty(null)}
          onSave={(m) => {
            up((b) => (b.owedMemos.push(m), b));
            setMemoParty(null);
          }}
        />
      )}
    </div>
  );
}
