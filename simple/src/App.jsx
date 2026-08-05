import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadBook, saveBook, defaultBook } from "./storage.js";
import {
  inr, parseAmount, today, fyOf, fyRange, periodRange, comparePeriod, periodVariance,
  uid, isExplained, isRefund, computePL, computeCashFlow, accountsWithBalances,
  owedAsOf, tripSpendAsOf, suggestHead, keywordOf,
} from "./engine.js";
import { extractPdfPages, parsePdfTable, parseStatementText, getOcrWorker } from "./pdf.js";

/* ────────────────────────── theme tokens ──────────────────────────
   Amber Violet (dark) / Paper White (light) — copied verbatim from the
   main app's current THEMES (src/CashBook.jsx), same palette identity
   the approved mockup's own dark/light CSS custom properties already
   match 1:1. No in-app theme toggle: this app follows prefers-color-
   scheme only (see the useTheme hook below). */
function alpha(hex, a) {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const THEMES = {
  dark: {
    accent: "#a78bfa", accentDeep: "#6d28d9", accentText: "#c4a6ff",
    bg: "#050308", ink: "#f1ecfb", soft: "#e4d9f5", muted: "#a99cc9", faint: "#8a7fae",
    glass: "linear-gradient(160deg, rgba(255,255,255,.10), rgba(255,255,255,.02))",
    glassSoft: "linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.02))",
    border: "1px solid rgba(255,255,255,.14)", borderSoft: "1px solid rgba(255,255,255,.10)",
    line: "rgba(255,255,255,.08)",
    shadow: "0 20px 40px -22px rgba(0,0,0,.6)",
    sheetBg: "linear-gradient(170deg,#171029,#0c0716)", navBg: "rgba(13,10,23,.94)", headerBg: "rgba(6,4,10,.55)",
    green: "#6ee7b7", red: "#fda4af", amberText: "#fbbf24",
    overlayWash: "rgba(255,255,255,.06)", overlayBorder: "rgba(255,255,255,.16)", overlayStrong: "rgba(255,255,255,.22)",
    bgImage: "bg-violet.png", scrim: "rgba(5,3,10,.4)",
    stripeGrad: "linear-gradient(90deg,#6d28d9,#a78bfa,#fde68a)",
    iconBg: "rgba(196,166,255,.16)", iconGlow: "0 0 22px 3px rgba(167,139,250,.4), 0 0 0 1px rgba(196,166,255,.3)",
    dimBg: "rgba(3,2,6,.65)",
  },
  light: {
    accent: "#4f46e5", accentDeep: "#4338ca", accentText: "#3730a3",
    bg: "#f6f5f3", ink: "#181521", soft: "#3d3850", muted: "#6b6478", faint: "#948da0",
    glass: "linear-gradient(170deg,#ffffff,#fbfaf9)", glassSoft: "linear-gradient(170deg,#fdfcfb,#f7f6f4)",
    border: "1px solid rgba(0,0,0,.07)", borderSoft: "1px solid rgba(0,0,0,.045)",
    line: "rgba(0,0,0,.06)",
    shadow: "0 20px 40px -22px rgba(24,21,33,.18)",
    sheetBg: "linear-gradient(170deg,#ffffff,#f4f3f1)", navBg: "rgba(255,255,255,.92)", headerBg: "rgba(255,255,255,.82)",
    green: "#047857", red: "#dc2626", amberText: "#b45309",
    overlayWash: "rgba(0,0,0,.045)", overlayBorder: "rgba(0,0,0,.10)", overlayStrong: "rgba(0,0,0,.16)",
    bgImage: "bg-paperwhite.png", scrim: "rgba(246,245,243,.88)",
    stripeGrad: "linear-gradient(90deg,#4338ca,#4f46e5,#fde68a)",
    iconBg: "transparent", iconGlow: "none",
    dimBg: "rgba(24,21,33,.35)",
  },
};

function deriveTokens(t) {
  return {
    ...t,
    grad: `linear-gradient(135deg,${t.accent},${t.accentDeep})`,
    accentSoft: alpha(t.accent, 0.18),
    accentBorder: alpha(t.accent, 0.5),
  };
}

const C = { ...deriveTokens(THEMES.dark) };
function applyTheme(mode) {
  Object.assign(C, deriveTokens(THEMES[mode] || THEMES.dark));
}

const F = { sans: '"Sora", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' };

function glass(radius = 18) {
  return { background: C.glass, backdropFilter: "blur(24px) saturate(160%)", WebkitBackdropFilter: "blur(24px) saturate(160%)", border: C.border, borderRadius: radius, boxShadow: C.shadow };
}
const st = {
  get input() { return { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.overlayBorder}`, background: C.overlayWash, fontSize: 13.5, fontFamily: F.sans, color: C.ink }; },
  get label() { return { display: "block", fontSize: 10, color: C.muted, margin: "10px 0 5px", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }; },
};

/* ────────────────────────── icons ────────────────────────── */
function Ic({ name, size = 16, color, style }) {
  const P = {
    home: "M3 11.5 12 4l9 7.5 M5.5 10v8.5a1 1 0 0 0 1 1H9v-6h6v6h2.5a1 1 0 0 0 1-1V10",
    people: "M8.5 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M16.5 9.5m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0 M2.5 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M14.5 20c0-2.3 1-4.3 2.7-5.4",
    plane: "M2.5 16.5 21 7.6a1.6 1.6 0 0 0-2.1-2.2L9.4 12H4l-2 2.2 5 1.3z M9.4 12l1.6 8 2.3-2 .3-4",
    swap: "M4 7h14M15 4l3 3-3 3 M20 17H6M9 20l-3-3 3-3",
    bars: "M4 20V11 M12 20V5 M20 20v-7",
    sliders: "M3 6h7 M17 6h4 M13 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M3 12h2 M9 12h12 M6 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M3 18h10 M19 18h2 M16 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0",
    search: "M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0 M21 21l-4.5-4.5",
    close: "M18 6 6 18 M6 6l12 12",
    plus: "M12 5v14M5 12h14",
    upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5-5 5 5 M12 15V3",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5 5-5-5 M12 3v10",
    wand: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 13 5",
    back: "M15 18l-6-6 6-6",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d={P[name] || ""} />
    </svg>
  );
}

/* ────────────────────────── primitives ────────────────────────── */
function PrimaryBtn({ children, style, ...rest }) {
  return <button {...rest} style={{ width: "100%", padding: "12px 0", borderRadius: 14, border: "none", background: C.grad, color: "#fff", fontWeight: 800, fontSize: 13.5, fontFamily: F.sans, cursor: "pointer", boxShadow: `0 10px 22px -8px ${C.accentDeep}`, ...style }}>{children}</button>;
}
function GhostBtn({ children, style, ...rest }) {
  return <button {...rest} style={{ padding: "12px 0", borderRadius: 14, border: C.borderSoft, background: C.glassSoft, color: C.ink, fontWeight: 700, fontSize: 13, fontFamily: F.sans, cursor: "pointer", ...style }}>{children}</button>;
}
function RoundBtn({ onClick, children, style }) {
  return <div onClick={onClick} style={{ width: 30, height: 30, borderRadius: "50%", background: C.glassSoft, border: C.overlayBorder ? `1px solid ${C.overlayBorder}` : undefined, display: "flex", alignItems: "center", justifyContent: "center", color: C.soft, flexShrink: 0, cursor: "pointer", ...style }}>{children}</div>;
}
function Seg({ value, onChange, options, wrap4, style }) {
  return (
    <div style={{ display: "flex", flexWrap: wrap4 ? "wrap" : "nowrap", gap: 6, background: C.overlayWash, border: `1px solid ${C.line}`, borderRadius: 14, padding: 4, ...style }}>
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button key={o.v} onClick={() => onChange(o.v)} style={{ flex: wrap4 ? "0 0 48%" : 1, border: "none", borderRadius: 10, padding: "8px 4px", fontSize: 11.5, fontWeight: 700, fontFamily: F.sans, cursor: "pointer", background: active ? C.grad : "transparent", color: active ? "#fff" : C.muted, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            {o.label}
            {o.badge != null && <span style={{ background: C.amberText, color: "#1c1024", borderRadius: 999, padding: "1px 6px", fontSize: 9.5 }}>{o.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
function FilterChip({ active, onClick, children }) {
  return <button onClick={onClick} style={{ fontSize: 10.5, fontWeight: 700, padding: "6px 12px", borderRadius: 999, border: `1px solid ${C.border ? "" : ""}${active ? "transparent" : C.overlayBorder}`, color: active ? "#fff" : C.muted, background: active ? C.grad : "none", cursor: "pointer", fontFamily: F.sans, flexShrink: 0 }}>{children}</button>;
}
function Toggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 0, background: C.overlayWash, border: `1px solid ${C.line}`, borderRadius: 999, padding: 3 }}>
      {[["on", "On"], ["off", "Off"]].map(([v, l]) => (
        <button key={v} onClick={() => onChange(v === "on")} style={{ padding: "6px 14px", borderRadius: 999, border: "none", fontWeight: 700, fontSize: 12, fontFamily: F.sans, cursor: "pointer", background: (value ? "on" : "off") === v ? C.grad : "transparent", color: (value ? "on" : "off") === v ? "#fff" : C.muted }}>{l}</button>
      ))}
    </div>
  );
}

function Sheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center", background: C.dimBg, backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", boxSizing: "border-box", background: C.sheetBg, border: C.border, borderTop: `1px solid ${C.overlayStrong}`, borderRadius: "24px 24px 0 0", padding: "10px 18px 28px", fontFamily: F.sans, color: C.ink }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: C.overlayStrong, margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
          <RoundBtn onClick={onClose}><Ic name="close" size={13} /></RoundBtn>
          <div style={{ flex: 1, textAlign: "center", fontSize: 16, fontWeight: 800 }}>{title}</div>
          <div style={{ width: 30, flexShrink: 0 }} />
        </div>
        {children}
      </div>
    </div>
  );
}

function PageOverlay({ open, onBack, title, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 190, background: C.bg, overflowY: "auto", fontFamily: F.sans, color: C.ink }}>
      <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", padding: "16px 18px 8px", background: C.headerBg, backdropFilter: "blur(20px)" }}>
        <RoundBtn onClick={onBack}><Ic name="back" size={14} /></RoundBtn>
        <div style={{ flex: 1, textAlign: "center", fontSize: 16, fontWeight: 800 }}>{title}</div>
        <div style={{ width: 30, flexShrink: 0 }} />
      </div>
      <div style={{ padding: "12px 16px 60px" }}>{children}</div>
    </div>
  );
}

// The one shared category picker used identically by both New Transaction
// and Code Transaction: a real <select> with two <optgroup>s — P&L
// categories for the current direction, and every Balance Sheet category
// (available regardless of direction) — plus a note when a BS option is
// selected, matching the approved mockup's own markup exactly.
function CategorySelect({ book, value, onChange, direction }) {
  const plCats = direction === "in" ? book.categories.income : book.categories.expense.filter((c) => c !== "Suspense");
  const isBS = book.bsCategories.includes(value);
  return (
    <div>
      <select style={st.input} value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Profit &amp; Loss">
          {plCats.map((c) => <option key={c} value={c}>{c}</option>)}
        </optgroup>
        <optgroup label="Balance Sheet">
          {book.bsCategories.map((c) => <option key={c} value={c}>{c}</option>)}
        </optgroup>
      </select>
      {isBS && <div style={{ fontSize: 10, color: C.amberText, fontWeight: 600, marginTop: 6, lineHeight: 1.5 }}>This is a Balance Sheet category — it'll count in Cash Flow but not in P&amp;L.</div>}
    </div>
  );
}

function AccountSelect({ book, value, onChange, accounts }) {
  const list = accounts || book.accounts;
  return (
    <select style={st.input} value={value || ""} onChange={(e) => onChange(e.target.value)}>
      {list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

// "+ New person..." reveals an inline add row instead of navigating away --
// there is no dedicated Setup ▸ Parties screen (the approved mockup never
// had one), so this is the only place a party can be created.
function PartySelect({ book, up, value, onChange }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  if (adding) {
    return (
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...st.input, flex: 1 }} placeholder="Person's name" value={name} autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addNow()} />
        <PrimaryBtn style={{ width: "auto", padding: "0 16px" }} onClick={addNow}>Add</PrimaryBtn>
      </div>
    );
  }
  function addNow() {
    const n = name.trim();
    if (!n) return;
    const id = uid();
    up((b) => { b.parties.push({ id, name: n }); return b; });
    setAdding(false);
    setName("");
    onChange(id);
  }
  return (
    <select style={st.input} value={value || ""} onChange={(e) => (e.target.value === "__new__" ? setAdding(true) : onChange(e.target.value))}>
      <option value="">Select a person</option>
      {book.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      <option value="__new__">+ New person…</option>
    </select>
  );
}

/* ────────────────────────── header + card helpers ────────────────────────── */
function Header({ title, brand, actions }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 8px", gap: 10 }}>
      {brand ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: C.grad, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, color: "#fff", boxShadow: `0 8px 16px -4px ${C.accentDeep}`, flexShrink: 0 }}>₹</div>
          <div>
            <b style={{ fontWeight: 800, fontSize: 14, display: "block" }}>Cash Book</b>
            <span style={{ fontSize: 9, color: C.muted, fontWeight: 600 }}>Bank &amp; card, simplified</span>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>{title}</div>
      )}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>{actions}</div>
    </div>
  );
}
function IconBtn({ onClick, children }) {
  return <div onClick={onClick} style={{ width: 29, height: 29, borderRadius: "50%", background: C.glassSoft, border: `1px solid ${C.overlayBorder}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.soft, cursor: "pointer" }}>{children}</div>;
}
function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ ...glass(18), padding: 16, ...style }}>{children}</div>;
}
function Section({ title, action, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 2px" }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}
function RowLine({ children, onClick, last }) {
  return <div onClick={onClick} style={{ display: "flex", alignItems: "center", padding: "12px 0", borderTop: last ? "none" : `1px solid ${C.line}`, cursor: onClick ? "pointer" : "default" }}>{children}</div>;
}

/* ══════════════════════════ HOME ══════════════════════════ */
function HomeScreen({ book, go, openSheet, openAccountsPage }) {
  const t = today();
  const monthStart = t.slice(0, 8) + "01";
  const pl = computePL(book, monthStart, t);
  const accounts = accountsWithBalances(book, t);
  const owed = owedAsOf(book, t);
  const trips = tripSpendAsOf(book, t);
  const activeTrip = trips[0];

  return (
    <div style={{ padding: "4px 16px 90px" }}>
      <Card style={{ marginBottom: 14, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: C.stripeGrad }} />
        <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>This Month · P&amp;L</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginTop: 10 }}>
          <div><div style={{ fontSize: 15.5, fontWeight: 800, color: C.green, fontVariantNumeric: "tabular-nums" }}>{inr(pl.totalIncome)}</div><div style={{ fontSize: 8.5, color: C.faint, fontWeight: 700, textTransform: "uppercase", marginTop: 3 }}>Income</div></div>
          <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 8 }}><div style={{ fontSize: 15.5, fontWeight: 800, color: C.red, fontVariantNumeric: "tabular-nums" }}>{inr(pl.totalExpense)}</div><div style={{ fontSize: 8.5, color: C.faint, fontWeight: 700, textTransform: "uppercase", marginTop: 3 }}>Expenses</div></div>
          <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 8 }}><div style={{ fontSize: 15.5, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{inr(pl.net)}</div><div style={{ fontSize: 8.5, color: C.faint, fontWeight: 700, textTransform: "uppercase", marginTop: 3 }}>Saved</div></div>
        </div>
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginTop: 10 }}>EMI &amp; lending excluded here — see Cash Flow in Reports</div>
      </Card>

      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, padding: "0 2px" }}>Accounts</div>
      {accounts.length === 0 ? (
        <div style={{ ...glass(16), padding: 16, marginBottom: 14, fontSize: 12.5, color: C.muted }}>No accounts yet — add one in Setup ▸ Accounts.</div>
      ) : (
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 2, marginBottom: 14 }}>
          {accounts.map((a) => (
            <div key={a.id} style={{ flex: "0 0 78%" }}>
              <div style={{ background: C.glass, backdropFilter: "blur(24px) saturate(160%)", border: "none", borderRadius: 18, boxShadow: C.shadow, padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{a.name}</div>
                  {a.kind === "bank"
                    ? <span style={{ width: 7, height: 7, borderRadius: 999, background: C.green, boxShadow: `0 0 6px ${C.green}` }} />
                    : <span style={{ fontSize: 9.5, fontWeight: 700, color: C.red }}>{a.dueDay ? `Due ${a.dueDay}${dueOrdinal(a.dueDay)}` : ""}</span>}
                </div>
                <div style={{ fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: ".05em", margin: "8px 0 3px", fontWeight: 700 }}>{a.kind === "bank" ? "Available Balance" : "Outstanding"}</div>
                <div style={{ fontSize: 21, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: a.kind === "card" ? C.red : C.ink }}>{inr(Math.abs(a.balance))}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, margin: "0 0 16px" }}>
        <button onClick={() => openSheet("import")} style={{ flex: 1, padding: "15px 0", borderRadius: 16, background: C.glassSoft, backdropFilter: "blur(20px) saturate(160%)", border: C.borderSoft, color: C.ink, fontWeight: 700, fontSize: 12.5, fontFamily: F.sans, cursor: "pointer", textAlign: "center", boxShadow: C.shadow }}>Import PDF</button>
        <button onClick={() => openSheet("newTx")} style={{ flex: 1, padding: "15px 0", borderRadius: 16, background: C.glassSoft, backdropFilter: "blur(20px) saturate(160%)", border: C.borderSoft, color: C.accentText, fontWeight: 800, fontSize: 12.5, fontFamily: F.sans, cursor: "pointer", textAlign: "center", boxShadow: C.shadow }}>Add Transaction</button>
      </div>

      <Section title="Owed" action={<div onClick={() => go("owed")} style={{ fontSize: 11, fontWeight: 700, color: C.accentText, cursor: "pointer" }}>View all ›</div>}>
        <Card style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>You'll receive</div><div style={{ fontSize: 15, fontWeight: 800, color: C.green, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{inr(owed.debtors)}</div></div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>You owe</div><div style={{ fontSize: 15, fontWeight: 800, color: C.red, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{inr(owed.creditors)}</div></div>
        </Card>
      </Section>

      <Section title="Travel" action={<div onClick={() => go("travel")} style={{ fontSize: 11, fontWeight: 700, color: C.accentText, cursor: "pointer" }}>View all ›</div>}>
        {activeTrip ? (
          <Card onClick={() => openSheet("tripDetail", { tripId: activeTrip.id })} style={{ cursor: "pointer" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{activeTrip.name}</div>
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 2 }}>
              {activeTrip.startDate ? `${activeTrip.startDate} – ${activeTrip.endDate || ""}` : "No dates set"} · {inr(activeTrip.spent)}{activeTrip.budget ? ` of ${inr(activeTrip.budget)} budget` : ""}
            </div>
            {activeTrip.budget > 0 && (
              <div style={{ height: 6, borderRadius: 3, background: C.overlayWash, overflow: "hidden", marginTop: 8 }}>
                <div style={{ height: "100%", width: `${Math.min(100, Math.round((activeTrip.spent / activeTrip.budget) * 100))}%`, borderRadius: 3, background: C.accent }} />
              </div>
            )}
          </Card>
        ) : (
          <div style={{ ...glass(16), padding: 16, fontSize: 12.5, color: C.muted }}>No trips yet — add one in Travel.</div>
        )}
      </Section>
    </div>
  );
}
function dueOrdinal(d) {
  if (d % 10 === 1 && d !== 11) return "st";
  if (d % 10 === 2 && d !== 12) return "nd";
  if (d % 10 === 3 && d !== 13) return "rd";
  return "th";
}

/* ══════════════════════════ OWED ══════════════════════════ */
function OwedScreen({ book, openSheet }) {
  const t = today();
  const owed = owedAsOf(book, t);
  const [seg, setSeg] = useState("all");
  const net = owed.debtors - owed.creditors;
  const recv = owed.perParty.filter((p) => p.balance > 0);
  const pay = owed.perParty.filter((p) => p.balance < 0);
  const rows = seg === "recv" ? recv : seg === "pay" ? pay : owed.perParty.filter((p) => p.balance !== 0);

  return (
    <div style={{ padding: "4px 16px 90px" }}>
      <Card style={{ marginBottom: 14, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: C.stripeGrad }} />
        <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>Net Position</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: net >= 0 ? C.green : C.red, margin: "6px 0 12px", fontVariantNumeric: "tabular-nums" }}>{net >= 0 ? "+" : "−"}{inr(Math.abs(net))}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, background: "rgba(52,211,153,.12)", border: "1px solid rgba(52,211,153,.3)", borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>You'll receive</div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: C.green, marginTop: 3 }}>{inr(owed.debtors)}</div>
          </div>
          <div style={{ flex: 1, background: "rgba(251,113,133,.12)", border: "1px solid rgba(251,113,133,.3)", borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>You owe</div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: C.red, marginTop: 3 }}>{inr(owed.creditors)}</div>
          </div>
        </div>
      </Card>

      <Seg value={seg} onChange={setSeg} style={{ marginBottom: 14 }} options={[{ v: "all", label: "All" }, { v: "recv", label: "Receivables" }, { v: "pay", label: "Payables" }]} />

      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6, padding: "0 2px" }}>{seg === "recv" ? "Receivables" : seg === "pay" ? "Payables" : "All Activity"}</div>
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        {rows.length === 0 && <div style={{ padding: "14px 0", fontSize: 12.5, color: C.muted }}>Nothing here yet.</div>}
        {rows.map((p, i) => (
          <RowLine key={p.id} last={i === rows.length - 1} onClick={() => openSheet("recordPayment", { partyId: p.id })}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 1 }}>{p.balance > 0 ? "Owes you" : "You owe them"}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: p.balance > 0 ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>{inr(Math.abs(p.balance))}</div>
          </RowLine>
        ))}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <PrimaryBtn onClick={() => openSheet("newTx", { presetDir: "in", presetSub: "party" })}>+ Add Receivable</PrimaryBtn>
        <GhostBtn onClick={() => openSheet("recordPayment")}>Record Payment</GhostBtn>
      </div>
    </div>
  );
}

/* ══════════════════════════ TRAVEL ══════════════════════════ */
function TravelScreen({ book, openSheet }) {
  const t = today();
  const trips = tripSpendAsOf(book, t);
  const totalSpend = trips.reduce((s, tr) => s + tr.spent, 0);
  return (
    <div style={{ padding: "4px 16px 90px" }}>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>Total Trip Spend</div>
        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{inr(totalSpend)}</div>
        <div style={{ fontSize: 10.5, color: C.faint, fontWeight: 600, marginTop: 2 }}>across {trips.length} trip{trips.length === 1 ? "" : "s"}</div>
      </Card>

      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, padding: "0 2px" }}>Trips</div>
      {trips.length === 0 && <div style={{ ...glass(16), padding: 16, marginBottom: 14, fontSize: 12.5, color: C.muted }}>No trips tracked yet.</div>}
      {trips.map((tr) => {
        const pct = tr.budget ? Math.min(100, Math.round((tr.spent / tr.budget) * 100)) : null;
        return (
          <Card key={tr.id} onClick={() => openSheet("tripDetail", { tripId: tr.id })} style={{ marginBottom: 14, cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{tr.name}</div>
              <div style={{ color: C.muted, fontSize: 15 }}>›</div>
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 2 }}>{tr.startDate ? `${tr.startDate} – ${tr.endDate || ""}` : "No dates set"}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{inr(tr.spent)} {tr.budget > 0 && <span style={{ color: C.faint, fontWeight: 600, fontSize: 11 }}>of {inr(tr.budget)}</span>}</div>
              {pct != null && <div style={{ fontSize: 11, fontWeight: 700, color: pct > 100 ? C.red : C.green }}>{pct}%</div>}
            </div>
            {pct != null && (
              <div style={{ height: 6, borderRadius: 3, background: C.overlayWash, overflow: "hidden", marginTop: 8 }}>
                <div style={{ height: "100%", width: `${pct}%`, borderRadius: 3, background: pct > 100 ? C.red : C.accent }} />
              </div>
            )}
          </Card>
        );
      })}
      <GhostBtn style={{ width: "100%" }} onClick={() => openSheet("newTrip")}>+ New Trip</GhostBtn>
    </div>
  );
}

function TripDetailSheet({ book, up, tripId, openSheet, close }) {
  const t = today();
  const trip = book.trips.find((x) => x.id === tripId);
  if (!trip) return null;
  const entries = book.entries
    .filter((e) => e.tripId === tripId && (e.type === "out" || e.type === "in") && isExplained(e))
    .sort((a, b) => b.date.localeCompare(a.date));
  const spend = tripSpendAsOf(book, t).find((x) => x.id === tripId);
  const byCategory = {};
  for (const e of entries) {
    if (e.type !== "out") continue;
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }
  const catRows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const max = catRows.length ? catRows[0][1] : 0;

  return (
    <Sheet open title={trip.name} onClose={close}>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", fontWeight: 700 }}>Total Spend</div>
        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{inr(spend ? spend.spent : 0)}</div>
        {trip.budget > 0 && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>of {inr(trip.budget)} budget</div>}
      </Card>

      {catRows.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>By Category</div>
          <Card style={{ padding: "10px 16px" }}>
            {catRows.map(([c, a]) => (
              <div key={c} style={{ marginBottom: 9 }}>
                <div style={{ display: "flex", fontSize: 12, marginBottom: 3 }}><span style={{ flex: 1 }}>{c}</span><span style={{ fontWeight: 700 }}>{inr(a)}</span></div>
                <div style={{ height: 6, borderRadius: 3, background: C.overlayWash, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.round((a / max) * 100)}%`, borderRadius: 3, background: C.accent }} /></div>
              </div>
            ))}
          </Card>
        </div>
      )}

      <PrimaryBtn style={{ marginBottom: 14 }} onClick={() => openSheet("newTx", { presetTripId: tripId })}>+ Add Expense</PrimaryBtn>

      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Activity</div>
      <Card style={{ padding: "2px 16px" }}>
        {entries.length === 0 && <div style={{ padding: "14px 0", fontSize: 12.5, color: C.muted }}>No expenses tagged to this trip yet.</div>}
        {entries.map((e, i) => (
          <RowLine key={e.id} last={i === entries.length - 1}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{e.category}</div><div style={{ fontSize: 10, color: C.muted }}>{e.date}</div></div>
            <div style={{ fontSize: 13, fontWeight: 800, color: e.type === "in" ? C.green : C.red }}>{e.type === "in" ? "+" : "−"}{inr(e.amount)}</div>
          </RowLine>
        ))}
      </Card>
    </Sheet>
  );
}

/* ══════════════════════════ TRANSACTIONS ══════════════════════════ */
// Explained rows now include Transfer and Party entries too (they used to
// be filtered out of Transactions entirely, which made them vanish the
// moment an Unexplained row was coded as one -- looked exactly like the
// app "didn't save" the change). Each type gets its own title/subtitle/
// amount-sign treatment since none of them share Category/Party/Transfer
// shape.
function explainedRowInfo(book, e) {
  const accountName = (id) => (book.accounts.find((a) => a.id === id) || {}).name || "—";
  const partyName = (id) => (book.parties.find((p) => p.id === id) || {}).name || "Unknown";
  if (e.type === "transfer") {
    return { title: "Transfer", sub: `${accountName(e.fromAccountId)} → ${accountName(e.toAccountId)}`, sign: null, color: C.ink };
  }
  if (e.type === "party") {
    const out = e.dir === "out";
    return { title: out ? `Paid ${partyName(e.partyId)}` : `Received from ${partyName(e.partyId)}`, sub: accountName(e.accountId), sign: out ? "−" : "+", color: out ? C.red : C.green };
  }
  const isBS = book.bsCategories.includes(e.category);
  return {
    title: e.category, isBS,
    sub: e.note ? `${e.note} · ${accountName(e.accountId)}` : accountName(e.accountId),
    sign: e.type === "in" ? "+" : "−", color: e.type === "in" ? C.green : C.red,
  };
}

function TransactionsScreen({ book, openSheet, openCodeTx, selectMode, setSelectMode }) {
  const [seg, setSeg] = useState("explained");
  const [q, setQ] = useState("");
  const [acctFilter, setAcctFilter] = useState("all");
  const [dirFilter, setDirFilter] = useState("all"); // all | out | in
  const [catFilter, setCatFilter] = useState("all");
  const [selected, setSelected] = useState(() => new Set());
  const accountName = (id) => (book.accounts.find((a) => a.id === id) || {}).name || "—";

  const codable = book.entries.filter((e) => e.type === "in" || e.type === "out");
  const explained = book.entries
    .filter((e) => (e.type === "in" || e.type === "out" || e.type === "transfer" || e.type === "party") && isExplained(e))
    .sort((a, b) => b.date.localeCompare(a.date));
  const unexplained = codable.filter((e) => !isExplained(e)).sort((a, b) => b.date.localeCompare(a.date));
  const usedCategories = [...new Set(codable.filter(isExplained).map((e) => e.category))].sort();

  const filterAcct = (list) => (acctFilter === "all" ? list : list.filter((e) => e.accountId === acctFilter || e.fromAccountId === acctFilter || e.toAccountId === acctFilter));
  const filterDir = (list) => (dirFilter === "all" ? list : list.filter((e) => e.type === dirFilter || (e.type === "party" && e.dir === dirFilter)));
  const filterCat = (list) => (catFilter === "all" ? list : list.filter((e) => e.category === catFilter));
  const search = (list) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((e) => {
      const hay = [e.merchant, e.category, e.note, e.date, String(e.amount)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(needle);
    });
  };
  const explainedRows = search(filterCat(filterDir(filterAcct(explained))));
  const unexplainedRows = search(filterDir(filterAcct(unexplained)));

  useEffect(() => { setSelectMode(false); setSelected(new Set()); }, [seg]);

  const toggleSelected = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedEntries = unexplainedRows.filter((e) => selected.has(e.id));
  const mixedTypes = new Set(selectedEntries.map((e) => e.type)).size > 1;

  // Select all always resolves to ONE direction, so the result is always
  // codeable in one action without hitting the mixed-direction guard: it
  // respects the direction filter when one is set, otherwise it follows
  // whichever direction the most recent unexplained row is.
  const selectAllType = dirFilter !== "all" ? dirFilter : (unexplainedRows[0] ? unexplainedRows[0].type : "out");
  const selectAllRows = unexplainedRows.filter((e) => e.type === selectAllType);
  const allSelectAllSelected = selectAllRows.length > 0 && selectAllRows.every((e) => selected.has(e.id));
  const toggleSelectAll = () => setSelected(allSelectAllSelected ? new Set() : new Set(selectAllRows.map((e) => e.id)));

  const openBulkCode = () => {
    if (selected.size === 0 || mixedTypes) return;
    openSheet("bulkCode", { entryIds: [...selected], onApplied: () => { setSelected(new Set()); setSelectMode(false); } });
  };

  return (
    <div style={{ padding: "4px 16px 90px" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <input style={{ ...st.input, flex: 1 }} placeholder="Search by name, category, note, date, or amount" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button onClick={() => setQ("")} style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, background: "none", border: "none", cursor: "pointer", flexShrink: 0, fontFamily: F.sans }}>Clear</button>}
      </div>
      <Seg value={seg} onChange={setSeg} style={{ marginBottom: 10 }} options={[
        { v: "explained", label: "Explained" },
        { v: "unexplained", label: "Unexplained", badge: unexplained.length || undefined },
      ]} />
      <div style={{ display: "flex", gap: 8, marginBottom: 14, overflowX: "auto" }}>
        <FilterChip active={acctFilter === "all"} onClick={() => setAcctFilter("all")}>All accounts</FilterChip>
        {book.accounts.map((a) => <FilterChip key={a.id} active={acctFilter === a.id} onClick={() => setAcctFilter(a.id)}>{a.name}</FilterChip>)}
        <FilterChip active={dirFilter === "all"} onClick={() => setDirFilter("all")}>All types</FilterChip>
        <FilterChip active={dirFilter === "out"} onClick={() => setDirFilter("out")}>Money Out</FilterChip>
        <FilterChip active={dirFilter === "in"} onClick={() => setDirFilter("in")}>Money In</FilterChip>
        {usedCategories.length > 0 && (
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ fontSize: 10.5, fontWeight: 700, padding: "0 12px", borderRadius: 999, border: `1px solid ${catFilter !== "all" ? "transparent" : C.overlayBorder}`, color: catFilter !== "all" ? "#fff" : C.muted, background: catFilter !== "all" ? C.grad : "none", cursor: "pointer", fontFamily: F.sans, flexShrink: 0 }}>
            <option value="all">All categories</option>
            {usedCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {seg === "explained" ? (
        <Card style={{ padding: "2px 16px" }}>
          {explainedRows.length === 0 && <div style={{ padding: "14px 0", fontSize: 12.5, color: C.muted }}>No transactions yet.</div>}
          {explainedRows.map((e, i) => {
            const info = explainedRowInfo(book, e);
            return (
              <RowLine key={e.id} last={i === explainedRows.length - 1} onClick={() => openSheet("viewTx", { entryId: e.id })}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {info.title}{info.isBS && <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: "rgba(251,191,36,.18)", border: "1px solid rgba(251,191,36,.4)", color: C.amberText, marginLeft: 6 }}>BS</span>}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{info.sub}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: info.color, fontVariantNumeric: "tabular-nums" }}>{info.sign || ""}{inr(e.amount)}</div>
                  <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 600, marginTop: 1 }}>{e.date}</div>
                </div>
              </RowLine>
            );
          })}
        </Card>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 2px", gap: 8 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, flex: 1 }}>
              {selectMode ? "Tap to select, then code them all at once." : "From your imported statements — tap one to confirm or change its category."}
            </div>
            {unexplainedRows.length > 0 && (
              selectMode ? (
                <button onClick={() => { setSelectMode(false); setSelected(new Set()); }} style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, background: "none", border: "none", cursor: "pointer", flexShrink: 0, fontFamily: F.sans }}>Cancel</button>
              ) : (
                <button onClick={() => setSelectMode(true)} style={{ fontSize: 10.5, fontWeight: 700, color: C.accentText, background: "none", border: "none", cursor: "pointer", flexShrink: 0, fontFamily: F.sans }}>Select</button>
              )
            )}
          </div>
          {selectMode && unexplainedRows.length > 0 && (
            <button
              onClick={toggleSelectAll}
              style={{ fontSize: 10.5, fontWeight: 700, color: C.accentText, background: "none", border: "none", cursor: "pointer", padding: "0 2px 8px", display: "block", fontFamily: F.sans }}
            >
              {allSelectAllSelected ? "Deselect all" : `Select all — Money ${selectAllType === "out" ? "Out" : "In"}`}
            </button>
          )}
          <Card style={{ padding: "2px 16px" }}>
            {unexplainedRows.length === 0 && <div style={{ padding: "14px 0", fontSize: 12.5, color: C.muted }}>Nothing to code — you're all caught up.</div>}
            {unexplainedRows.map((e, i) => {
              const match = suggestHead(book, e.merchant || "");
              const checked = selected.has(e.id);
              return (
                <RowLine key={e.id} last={i === unexplainedRows.length - 1} onClick={() => (selectMode ? toggleSelected(e.id) : openCodeTx(e.id))}>
                  {selectMode && (
                    <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginRight: 10, display: "flex", alignItems: "center", justifyContent: "center", background: checked ? C.grad : "transparent", border: checked ? "none" : `1px solid ${C.overlayBorder}`, color: "#fff", fontSize: 11, fontWeight: 800 }}>
                      {checked ? "✓" : ""}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.amberText }}>{e.merchant || "Unrecognized transaction"}</div>
                    <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 1 }}>{match !== "Suspense" ? `Auto-matched: ${match}` : "Needs a category"} · {accountName(e.accountId)}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: e.type === "in" ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>{e.type === "in" ? "+" : "−"}{inr(e.amount)}</div>
                    <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 600, marginTop: 1 }}>{e.date}</div>
                  </div>
                </RowLine>
              );
            })}
          </Card>
        </>
      )}

      {selectMode && selected.size > 0 && (
        <div style={{ position: "fixed", left: 16, right: 16, bottom: 82, zIndex: 26, ...glass(16), padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{selected.size} selected</div>
            {mixedTypes && <div style={{ fontSize: 9.5, color: C.amberText, fontWeight: 600, marginTop: 1 }}>Debits and credits can't be coded together</div>}
          </div>
          <PrimaryBtn style={{ width: "auto", padding: "9px 18px", opacity: mixedTypes ? 0.5 : 1, cursor: mixedTypes ? "default" : "pointer" }} onClick={openBulkCode}>Code</PrimaryBtn>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════ REPORTS ══════════════════════════ */
function Variance({ cur, prev, show, goodWhenUp = true }) {
  if (!show) return null;
  const v = periodVariance(cur, prev);
  const good = v.dir === "flat" ? null : v.dir === "up" ? goodWhenUp : !goodWhenUp;
  const color = v.dir === "flat" ? C.muted : good ? C.green : C.red;
  const arrow = v.dir === "flat" ? "•" : v.dir === "up" ? "▲" : "▼";
  return <div style={{ fontSize: 10, fontWeight: 700, marginTop: 2, color }}>{arrow} {v.dir === "flat" ? "flat" : `${v.pct}%`} vs last period</div>;
}

function usePeriodPicker(book) {
  const t = today();
  const fys = useMemo(() => {
    const s = new Set([fyOf(t)]);
    for (const e of book.entries) s.add(fyOf(e.date));
    return [...s].sort((a, b) => b - a);
  }, [book.entries, t]);
  // Defaulting to "this month of the current FY" silently shows nothing for
  // a book whose data is all in the past (e.g. everything just imported
  // from an old statement) -- default to wherever the most recent entry
  // actually is instead, only falling back to "this month" when that
  // happens to be the real current month.
  const latestEntryDate = useMemo(() => {
    let max = null;
    for (const e of book.entries) if (!max || e.date > max) max = e.date;
    return max || t;
  }, [book.entries, t]);
  const [fy, setFy] = useState(fyOf(latestEntryDate));
  const [span, setSpan] = useState(latestEntryDate.slice(0, 7) === t.slice(0, 7) ? "thisMonth" : "year");
  const [customFrom, setCustomFrom] = useState(t.slice(0, 8) + "01");
  const [customTo, setCustomTo] = useState(t);
  const [cmp, setCmp] = useState("off");
  const [from, to] = periodRange(span, fy, customFrom, customTo);
  const [pFrom, pTo] = cmp === "off" ? [null, null] : comparePeriod(from, to, cmp);
  return { fys, fy, setFy, span, setSpan, customFrom, setCustomFrom, customTo, setCustomTo, cmp, setCmp, from, to, pFrom, pTo };
}

function PeriodPicker(p) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <select style={{ ...st.input, flex: "0 0 40%" }} value={p.fy} onChange={(e) => p.setFy(+e.target.value)}>
          {p.fys.map((y) => <option key={y} value={y}>FY {y}–{String(y + 1).slice(2)}</option>)}
        </select>
        <select style={{ ...st.input, flex: 1 }} value={p.span} onChange={(e) => p.setSpan(e.target.value)}>
          <option value="thisMonth">This Month</option>
          <option value="lastMonth">Last Month</option>
          <option value="year">Full Year</option>
          <option value="custom">Custom range…</option>
        </select>
      </div>
      {p.span === "custom" && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input style={st.input} type="date" value={p.customFrom} onChange={(e) => p.setCustomFrom(e.target.value)} />
          <input style={st.input} type="date" value={p.customTo} onChange={(e) => p.setCustomTo(e.target.value)} />
        </div>
      )}
      <Seg value={p.cmp} onChange={p.setCmp} style={{ marginTop: 8 }} options={[{ v: "off", label: "No compare" }, { v: "prev", label: "vs previous" }, { v: "lastyear", label: "vs last year" }]} />
      {p.cmp !== "off" && <div style={{ fontSize: 10.5, color: C.faint, fontWeight: 600, marginTop: 6 }}>Comparing {p.from} → {p.to} with {p.pFrom} → {p.pTo}</div>}
    </div>
  );
}

function PLReport({ book, p }) {
  const pl = computePL(book, p.from, p.to);
  const plPrev = p.cmp === "off" ? null : computePL(book, p.pFrom, p.pTo);
  const cmpOn = p.cmp !== "off";
  const income = Object.entries(pl.income);
  const expense = Object.entries(pl.expense).sort((a, b) => b[1] - a[1]);
  const maxExp = expense.length ? expense[0][1] : 0;

  const downloadCsv = () => {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [["Section", "Category", "Amount"].map(esc).join(",")];
    for (const [c, a] of income) lines.push(["Income", c, a].map(esc).join(","));
    for (const [c, a] of expense) lines.push(["Expense", c, a].map(esc).join(","));
    lines.push(["Total", "Income", pl.totalIncome].map(esc).join(","));
    lines.push(["Total", "Expenses", pl.totalExpense].map(esc).join(","));
    lines.push(["Total", "Net", pl.net].map(esc).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `simple-cashbook-pl-${p.from}-to-${p.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <PeriodPicker {...p} />
      <Card style={{ margin: "14px 0", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: C.stripeGrad }} />
        <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>Net This Period</div>
        <div style={{ fontSize: 24, fontWeight: 800, margin: "6px 0 2px", fontVariantNumeric: "tabular-nums" }}>{inr(pl.net)}</div>
        <Variance cur={pl.net} prev={plPrev ? plPrev.net : 0} show={cmpOn} goodWhenUp />
        <div style={{ fontSize: 10, color: C.faint, fontWeight: 600, marginTop: 10 }}>Cash basis · Balance Sheet categories are excluded here — see Cash Flow below</div>
      </Card>

      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6, padding: "0 2px" }}>Income</div>
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        {income.length === 0 && <div style={{ padding: "10px 0", fontSize: 12.5, color: C.muted }}>Nothing in this period.</div>}
        {income.map(([c, a]) => (
          <div key={c} style={{ padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 13, fontWeight: 700 }}>{c}</span><span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{inr(a)}</span></div>
            <Variance cur={a} prev={plPrev ? (plPrev.income[c] || 0) : 0} show={cmpOn} goodWhenUp />
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 2, paddingTop: 9 }}>
          <div style={{ display: "flex", fontSize: 14, fontWeight: 800 }}><span style={{ flex: 1 }}>Total income</span><span style={{ color: C.green }}>{inr(pl.totalIncome)}</span></div>
          <Variance cur={pl.totalIncome} prev={plPrev ? plPrev.totalIncome : 0} show={cmpOn} goodWhenUp />
        </div>
      </Card>

      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6, padding: "0 2px" }}>Expenses</div>
      <Card style={{ padding: "2px 16px 6px", marginBottom: 14 }}>
        {expense.length === 0 && <div style={{ padding: "10px 0", fontSize: 12.5, color: C.muted }}>Nothing in this period.</div>}
        {expense.map(([c, a]) => (
          <div key={c} style={{ padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span style={{ fontSize: 13, fontWeight: 700 }}>{c}</span><span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{inr(a)}</span></div>
            <div style={{ height: 6, borderRadius: 3, background: C.overlayWash, overflow: "hidden" }}><div style={{ height: "100%", width: `${maxExp ? Math.max(2, Math.round((a / maxExp) * 100)) : 0}%`, borderRadius: 3, background: C.accent }} /></div>
            <Variance cur={a} prev={plPrev ? (plPrev.expense[c] || 0) : 0} show={cmpOn} goodWhenUp={false} />
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 2, paddingTop: 9 }}>
          <div style={{ display: "flex", fontSize: 14, fontWeight: 800 }}><span style={{ flex: 1 }}>Total expenses</span><span style={{ color: C.red }}>{inr(pl.totalExpense)}</span></div>
          <Variance cur={pl.totalExpense} prev={plPrev ? plPrev.totalExpense : 0} show={cmpOn} goodWhenUp={false} />
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8 }}>
        <GhostBtn style={{ flex: 1 }} onClick={downloadCsv}><Ic name="download" size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Export CSV</GhostBtn>
        <GhostBtn style={{ flex: 1 }} onClick={() => window.print()}>⎙ Print / PDF</GhostBtn>
      </div>
    </div>
  );
}

function CashFlowReport({ book, p }) {
  const cf = computeCashFlow(book, p.from, p.to);
  const cfPrev = p.cmp === "off" ? null : computeCashFlow(book, p.pFrom, p.pTo);
  const cmpOn = p.cmp !== "off";
  const prevRowAmt = (label) => {
    if (!cfPrev) return 0;
    const r = cfPrev.bs.rows.find((x) => x.label === label);
    return r ? r.amount : 0;
  };

  const downloadCsv = () => {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [["Section", "Line", "Amount"].map(esc).join(",")];
    lines.push(["P&L", "Income", cf.pl.income].map(esc).join(","));
    lines.push(["P&L", "Expenses", -cf.pl.expense].map(esc).join(","));
    lines.push(["P&L", "Net from P&L Activities", cf.pl.net].map(esc).join(","));
    for (const r of cf.bs.rows) lines.push(["Balance Sheet", r.label, r.amount].map(esc).join(","));
    lines.push(["Balance Sheet", "Net from Balance Sheet Items", cf.bs.net].map(esc).join(","));
    lines.push(["Total", "Net Cash Movement", cf.net].map(esc).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `simple-cashbook-cashflow-${p.from}-to-${p.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <PeriodPicker {...p} />
      <Card style={{ margin: "14px 0", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: C.stripeGrad }} />
        <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>Net Cash Movement</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: cf.net >= 0 ? C.green : C.red, margin: "6px 0 2px", fontVariantNumeric: "tabular-nums" }}>{cf.net >= 0 ? "+" : "−"}{inr(Math.abs(cf.net))}</div>
        <Variance cur={cf.net} prev={cfPrev ? cfPrev.net : 0} show={cmpOn} goodWhenUp />
        <div style={{ fontSize: 10, color: C.faint, fontWeight: 600, marginTop: 10 }}>Every rupee that actually moved through your accounts — bifurcated below into P&amp;L versus Balance Sheet activity. Excludes transfers between your own accounts.</div>
      </Card>

      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6, padding: "0 2px" }}>From P&amp;L Activities</div>
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        <div style={{ padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 13, fontWeight: 700 }}>Income</span><span style={{ fontWeight: 700, color: C.green, fontVariantNumeric: "tabular-nums" }}>+{inr(cf.pl.income)}</span></div>
          <Variance cur={cf.pl.income} prev={cfPrev ? cfPrev.pl.income : 0} show={cmpOn} goodWhenUp />
        </div>
        <div style={{ padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 13, fontWeight: 700 }}>Expenses</span><span style={{ fontWeight: 700, color: C.red, fontVariantNumeric: "tabular-nums" }}>−{inr(cf.pl.expense)}</span></div>
          <Variance cur={cf.pl.expense} prev={cfPrev ? cfPrev.pl.expense : 0} show={cmpOn} goodWhenUp={false} />
        </div>
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 2, paddingTop: 9 }}>
          <div style={{ display: "flex", fontSize: 14, fontWeight: 800 }}><span style={{ flex: 1 }}>Net from P&amp;L Activities</span><span>{cf.pl.net >= 0 ? "+" : "−"}{inr(Math.abs(cf.pl.net))}</span></div>
          <Variance cur={cf.pl.net} prev={cfPrev ? cfPrev.pl.net : 0} show={cmpOn} goodWhenUp />
        </div>
      </Card>

      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6, padding: "0 2px" }}>From Balance Sheet Items</div>
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        {cf.bs.rows.length === 0 && <div style={{ padding: "10px 0", fontSize: 12.5, color: C.muted }}>Nothing in this period.</div>}
        {cf.bs.rows.map((r, i) => (
          <div key={r.label} style={{ padding: "11px 0", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{r.label}{r.bs && <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: "rgba(251,191,36,.18)", border: "1px solid rgba(251,191,36,.4)", color: C.amberText, marginLeft: 6 }}>BS</span>}</span>
              <span style={{ fontWeight: 700, color: r.amount >= 0 ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>{r.amount >= 0 ? "+" : "−"}{inr(Math.abs(r.amount))}</span>
            </div>
            <Variance cur={r.amount} prev={prevRowAmt(r.label)} show={cmpOn} goodWhenUp />
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 2, paddingTop: 9 }}>
          <div style={{ display: "flex", fontSize: 14, fontWeight: 800 }}><span style={{ flex: 1 }}>Net from Balance Sheet Items</span><span>{cf.bs.net >= 0 ? "+" : "−"}{inr(Math.abs(cf.bs.net))}</span></div>
          <Variance cur={cf.bs.net} prev={cfPrev ? cfPrev.bs.net : 0} show={cmpOn} goodWhenUp />
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8 }}>
        <GhostBtn style={{ flex: 1 }} onClick={downloadCsv}><Ic name="download" size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Export CSV</GhostBtn>
        <GhostBtn style={{ flex: 1 }} onClick={() => window.print()}>⎙ Print / PDF</GhostBtn>
      </div>
    </div>
  );
}

function ReportsScreen({ book }) {
  const [view, setView] = useState("pl");
  const p = usePeriodPicker(book);
  return (
    <div style={{ padding: "4px 16px 90px" }}>
      <Seg value={view} onChange={setView} style={{ marginBottom: 14 }} options={[{ v: "pl", label: "Profit & Loss" }, { v: "cashflow", label: "Cash Flow" }]} />
      {view === "pl" ? <PLReport book={book} p={p} /> : <CashFlowReport book={book} p={p} />}
    </div>
  );
}

/* ══════════════════════════ SETUP ══════════════════════════ */
function SetupRow({ title, sub, onClick, last }) {
  return (
    <RowLine onClick={onClick} last={last}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 1 }}>{sub}</div>
      </div>
      <div style={{ color: C.muted, fontSize: 15 }}>›</div>
    </RowLine>
  );
}
function DashedBtn({ children, onClick }) {
  return <button onClick={onClick} style={{ width: "100%", padding: "11px 0", borderRadius: 13, border: `1.5px dashed ${C.accent}`, color: C.accentText, fontWeight: 700, fontSize: 12, fontFamily: F.sans, background: "none", cursor: "pointer" }}>{children}</button>;
}
function AddInline({ placeholder, onAdd }) {
  const [v, setV] = useState("");
  const submit = () => { if (v.trim()) { onAdd(v.trim()); setV(""); } };
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <input style={{ ...st.input, flex: 1 }} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <PrimaryBtn style={{ width: "auto", padding: "0 16px" }} onClick={submit}>Add</PrimaryBtn>
    </div>
  );
}

function SetupScreen({ book, openSheet, openAccountsPage }) {
  return (
    <div style={{ padding: "4px 16px 90px" }}>
      <Card style={{ padding: "2px 16px" }}>
        <SetupRow title="Accounts" sub={`${book.accounts.length} account${book.accounts.length === 1 ? "" : "s"}`} onClick={openAccountsPage} />
        <SetupRow title="Categories" sub={`${book.categories.expense.filter((c) => c !== "Suspense").length} categories`} onClick={() => openSheet("setupCategories")} />
        <SetupRow title="Balance Sheet Categories" sub={`${book.bsCategories.length} categor${book.bsCategories.length === 1 ? "y" : "ies"}`} onClick={() => openSheet("setupBsCategories")} />
        <SetupRow title="Auto-coding Rules" sub={`${book.codingRules.length} rules`} onClick={() => openSheet("setupRules")} />
        <SetupRow title="Import & OCR" sub="Upload PDFs or photos" onClick={() => openSheet("import")} />
        <SetupRow title="Security & App Lock" sub={book.prefs.lock.on ? "PIN lock is on" : "PIN lock is off"} onClick={() => openSheet("setupPrefs")} />
        <SetupRow title="Appearance" sub={{ system: "Match system", dark: "Dark", light: "Light" }[book.prefs.theme || "system"]} onClick={() => openSheet("setupPrefs")} />
        <SetupRow title="Backup & Restore" sub="Export or import your data" onClick={() => openSheet("setupPrefs")} last />
      </Card>
    </div>
  );
}

// Deleting a category only removes it from future pick-lists -- entries
// already coded to it keep working (computePL/computeCashFlow read the
// category string straight off each entry, not off this list) -- but a
// user deleting a category still actively in use almost certainly doesn't
// realize that, so confirm and name the count before it's gone from Setup.
function categoryUseCount(book, category) {
  return book.entries.filter((e) => e.category === category).length;
}
function confirmCategoryDelete(book, category, extra) {
  const n = categoryUseCount(book, category);
  if (n === 0) return true;
  return window.confirm(
    `"${category}" is used by ${n} transaction${n === 1 ? "" : "s"}. ${extra || ""}They'll keep their category, but you won't be able to pick "${category}" for new or re-coded transactions anymore. Remove it anyway?`
  );
}

function SetupCategoriesSheet({ book, up, close }) {
  const cats = book.categories.expense.filter((c) => c !== "Suspense");
  return (
    <Sheet open title="Categories" onClose={close}>
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 10 }}>Your everyday expense categories — these count toward P&amp;L.</div>
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        {cats.map((c, i) => (
          <RowLine key={c} last={i === cats.length - 1}>
            <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{c}</div>
            <RoundBtn onClick={() => {
              if (!confirmCategoryDelete(book, c)) return;
              up((b) => { b.categories.expense = b.categories.expense.filter((x) => x !== c); return b; });
            }}><Ic name="close" size={12} /></RoundBtn>
          </RowLine>
        ))}
        {cats.length === 0 && <div style={{ padding: "12px 0", fontSize: 12.5, color: C.muted }}>No categories yet.</div>}
      </Card>
      <AddInline placeholder="New category name" onAdd={(name) => up((b) => { if (!b.categories.expense.includes(name)) b.categories.expense.splice(b.categories.expense.length - 1, 0, name); return b; })} />
    </Sheet>
  );
}

function SetupBsCategoriesSheet({ book, up, close }) {
  return (
    <Sheet open title="Balance Sheet Categories" onClose={close}>
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 10 }}>A separate list, on purpose — these are real cash movements (EMI principal, lending, etc.) that always show in Cash Flow but never count as P&amp;L income or expense.</div>
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        {book.bsCategories.map((c, i) => (
          <RowLine key={c} last={i === book.bsCategories.length - 1}>
            <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{c}</div>
            <RoundBtn onClick={() => {
              if (!confirmCategoryDelete(book, c, "It'll also disappear from Cash Flow's Balance Sheet section for new activity. ")) return;
              up((b) => { b.bsCategories = b.bsCategories.filter((x) => x !== c); return b; });
            }}><Ic name="close" size={12} /></RoundBtn>
          </RowLine>
        ))}
        {book.bsCategories.length === 0 && <div style={{ padding: "12px 0", fontSize: 12.5, color: C.muted }}>No Balance Sheet categories yet.</div>}
      </Card>
      <AddInline placeholder="e.g. Car Loan EMI" onAdd={(name) => up((b) => { if (!b.bsCategories.includes(name)) b.bsCategories.push(name); return b; })} />
    </Sheet>
  );
}

function SetupRulesSheet({ book, up, close }) {
  return (
    <Sheet open title="Auto-coding Rules" onClose={close}>
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 10 }}>New imports matching these get pre-filled automatically — e.g. any "Zepto" transaction suggests Groceries.</div>
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        {book.codingRules.map((r, i) => (
          <RowLine key={r.match + i} last={i === book.codingRules.length - 1}>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 700, textTransform: "capitalize" }}>{r.match}</div>
            <div style={{ color: C.accentText, fontSize: 12.5, fontWeight: 700, marginRight: 8 }}>→ {r.head}</div>
            <RoundBtn onClick={() => up((b) => { b.codingRules = b.codingRules.filter((x) => x !== r); return b; })}><Ic name="close" size={12} /></RoundBtn>
          </RowLine>
        ))}
      </Card>
      <RuleAdd book={book} up={up} />
    </Sheet>
  );
}
function RuleAdd({ book, up }) {
  const [match, setMatch] = useState("");
  const [head, setHead] = useState(book.categories.expense[0] || "");
  const allCats = [...book.categories.expense.filter((c) => c !== "Suspense"), ...book.categories.income];
  return (
    <div>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...st.input, flex: 1 }} placeholder="Merchant keyword" value={match} onChange={(e) => setMatch(e.target.value)} />
        <select style={{ ...st.input, flex: "0 0 40%" }} value={head} onChange={(e) => setHead(e.target.value)}>
          {allCats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <PrimaryBtn style={{ marginTop: 8 }} onClick={() => { if (match.trim()) { up((b) => { b.codingRules.push({ match: match.trim(), head }); return b; }); setMatch(""); } }}>Add Rule</PrimaryBtn>
    </div>
  );
}

function SetupPrefsSheet({ book, up, close }) {
  const [pin, setPin] = useState(book.prefs.lock.pin || "");
  return (
    <Sheet open title="Preferences" onClose={close}>
      <Card style={{ padding: "16px 18px", marginBottom: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Appearance</div>
        <Seg value={book.prefs.theme || "system"} onChange={(v) => up((b) => { b.prefs.theme = v; return b; })} options={[
          { v: "system", label: "System" },
          { v: "dark", label: "Dark" },
          { v: "light", label: "Light" },
        ]} />
      </Card>
      <Card style={{ padding: "16px 18px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Security &amp; App Lock</div>
          <Toggle value={book.prefs.lock.on} onChange={(on) => up((b) => { b.prefs.lock.on = on; return b; })} />
        </div>
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginTop: 6 }}>4-digit PIN required to open the app.</div>
        {book.prefs.lock.on && (
          <input style={{ ...st.input, marginTop: 10 }} placeholder="4-digit PIN" maxLength={4} inputMode="numeric" value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onBlur={() => up((b) => { b.prefs.lock.pin = pin; return b; })} />
        )}
      </Card>
      <Card style={{ padding: "16px 18px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>Backup &amp; Restore</div>
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginTop: 4 }}>Export your data as a JSON file you can restore from later.</div>
        <GhostBtn style={{ width: "100%", marginTop: 10 }} onClick={() => {
          const blob = new Blob([JSON.stringify(book, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `cashbook-simple-backup-${today()}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        }}>Back Up Now</GhostBtn>
      </Card>
    </Sheet>
  );
}

function SetupAccountsPage({ book, up, open, onBack }) {
  return (
    <PageOverlay open={open} onBack={onBack} title="Accounts">
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 12 }}>Rename an account, change its kind, or set its opening balance. Everything you add here shows up on Home and in Transactions.</div>
      {book.accounts.map((a) => (
        <Card key={a.id} style={{ padding: "14px 16px", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input style={{ ...st.input, flex: 1, fontWeight: 700 }} value={a.name}
              onChange={(e) => up((b) => { b.accounts.find((x) => x.id === a.id).name = e.target.value; return b; })} />
            <RoundBtn onClick={() => {
              const n = book.entries.filter((e) => e.accountId === a.id || e.fromAccountId === a.id || e.toAccountId === a.id).length;
              if (n > 0 && !window.confirm(`Delete "${a.name}"? This also permanently deletes its ${n} transaction${n === 1 ? "" : "s"} — this can't be undone.`)) return;
              up((b) => { b.accounts = b.accounts.filter((x) => x.id !== a.id); b.entries = b.entries.filter((e) => e.accountId !== a.id && e.fromAccountId !== a.id && e.toAccountId !== a.id); return b; });
            }}><Ic name="close" size={13} /></RoundBtn>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...st.label, margin: "0 0 4px" }}>Kind</div>
              <select style={st.input} value={a.kind} onChange={(e) => up((b) => { b.accounts.find((x) => x.id === a.id).kind = e.target.value; return b; })}>
                <option value="bank">Bank</option>
                <option value="card">Credit Card</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ ...st.label, margin: "0 0 4px" }}>Opening Balance</div>
              <input style={st.input} defaultValue={a.opening || 0} inputMode="decimal"
                onBlur={(e) => up((b) => { b.accounts.find((x) => x.id === a.id).opening = parseAmount(e.target.value) || 0; return b; })} />
            </div>
          </div>
          {a.kind === "card" && (
            <div style={{ marginTop: 8 }}>
              <div style={{ ...st.label, margin: "0 0 4px" }}>Due Day of Month (optional)</div>
              <input style={st.input} type="number" min={1} max={31} defaultValue={a.dueDay || ""}
                onBlur={(e) => up((b) => { b.accounts.find((x) => x.id === a.id).dueDay = e.target.value ? +e.target.value : undefined; return b; })} />
            </div>
          )}
        </Card>
      ))}
      <DashedBtn onClick={() => up((b) => { b.accounts.push({ id: uid(), name: "New Account", kind: "bank", opening: 0 }); return b; })}>+ Add Account</DashedBtn>
    </PageOverlay>
  );
}

/* ══════════════════════════ transaction field groups (shared) ══════════════════════════
   Used identically by New Transaction and Code Transaction -- "mode" only
   controls whether an Account picker is shown (New Transaction always
   needs one; Code Transaction already knows the account from the imported
   row). Gap filled versus the mockup: the mockup's Party and Split field
   groups had no Account picker at all, but this app's symmetric N-account
   model means every entry needs one -- added here for both, New-mode only. */
function TypeFields({ book, up, mode, direction, subKind, f, setF, totalAmount }) {
  const set = (k, v) => setF((old) => ({ ...old, [k]: v }));
  const expCats = book.categories.expense.filter((c) => c !== "Suspense");

  if (subKind === "category") {
    return (
      <div>
        {mode === "new" && <><div style={st.label}>Account</div><AccountSelect book={book} value={f.accountId} onChange={(v) => set("accountId", v)} /></>}
        <div style={st.label}>Category</div>
        <CategorySelect book={book} value={f.category} onChange={(v) => set("category", v)} direction={direction} />
      </div>
    );
  }
  if (subKind === "party") {
    return (
      <div>
        {mode === "new" && <><div style={st.label}>Account</div><AccountSelect book={book} value={f.accountId} onChange={(v) => set("accountId", v)} /></>}
        <div style={st.label}>Party</div>
        <PartySelect book={book} up={up} value={f.partyId} onChange={(v) => set("partyId", v)} />
      </div>
    );
  }
  if (subKind === "transfer") {
    if (mode === "code") {
      return <div><div style={st.label}>To/From Account</div><AccountSelect book={book} value={f.toAccountId} onChange={(v) => set("toAccountId", v)} /></div>;
    }
    return (
      <div>
        <div style={st.label}>From Account</div>
        <AccountSelect book={book} value={f.fromAccountId} onChange={(v) => set("fromAccountId", v)} />
        <div style={st.label}>To Account</div>
        <AccountSelect book={book} value={f.toAccountId} onChange={(v) => set("toAccountId", v)} />
      </div>
    );
  }
  if (subKind === "refund") {
    return (
      <div>
        {mode === "new" && <><div style={st.label}>Account</div><AccountSelect book={book} value={f.accountId} onChange={(v) => set("accountId", v)} /></>}
        <div style={st.label}>Refund For</div>
        <select style={st.input} value={f.refundFor} onChange={(e) => set("refundFor", e.target.value)}>
          {expCats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div style={{ fontSize: 10, color: C.accentText, fontWeight: 600, marginTop: 6 }}>Refunds reduce that category's spend this month instead of counting as new income.</div>
      </div>
    );
  }
  if (subKind === "split") {
    const p1 = parseAmount(f.splitAmt1) || 0;
    const remainder = Math.max(0, totalAmount - p1);
    return (
      <div>
        <div style={{ border: C.borderSoft, borderRadius: 13, padding: "10px 12px 12px", marginTop: 10, background: C.overlayWash }}>
          <div style={{ fontSize: 11.5, fontWeight: 800 }}>Portion 1 — Your Expense</div>
          <div style={st.label}>Amount</div>
          <input style={st.input} placeholder="e.g. 3000" value={f.splitAmt1} onChange={(e) => set("splitAmt1", e.target.value)} />
          {mode === "new" && <><div style={st.label}>Account</div><AccountSelect book={book} value={f.splitAccountId} onChange={(v) => set("splitAccountId", v)} /></>}
          <div style={st.label}>Category</div>
          <select style={st.input} value={f.splitCat1} onChange={(e) => set("splitCat1", e.target.value)}>
            {expCats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ border: C.borderSoft, borderRadius: 13, padding: "10px 12px 12px", marginTop: 10, background: C.overlayWash }}>
          <div style={{ fontSize: 11.5, fontWeight: 800 }}>Portion 2 — Balance Sheet or Receivable</div>
          <Seg value={f.splitKind2} onChange={(v) => set("splitKind2", v)} style={{ marginTop: 8 }} options={[{ v: "bs", label: "Balance Sheet" }, { v: "party", label: "Party (Receivable)" }]} />
          {f.splitKind2 === "bs" ? (
            <>
              <div style={st.label}>Category</div>
              <select style={st.input} value={f.splitBsCat2} onChange={(e) => set("splitBsCat2", e.target.value)}>
                {book.bsCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </>
          ) : (
            <><div style={st.label}>Party</div><PartySelect book={book} up={up} value={f.splitPartyId2} onChange={(v) => set("splitPartyId2", v)} /></>
          )}
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginTop: 6 }}>Portion 2 amount: <span style={{ color: C.ink, fontWeight: 800 }}>{inr(remainder)}</span> (auto = total − portion 1)</div>
        </div>
      </div>
    );
  }
  return null;
}

function subkindsFor(direction) {
  return direction === "out"
    ? [["category", "Expense"], ["party", "Party to Pay"], ["transfer", "Transfer"], ["split", "Split"]]
    : [["category", "Income"], ["refund", "Refund"], ["party", "Party to Receive"], ["transfer", "Transfer"]];
}

function initialFields(book) {
  const acc = (book.accounts[0] || {}).id || "";
  const acc2 = (book.accounts[1] || book.accounts[0] || {}).id || "";
  return {
    accountId: acc, category: book.categories.expense.find((c) => c !== "Suspense") || "",
    partyId: book.parties[0] ? book.parties[0].id : "",
    fromAccountId: acc, toAccountId: acc2,
    refundFor: book.categories.expense.find((c) => c !== "Suspense") || "",
    splitAmt1: "", splitAccountId: acc, splitCat1: book.categories.expense.find((c) => c !== "Suspense") || "",
    splitKind2: "bs", splitBsCat2: book.bsCategories[0] || "", splitPartyId2: book.parties[0] ? book.parties[0].id : "",
  };
}

/* ══════════════════════════ NEW TRANSACTION ══════════════════════════ */
function NewTransactionSheet({ book, up, close, preset }) {
  const [amount, setAmount] = useState("");
  const [dir, setDir] = useState((preset && preset.presetDir) || "out");
  const [subKind, setSubKind] = useState((preset && preset.presetSub) || "category");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());
  const [f, setF] = useState(() => initialFields(book));
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setSubKind("category");
    setF((old) => ({ ...old, category: dir === "in" ? (book.categories.income[0] || "") : (book.categories.expense.find((c) => c !== "Suspense") || "") }));
  }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const amt = parseAmount(amount);
    if (!amt || amt <= 0) return;
    const tripId = preset && preset.presetTripId;
    up((b) => {
      const keepId = uid();
      if (subKind === "category") {
        b.entries.push({ id: keepId, date, amount: amt, type: dir, category: f.category, accountId: f.accountId, note, ...(tripId ? { tripId } : {}) });
      } else if (subKind === "refund") {
        b.entries.push({ id: keepId, date, amount: amt, type: "in", category: f.refundFor, accountId: f.accountId, note });
      } else if (subKind === "party") {
        b.entries.push({ id: keepId, date, amount: amt, type: "party", partyId: f.partyId, accountId: f.accountId, dir, note, ...(tripId ? { tripId } : {}) });
      } else if (subKind === "transfer") {
        b.entries.push({ id: keepId, date, amount: amt, type: "transfer", fromAccountId: f.fromAccountId, toAccountId: f.toAccountId, note });
      } else if (subKind === "split") {
        const p1 = parseAmount(f.splitAmt1) || 0;
        const p2 = Math.max(0, amt - p1);
        b.entries.push({ id: keepId, date, amount: p1, type: "out", category: f.splitCat1, accountId: f.splitAccountId, note, ...(tripId ? { tripId } : {}) });
        if (f.splitKind2 === "bs") b.entries.push({ id: uid(), date, amount: p2, type: "out", category: f.splitBsCat2, accountId: f.splitAccountId, note });
        else b.entries.push({ id: uid(), date, amount: p2, type: "party", partyId: f.splitPartyId2, accountId: f.splitAccountId, dir: "out", note, ...(tripId ? { tripId } : {}) });
      }
      return b;
    });
    close();
  };

  if (book.accounts.length === 0) {
    return <Sheet open title="New Transaction" onClose={close}><div style={{ fontSize: 13, color: C.muted }}>Add an account first, in Setup ▸ Accounts.</div></Sheet>;
  }

  return (
    <Sheet open title="New Transaction" onClose={close}>
      <div style={st.label}>Amount</div>
      <input style={{ ...st.input, fontSize: 15, fontWeight: 800 }} placeholder="Amount — 500, 2k, 1.2L" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div style={st.label}>Direction</div>
      <Seg value={dir} onChange={setDir} options={[{ v: "out", label: "Money Out" }, { v: "in", label: "Money In" }]} />
      <div style={st.label}>Type</div>
      <Seg value={subKind} onChange={setSubKind} wrap4 options={subkindsFor(dir).map(([v, label]) => ({ v, label }))} />
      <TypeFields book={book} up={up} mode="new" direction={dir} subKind={subKind} f={f} setF={setF} totalAmount={parseAmount(amount) || 0} />
      <div style={st.label}>Note (optional)</div>
      <input style={st.input} placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
      <div style={st.label}>Date</div>
      <input style={st.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <PrimaryBtn style={{ marginTop: 16 }} onClick={save}>Save Transaction</PrimaryBtn>
    </Sheet>
  );
}

// Explained transactions are locked once coded -- the only way to change
// their category/party/type again is to explicitly Unexplain first, which
// sends them back through the normal Code Transaction flow. Transfers and
// party entries have no Suspense state at all (isExplained is unconditionally
// true for them), so there's nothing to unexplain for those -- this is a
// pure detail view for them.
function ViewTransactionSheet({ book, up, close, entryId }) {
  const entry = book.entries.find((e) => e.id === entryId);
  if (!entry) return null;
  const accountName = (id) => (book.accounts.find((a) => a.id === id) || {}).name || "—";
  const partyName = (id) => (book.parties.find((p) => p.id === id) || {}).name || "Unknown";
  const canUnexplain = entry.type === "in" || entry.type === "out";
  const isBS = canUnexplain && book.bsCategories.includes(entry.category);
  const refund = canUnexplain && isRefund(book, entry);

  const rows = [["Amount", inr(entry.amount)]];
  if (entry.type === "transfer") {
    rows.push(["Type", "Transfer"]);
    rows.push(["From Account", accountName(entry.fromAccountId)]);
    rows.push(["To Account", accountName(entry.toAccountId)]);
  } else if (entry.type === "party") {
    rows.push(["Direction", entry.dir === "out" ? "Money Out" : "Money In"]);
    rows.push(["Type", entry.dir === "out" ? "Party to Pay" : "Party to Receive"]);
    rows.push(["Party", partyName(entry.partyId)]);
    rows.push(["Account", accountName(entry.accountId)]);
  } else {
    rows.push(["Direction", entry.type === "in" ? "Money In" : "Money Out"]);
    rows.push(["Type", refund ? "Refund" : entry.type === "in" ? "Income" : "Expense"]);
    rows.push(["Category", entry.category]);
    rows.push(["Account", accountName(entry.accountId)]);
  }
  rows.push(["Note", entry.note || "—"]);
  rows.push(["Date", entry.date]);

  return (
    <Sheet open title="Transaction Details" onClose={close}>
      <Card style={{ padding: "4px 16px" }}>
        {rows.map(([label, value], i) => (
          <div key={label} style={{ padding: "11px 0", borderTop: i === 0 ? "none" : `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, flexShrink: 0 }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}>
              {value}
              {label === "Category" && isBS && <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: "rgba(251,191,36,.18)", border: "1px solid rgba(251,191,36,.4)", color: C.amberText, marginLeft: 6 }}>BS</span>}
            </span>
          </div>
        ))}
      </Card>
      <div style={{ fontSize: 10, color: C.faint, fontWeight: 600, marginTop: 10, lineHeight: 1.5 }}>
        {canUnexplain
          ? "This transaction is explained and locked. Unexplain it to change its category, party, or type again."
          : "Transfers and party entries aren't coded through Unexplained — their accounts and direction were fixed when they were saved."}
      </div>
      {canUnexplain && (
        <GhostBtn style={{ width: "100%", marginTop: 12 }} onClick={() => {
          up((b) => {
            const idx = b.entries.findIndex((e) => e.id === entryId);
            if (idx >= 0) b.entries[idx] = { ...b.entries[idx], category: "Suspense" };
            return b;
          });
          close();
        }}>Unexplain This Transaction</GhostBtn>
      )}
    </Sheet>
  );
}

/* ══════════════════════════ CODE TRANSACTION ══════════════════════════ */
function CodeTransactionSheet({ book, up, close, entryId }) {
  const entry = book.entries.find((e) => e.id === entryId);
  const accountName = (id) => (book.accounts.find((a) => a.id === id) || {}).name || "—";
  const debit = entry ? entry.type === "out" : true;
  const matched = entry ? suggestHead(book, entry.merchant || "") : "Suspense";
  const [subKind, setSubKind] = useState("category");
  const [f, setF] = useState(() => ({
    ...initialFields(book),
    category: matched !== "Suspense" ? matched : (debit ? (book.categories.expense.find((c) => c !== "Suspense") || "") : (book.categories.income[0] || "")),
    toAccountId: entry ? ((book.accounts.find((a) => a.id !== entry.accountId) || {}).id || "") : "",
  }));

  if (!entry) return null;

  const save = () => {
    up((b) => {
      const idx = b.entries.findIndex((e) => e.id === entryId);
      if (idx < 0) return b;
      const base = b.entries[idx];
      if (subKind === "category") {
        b.entries[idx] = { ...base, category: f.category };
      } else if (subKind === "refund") {
        b.entries[idx] = { ...base, category: f.refundFor };
      } else if (subKind === "party") {
        b.entries.splice(idx, 1);
        b.entries.push({ id: base.id, date: base.date, amount: base.amount, type: "party", partyId: f.partyId, accountId: base.accountId, dir: debit ? "out" : "in", note: base.note || "" });
      } else if (subKind === "transfer") {
        b.entries.splice(idx, 1);
        b.entries.push({
          id: base.id, date: base.date, amount: base.amount, type: "transfer",
          fromAccountId: debit ? base.accountId : f.toAccountId,
          toAccountId: debit ? f.toAccountId : base.accountId,
          note: base.note || "",
        });
      } else if (subKind === "split") {
        b.entries.splice(idx, 1);
        const p1 = parseAmount(f.splitAmt1) || 0;
        const p2 = Math.max(0, base.amount - p1);
        b.entries.push({ id: uid(), date: base.date, amount: p1, type: "out", category: f.splitCat1, accountId: base.accountId, note: base.note || "" });
        if (f.splitKind2 === "bs") b.entries.push({ id: uid(), date: base.date, amount: p2, type: "out", category: f.splitBsCat2, accountId: base.accountId, note: base.note || "" });
        else b.entries.push({ id: uid(), date: base.date, amount: p2, type: "party", partyId: f.splitPartyId2, accountId: base.accountId, dir: "out", note: base.note || "" });
      }
      return b;
    });
    close();
  };

  return (
    <Sheet open title="Code Transaction" onClose={close}>
      <Card style={{ padding: "13px 15px", marginBottom: 14 }}>
        <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>From bank statement</div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 6, gap: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{entry.merchant || "Unrecognized transaction"}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: debit ? C.red : C.green, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{debit ? "−" : "+"}{inr(entry.amount)}</div>
        </div>
        <div style={{ fontSize: 10, color: C.faint, fontWeight: 600, marginTop: 2 }}>{entry.date} · {accountName(entry.accountId)}</div>
      </Card>
      <div style={st.label}>This was...</div>
      <Seg value={subKind} onChange={setSubKind} wrap4 options={subkindsFor(debit ? "out" : "in").map(([v, label]) => ({ v, label: label.replace(" to Pay", "").replace(" to Receive", "") }))} />
      <TypeFields book={book} up={up} mode="code" direction={debit ? "out" : "in"} subKind={subKind} f={f} setF={setF} totalAmount={entry.amount} />
      {matched !== "Suspense" && subKind === "category" && (
        <div style={{ fontSize: 10, color: C.accentText, fontWeight: 600, marginTop: 6, display: "flex", gap: 4, alignItems: "flex-start" }}>
          <Ic name="wand" size={11} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Matched via your auto-coding rule "{keywordOf(entry.merchant || "")} → {matched}" — tap Save to confirm, or pick a different category.</span>
        </div>
      )}
      <PrimaryBtn style={{ marginTop: 16 }} onClick={save}>Save &amp; Explain</PrimaryBtn>
    </Sheet>
  );
}

// Codes several Unexplained rows at once — all must share the same debit/
// credit direction (a mix would need different category lists and party
// dir per row, which defeats the point of doing this in one action).
function BulkCodeSheet({ book, up, close, entryIds, onApplied }) {
  const entries = book.entries.filter((e) => (entryIds || []).includes(e.id));
  const debit = entries[0] ? entries[0].type === "out" : true;
  const mixed = new Set(entries.map((e) => e.type)).size > 1;
  const totalAmount = entries.reduce((s, e) => s + e.amount, 0);

  const [subKind, setSubKind] = useState("category");
  const [category, setCategory] = useState(() => (debit ? (book.categories.expense.find((c) => c !== "Suspense") || "") : (book.categories.income[0] || "")));
  const [partyId, setPartyId] = useState(book.parties[0] ? book.parties[0].id : "");
  const [toAccountId, setToAccountId] = useState(() => ((book.accounts.find((a) => entries.every((e) => e.accountId !== a.id))) || book.accounts[0] || {}).id || "");

  if (entries.length === 0) return null;

  const apply = () => {
    up((b) => {
      for (const id of entryIds) {
        const idx = b.entries.findIndex((e) => e.id === id);
        if (idx < 0) continue;
        const base = b.entries[idx];
        if (base.type !== "out" && base.type !== "in") continue;
        const isDebit = base.type === "out";
        if (subKind === "category") {
          b.entries[idx] = { ...base, category };
        } else if (subKind === "party") {
          b.entries.splice(idx, 1);
          b.entries.push({ id: base.id, date: base.date, amount: base.amount, type: "party", partyId, accountId: base.accountId, dir: isDebit ? "out" : "in", note: base.note || "" });
        } else if (subKind === "transfer") {
          if (toAccountId === base.accountId) continue; // would be a no-op self-transfer
          b.entries.splice(idx, 1);
          b.entries.push({
            id: base.id, date: base.date, amount: base.amount, type: "transfer",
            fromAccountId: isDebit ? base.accountId : toAccountId,
            toAccountId: isDebit ? toAccountId : base.accountId,
            note: base.note || "",
          });
        }
      }
      return b;
    });
    if (onApplied) onApplied();
    close();
  };

  const KINDS = debit
    ? [["category", "Expense"], ["party", "Party to Pay"], ["transfer", "Transfer"]]
    : [["category", "Income"], ["party", "Party to Receive"], ["transfer", "Transfer"]];

  return (
    <Sheet open title={`Code ${entries.length} Transactions`} onClose={close}>
      {mixed ? (
        <div style={{ fontSize: 12.5, color: C.amberText, fontWeight: 600, lineHeight: 1.5 }}>
          Select transactions that are all debits or all credits to code them together — this selection has a mix of both.
        </div>
      ) : (
        <>
          <Card style={{ padding: "13px 15px", marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>{entries.length} selected</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: debit ? C.red : C.green, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{debit ? "−" : "+"}{inr(totalAmount)} total</div>
          </Card>
          <div style={st.label}>Code all of these as...</div>
          <Seg value={subKind} onChange={setSubKind} options={KINDS.map(([v, label]) => ({ v, label }))} />
          {subKind === "category" && (
            <>
              <div style={st.label}>Category</div>
              <CategorySelect book={book} value={category} onChange={setCategory} direction={debit ? "out" : "in"} />
            </>
          )}
          {subKind === "party" && (
            <>
              <div style={st.label}>Party</div>
              <PartySelect book={book} up={up} value={partyId} onChange={setPartyId} />
            </>
          )}
          {subKind === "transfer" && (
            <>
              <div style={st.label}>{debit ? "To Account" : "From Account"}</div>
              <AccountSelect book={book} value={toAccountId} onChange={setToAccountId} />
            </>
          )}
          <PrimaryBtn style={{ marginTop: 16 }} onClick={apply}>Code {entries.length} Transactions</PrimaryBtn>
        </>
      )}
    </Sheet>
  );
}

/* ══════════════════════════ RECORD PAYMENT / NEW TRIP / IMPORT ══════════════════════════ */
function RecordPaymentSheet({ book, up, close, presetPartyId }) {
  const owed = owedAsOf(book, today());
  const [partyId, setPartyId] = useState(presetPartyId || (book.parties[0] ? book.parties[0].id : ""));
  const [amount, setAmount] = useState("");
  const [dir, setDir] = useState("in");
  const [accountId, setAccountId] = useState((book.accounts[0] || {}).id || "");
  const [date, setDate] = useState(today());
  const [addingParty, setAddingParty] = useState(book.parties.length === 0);
  const [newName, setNewName] = useState("");

  const addParty = () => {
    const n = newName.trim();
    if (!n) return;
    const id = uid();
    up((b) => { b.parties.push({ id, name: n }); return b; });
    setPartyId(id);
    setAddingParty(false);
    setNewName("");
  };

  const save = () => {
    const amt = parseAmount(amount);
    if (!amt || !partyId || !accountId) return;
    up((b) => { b.entries.push({ id: uid(), date, amount: amt, type: "party", partyId, accountId, dir, note: "" }); return b; });
    close();
  };

  if (book.accounts.length === 0) return <Sheet open title="Record Payment" onClose={close}><div style={{ fontSize: 13, color: C.muted }}>Add an account first, in Setup ▸ Accounts.</div></Sheet>;

  return (
    <Sheet open title="Record Payment" onClose={close}>
      <div style={st.label}>Party</div>
      {addingParty ? (
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...st.input, flex: 1 }} placeholder="Person's name" value={newName} autoFocus
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addParty()} />
          <PrimaryBtn style={{ width: "auto", padding: "0 16px" }} onClick={addParty}>Add</PrimaryBtn>
        </div>
      ) : (
        <select style={st.input} value={partyId} onChange={(e) => (e.target.value === "__new__" ? setAddingParty(true) : setPartyId(e.target.value))}>
          {owed.perParty.map((p) => (
            <option key={p.id} value={p.id}>{p.name} — {p.balance > 0 ? `owes you ${inr(p.balance)}` : p.balance < 0 ? `you owe ${inr(-p.balance)}` : "settled"}</option>
          ))}
          <option value="__new__">+ New person…</option>
        </select>
      )}
      <div style={st.label}>Amount</div>
      <input style={{ ...st.input, fontSize: 15, fontWeight: 800 }} placeholder="Amount — 500, 2k, 1.2L" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div style={st.label}>Account</div>
      <AccountSelect book={book} value={accountId} onChange={setAccountId} />
      <div style={st.label}>Direction</div>
      <Seg value={dir} onChange={setDir} options={[{ v: "in", label: "They paid me" }, { v: "out", label: "I paid them" }]} />
      <div style={st.label}>Date</div>
      <input style={st.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <PrimaryBtn style={{ marginTop: 16 }} onClick={save}>Save Payment</PrimaryBtn>
    </Sheet>
  );
}

function NewTripSheet({ up, close }) {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const save = () => {
    if (!name.trim()) return;
    up((b) => { b.trips.push({ id: uid(), name: name.trim(), budget: parseAmount(budget) || 0, startDate: startDate || null, endDate: endDate || null }); return b; });
    close();
  };
  return (
    <Sheet open title="New Trip" onClose={close}>
      <div style={st.label}>Name</div>
      <input style={st.input} placeholder="e.g. Goa Trip" value={name} onChange={(e) => setName(e.target.value)} />
      <div style={st.label}>Budget (optional)</div>
      <input style={st.input} placeholder="Amount — 15k" value={budget} onChange={(e) => setBudget(e.target.value)} />
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}><div style={st.label}>Start Date</div><input style={st.input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
        <div style={{ flex: 1 }}><div style={st.label}>End Date</div><input style={st.input} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
      </div>
      <PrimaryBtn style={{ marginTop: 16 }} onClick={save}>Save Trip</PrimaryBtn>
    </Sheet>
  );
}

function ImportSheet({ book, up, close }) {
  const [accountId, setAccountId] = useState((book.accounts[0] || {}).id || "");
  const [status, setStatus] = useState("");
  const fileRef = useRef(null);

  const importRows = (rows) => {
    up((b) => {
      for (const r of rows) {
        if (!r.amount || !r.date) continue;
        b.entries.push({ id: uid(), date: r.date, amount: r.amount, type: r.type, category: "Suspense", accountId, merchant: r.note || "", note: "" });
      }
      return b;
    });
  };

  const handleFile = async (file) => {
    if (!accountId) { setStatus("Add an account first."); return; }
    setStatus("Reading…");
    try {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const pages = await extractPdfPages(file);
        let rows = parsePdfTable(pages);
        if (!rows.length) {
          const text = pages.map((items) => items.map((i) => i.s).join(" ")).join("\n");
          rows = parseStatementText(text);
        }
        importRows(rows);
        setStatus(`Imported ${rows.length} transaction${rows.length === 1 ? "" : "s"}.`);
      } else {
        setStatus("Reading photo (this can take a moment)…");
        const worker = await getOcrWorker((pct) => setStatus(`Reading photo… ${pct}%`));
        const { data } = await worker.recognize(file);
        await worker.terminate();
        const rows = parseStatementText(data.text || "");
        importRows(rows);
        setStatus(`Imported ${rows.length} transaction${rows.length === 1 ? "" : "s"}.`);
      }
    } catch (err) {
      setStatus("Couldn't read that file — " + (err && err.message ? err.message : "try a clearer photo or a text-based PDF."));
    }
  };

  if (book.accounts.length === 0) {
    return <Sheet open title="Import" onClose={close}><div style={{ fontSize: 13, color: C.muted }}>Add an account first, in Setup ▸ Accounts.</div></Sheet>;
  }

  return (
    <Sheet open title="Import" onClose={close}>
      <div style={st.label}>Account</div>
      <AccountSelect book={book} value={accountId} onChange={setAccountId} />
      <div onClick={() => fileRef.current && fileRef.current.click()} style={{ border: `1.5px dashed ${C.accent}`, borderRadius: 16, padding: "28px 16px", textAlign: "center", marginTop: 14, cursor: "pointer" }}>
        <Ic name="upload" size={26} color={C.accentText} style={{ margin: "0 auto", display: "block" }} />
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>Drop a PDF or photo here</div>
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginTop: 4 }}>or tap to browse — PDFs parse instantly, photos run through on-device OCR, then auto-coding rules apply automatically</div>
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; if (f) handleFile(f); }} />
      {status && <div style={{ fontSize: 11, color: C.accentText, fontWeight: 600, marginTop: 10, textAlign: "center" }}>{status}</div>}
      <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 600, marginTop: 14, textAlign: "center" }}>Everything stays on your device — nothing is uploaded anywhere.</div>
    </Sheet>
  );
}

/* ══════════════════════════ nav + root shell ══════════════════════════ */
const TABS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "owed", label: "Owed", icon: "people" },
  { id: "travel", label: "Travel", icon: "plane" },
  { id: "tx", label: "Transactions", icon: "swap" },
  { id: "reports", label: "Reports", icon: "bars" },
  { id: "setup", label: "Setup", icon: "sliders" },
];

function NavBar({ tab, setTab }) {
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", padding: "10px 2px 13px", background: C.navBg, backdropFilter: "blur(20px)", borderTop: `1px solid ${C.overlayBorder}`, zIndex: 30 }}>
      {TABS.map((tItem) => {
        const active = tItem.id === tab;
        return (
          <button key={tItem.id} data-tab={tItem.id} onClick={() => setTab(tItem.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: active ? C.accentText : C.faint, background: "none", border: "none", cursor: "pointer", fontFamily: F.sans, padding: 0 }}>
            <div style={{ width: 17, height: 17, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: active ? C.iconBg : "transparent", boxShadow: active ? C.iconGlow : "none" }}>
              <Ic name={tItem.icon} size={17} />
            </div>
            <div style={{ fontSize: 8, fontWeight: 600 }}>{tItem.label}</div>
            <div style={{ width: 12, height: 2.5, borderRadius: 2, marginTop: 1, background: active ? C.accent : "transparent", boxShadow: active ? `0 0 8px 0 ${C.accent}` : "none" }} />
          </button>
        );
      })}
    </div>
  );
}

function LockScreen({ pin, onUnlock, onForgot }) {
  const [entered, setEntered] = useState("");
  const [shake, setShake] = useState(false);

  const tap = (d) => {
    if (shake) return;
    const next = (entered + d).slice(0, 4);
    setEntered(next);
    if (next.length === 4) {
      if (next === pin) {
        setTimeout(onUnlock, 80);
      } else {
        setShake(true);
        setTimeout(() => { setShake(false); setEntered(""); }, 420);
      }
    }
  };
  const del = () => setEntered((s) => s.slice(0, -1));

  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: C.bg, color: C.ink, fontFamily: F.sans, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: `url(${C.bgImage})`, backgroundSize: "cover", backgroundPosition: "center top", zIndex: 0 }} />
      <div style={{ position: "fixed", inset: 0, background: C.scrim, zIndex: 1 }} />
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 300 }}>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: C.grad, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, color: "#fff", boxShadow: `0 14px 28px -8px ${C.accentDeep}`, marginBottom: 16 }}>₹</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Cash Book — Simple</div>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginTop: 3, marginBottom: 26 }}>Enter your passcode</div>
        <div style={{ display: "flex", gap: 14, marginBottom: 30, animation: shake ? "cbShake .4s" : "none" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ width: 13, height: 13, borderRadius: "50%", background: i < entered.length ? (shake ? C.red : C.grad) : "transparent", border: i < entered.length ? "none" : `1px solid ${C.overlayBorder}` }} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, width: "100%" }}>
          {KEYS.map((k, i) =>
            k === "" ? (
              <div key={i} />
            ) : k === "del" ? (
              <button key={i} onClick={del} style={{ aspectRatio: "1", borderRadius: "50%", border: "none", background: "none", color: C.muted, fontFamily: F.sans, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>⌫</button>
            ) : (
              <button key={i} onClick={() => tap(k)} style={{ aspectRatio: "1", borderRadius: "50%", border: `1px solid ${C.overlayBorder}`, background: C.overlayWash, color: C.ink, fontFamily: F.sans, fontSize: 20, fontWeight: 700, cursor: "pointer" }}>{k}</button>
            )
          )}
        </div>
        <button onClick={onForgot} style={{ marginTop: 26, background: "none", border: "none", color: C.muted, fontFamily: F.sans, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Forgot passcode?</button>
      </div>
    </div>
  );
}

// pref: "system" (follow the OS) | "dark" | "light" (forced regardless of OS).
function useTheme(pref) {
  const [, force] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const mode = pref === "dark" || pref === "light" ? pref : (mq.matches ? "dark" : "light");
      applyTheme(mode);
      force((n) => n + 1);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);
}

const GLOBAL_CSS = `
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; padding: 0; overflow-x: hidden; overscroll-behavior-x: none; touch-action: manipulation; -webkit-touch-callout: none; }
::-webkit-scrollbar { display: none; }
input, select, textarea { -webkit-user-select: text; user-select: text; }
@keyframes cbShake { 0%,100% { transform: translateX(0); } 20%,60% { transform: translateX(-8px); } 40%,80% { transform: translateX(8px); } }
`;

export default function App() {
  const [book, setBook] = useState(null);
  useTheme(book && book.prefs.theme);
  const [tab, setTab] = useState("home");
  const [sheet, setSheet] = useState(null); // { name, ctx }
  const [accountsPageOpen, setAccountsPageOpen] = useState(false);
  const [txSelectMode, setTxSelectMode] = useState(false);
  // Whether THIS session still needs a PIN. Only decided once, right after
  // the book loads, from whatever book.prefs.lock.on was at that moment —
  // turning the lock on later in the same session (Setup) must NOT
  // retroactively lock the session that's already open; it only takes
  // effect on the next boot, once a real PIN has actually been saved.
  const [unlocked, setUnlocked] = useState(null); // null = not yet decided

  useEffect(() => {
    loadBook().then((b) => {
      const loaded = b || defaultBook();
      setBook(loaded);
      setUnlocked(!loaded.prefs.lock.on);
    });
  }, []);

  useEffect(() => {
    if (!book) return;
    // Expose the engine for the test harness, mirroring the main app's
    // window.__cashbookEngine convention.
    window.__simpleEngine = {
      computePL, computeCashFlow, accountsWithBalances, owedAsOf, tripSpendAsOf,
      isExplained, isRefund, suggestHead, keywordOf, defaultBook, parseAmount, inr,
    };
  }, [book]);

  const up = (mutator) => {
    setBook((b) => {
      const nb = structuredClone(b);
      mutator(nb);
      saveBook(nb);
      return nb;
    });
  };

  const openSheet = (name, ctx) => setSheet({ name, ctx: ctx || {} });
  const closeSheet = () => setSheet(null);
  const openCodeTx = (entryId) => setSheet({ name: "codeTx", ctx: { entryId } });
  const go = (t) => setTab(t);

  useEffect(() => { if (tab !== "tx") setTxSelectMode(false); }, [tab]);

  if (!book || unlocked === null) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.muted, fontFamily: F.sans, fontSize: 13, fontWeight: 600 }}>
        Loading…
      </div>
    );
  }

  // A pin shorter than 4 digits (e.g. the lock was switched on but a PIN was
  // never actually saved) must never be able to gate the app — there'd be no
  // 4-digit entry that could ever match it, which is a permanent lockout.
  if (book.prefs.lock.on && book.prefs.lock.pin && book.prefs.lock.pin.length === 4 && !unlocked) {
    return (
      <LockScreen
        pin={book.prefs.lock.pin}
        onUnlock={() => setUnlocked(true)}
        onForgot={() => {
          if (window.confirm("Forgot your passcode? This turns off App Lock so you can get back in — your data stays exactly as it is.")) {
            up((b) => { b.prefs.lock.on = false; return b; });
            setUnlocked(true);
          }
        }}
      />
    );
  }

  const headerActions = tab === "home"
    ? <><IconBtn onClick={() => openSheet("import")}><Ic name="upload" size={13} /></IconBtn><IconBtn><Ic name="search" size={13} /></IconBtn><IconBtn><Ic name="bell" size={13} /></IconBtn></>
    : tab === "tx" ? <IconBtn onClick={() => openSheet("import")}><Ic name="upload" size={13} /></IconBtn>
    : null;

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: F.sans, overflowX: "hidden" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ position: "fixed", inset: 0, backgroundImage: `url(${C.bgImage})`, backgroundSize: "cover", backgroundPosition: "center top", zIndex: 0 }} />
      <div style={{ position: "fixed", inset: 0, background: C.scrim, zIndex: 1 }} />
      <div style={{ position: "relative", zIndex: 2, minHeight: "100vh", paddingBottom: 70 }}>
        <Header title={TABS.find((x) => x.id === tab).label} brand={tab === "home"} actions={headerActions} />
        {tab === "home" && <HomeScreen book={book} go={go} openSheet={openSheet} />}
        {tab === "owed" && <OwedScreen book={book} openSheet={openSheet} />}
        {tab === "travel" && <TravelScreen book={book} openSheet={openSheet} />}
        {tab === "tx" && <TransactionsScreen book={book} openSheet={openSheet} openCodeTx={openCodeTx} selectMode={txSelectMode} setSelectMode={setTxSelectMode} />}
        {tab === "reports" && <ReportsScreen book={book} />}
        {tab === "setup" && <SetupScreen book={book} openSheet={openSheet} openAccountsPage={() => setAccountsPageOpen(true)} />}
      </div>

      {(tab === "home" || (tab === "tx" && !txSelectMode)) && (
        <button onClick={() => openSheet("newTx")} style={{ position: "fixed", zIndex: 25, right: 18, bottom: 92, width: 50, height: 50, borderRadius: "50%", background: C.grad, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: `0 14px 28px -8px ${C.accentDeep}`, border: "none", cursor: "pointer" }}>
          <Ic name="plus" size={19} />
        </button>
      )}

      <NavBar tab={tab} setTab={setTab} />

      <SetupAccountsPage book={book} up={up} open={accountsPageOpen} onBack={() => setAccountsPageOpen(false)} />

      {sheet && sheet.name === "newTx" && <NewTransactionSheet book={book} up={up} close={closeSheet} preset={sheet.ctx} />}
      {sheet && sheet.name === "codeTx" && <CodeTransactionSheet book={book} up={up} close={closeSheet} entryId={sheet.ctx.entryId} />}
      {sheet && sheet.name === "viewTx" && <ViewTransactionSheet book={book} up={up} close={closeSheet} entryId={sheet.ctx.entryId} />}
      {sheet && sheet.name === "bulkCode" && <BulkCodeSheet book={book} up={up} close={closeSheet} entryIds={sheet.ctx.entryIds} onApplied={sheet.ctx.onApplied} />}
      {sheet && sheet.name === "recordPayment" && <RecordPaymentSheet book={book} up={up} close={closeSheet} presetPartyId={sheet.ctx.partyId} />}
      {sheet && sheet.name === "newTrip" && <NewTripSheet up={up} close={closeSheet} />}
      {sheet && sheet.name === "tripDetail" && <TripDetailSheet book={book} up={up} tripId={sheet.ctx.tripId} openSheet={openSheet} close={closeSheet} />}
      {sheet && sheet.name === "import" && <ImportSheet book={book} up={up} close={closeSheet} />}
      {sheet && sheet.name === "setupCategories" && <SetupCategoriesSheet book={book} up={up} close={closeSheet} />}
      {sheet && sheet.name === "setupBsCategories" && <SetupBsCategoriesSheet book={book} up={up} close={closeSheet} />}
      {sheet && sheet.name === "setupRules" && <SetupRulesSheet book={book} up={up} close={closeSheet} />}
      {sheet && sheet.name === "setupPrefs" && <SetupPrefsSheet book={book} up={up} close={closeSheet} />}
    </div>
  );
}
