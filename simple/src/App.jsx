import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadBook, saveBook, defaultBook } from "./storage.js";
import {
  inr, parseAmount, today, periodByOffset, previousPeriod,
  uid, isExplained, isRefund, computePL, computeCashFlow, accountsWithBalances,
  owedAsOf, suggestHead, keywordOf,
} from "./engine.js";
import { extractPdfPages, parsePdfTable, parseStatementText, getOcrWorker } from "./pdf.js";

/* ────────────────────────── theme tokens ──────────────────────────
   Navy on paper-blue — the approved design handoff's palette, light-only
   by explicit user decision (no dark mode, no in-app appearance toggle). */
function alpha(hex, a) {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const THEME = {
  accent: "#1d3a8f", accentDeep: "#14286b", accentText: "#1d3a8f",
  bg: "#eef1f8", ink: "#111111", soft: "#333333", muted: "#777777", faint: "#999999",
  glass: "rgba(255,255,255,.62)", glassSoft: "rgba(255,255,255,.85)",
  border: "1px solid rgba(17,17,17,.12)", borderSoft: "1px solid rgba(17,17,17,.08)",
  line: "rgba(17,17,17,.08)",
  shadow: "0 12px 30px -14px rgba(17,17,17,.22)",
  sheetBg: "#ffffff", navBg: "rgba(255,255,255,.62)", headerBg: "transparent",
  green: "#0f6a5c", red: "#cc3333", amberText: "#a6741c",
  overlayWash: "rgba(17,17,17,.06)", overlayBorder: "rgba(17,17,17,.15)", overlayStrong: "rgba(17,17,17,.22)",
  bgGradient: "radial-gradient(circle at 12% 8%, rgba(29,58,143,.14), transparent 45%), radial-gradient(circle at 92% 26%, rgba(14,36,97,.10), transparent 50%), radial-gradient(circle at 50% 95%, rgba(29,58,143,.08), transparent 45%)",
  stripeGrad: "linear-gradient(90deg,#14286b,#1d3a8f,#a6741c)",
  dimBg: "rgba(17,17,17,.32)",
};

function deriveTokens(t) {
  return {
    ...t,
    grad: `linear-gradient(135deg,${t.accent},${t.accentDeep})`,
    accentSoft: alpha(t.accent, 0.1),
    accentBorder: alpha(t.accent, 0.4),
  };
}

const C = deriveTokens(THEME);

const F = { sans: '"Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' };

function glass(radius = 16) {
  return { background: C.glass, backdropFilter: "blur(18px) saturate(140%)", WebkitBackdropFilter: "blur(18px) saturate(140%)", border: C.border, borderRadius: radius, boxShadow: C.shadow };
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
    card: "M3 5h18v14H3Z M3 10h18",
    check: "M20 6 9 17l-5-5",
    info: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 11v5M12 8h.01",
    chevronDown: "m6 9 6 6 6-6",
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
            {o.badge != null && <span style={{ background: "rgba(251,191,36,.18)", border: "1px solid rgba(251,191,36,.4)", color: C.amberText, borderRadius: 999, padding: "1px 6px", fontSize: 9.5, fontWeight: 800 }}>{o.badge}</span>}
          </button>
        );
      })}
    </div>
  );
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

// A centered popup card, for short confirmations/lists the mockup shows as
// a small dialog rather than a full-width bottom sheet (Notifications,
// Import statement). Routed at the same app-level tier as Sheet so it can
// never get trapped beneath the FAB/NavBar's stacking context.
function Modal({ open, onClose, title, width, children }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: C.dimBg, backdropFilter: "blur(10px) saturate(140%)", WebkitBackdropFilter: "blur(10px) saturate(140%)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: width || 280, maxWidth: "calc(100vw - 40px)", boxSizing: "border-box", background: "#fff", borderRadius: 20, padding: 20, boxShadow: "0 12px 30px rgba(17,17,17,.2)", fontFamily: F.sans, color: C.ink }}>
        {title && <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, textAlign: "center" }}>{title}</div>}
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
function Header({ title, actions }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 8px", gap: 10 }}>
      <div style={{ fontSize: 20, fontWeight: 700, flex: 1 }}>{title}</div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>{actions}</div>
    </div>
  );
}
function IconBtn({ onClick, children }) {
  return <div onClick={onClick} style={{ width: 29, height: 29, borderRadius: "50%", background: C.glassSoft, border: `1px solid ${C.overlayBorder}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.soft, cursor: "pointer" }}>{children}</div>;
}
function BellBtn({ onClick, notifCount }) {
  return (
    <div onClick={onClick} style={{ width: 44, height: 44, borderRadius: "50%", position: "relative", overflow: "hidden", cursor: "pointer", flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: 0, backdropFilter: "blur(12px) saturate(140%)", WebkitBackdropFilter: "blur(12px) saturate(140%)", background: C.glassSoft }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1px solid ${C.overlayBorder}` }} />
      <div style={{ position: "relative", zIndex: 1, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Ic name="bell" size={18} color={C.ink} />
      </div>
      {notifCount > 0 && <span style={{ position: "absolute", top: 9, right: 10, width: 8, height: 8, borderRadius: "50%", background: C.red, border: `1.5px solid ${C.glassSoft}` }} />}
    </div>
  );
}
function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ ...glass(18), padding: 16, ...style }}>{children}</div>;
}
function RowLine({ children, onClick, last }) {
  return <div onClick={onClick} style={{ display: "flex", alignItems: "center", padding: "12px 0", borderTop: last ? "none" : `1px solid ${C.line}`, cursor: onClick ? "pointer" : "default" }}>{children}</div>;
}

/* ══════════════════════════ HOME ══════════════════════════ */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const HERO_COLORS = ["#1d3a8f", "#4c68b3", "#142a68", "#7a2e3b", "#0f6a5c", "#a6741c"];

function HeroCarousel({ accounts, openSheet }) {
  const [idx, setIdx] = useState(0);
  const n = accounts.length;
  const clamped = Math.min(idx, n - 1);
  const go = (i) => setIdx(((i % n) + n) % n);
  return (
    <div>
      <div style={{ position: "relative", height: 132, overflow: "hidden", borderRadius: 16, marginBottom: 10 }}>
        <div style={{ display: "flex", height: "100%", transform: `translateX(-${clamped * 100}%)`, transition: "transform .28s cubic-bezier(.2,.8,.2,1)" }}>
          {accounts.map((a, i) => (
            <div key={a.id} style={{ flex: "0 0 100%", height: "100%", boxSizing: "border-box", padding: "0 1px" }}>
              <div onClick={() => openSheet("breakdown")} style={{ height: "100%", boxSizing: "border-box", background: HERO_COLORS[i % HERO_COLORS.length], borderRadius: 16, padding: 18, color: "#fff", display: "flex", flexDirection: "column", justifyContent: "space-between", cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", opacity: .8, whiteSpace: "nowrap" }}>{a.name}</span>
                  {a.kind === "card" && <span style={{ fontSize: 9, fontWeight: 700, background: "rgba(255,255,255,.2)", borderRadius: 999, padding: "3px 8px" }}>{a.dueDay ? `Due ${a.dueDay}${dueOrdinal(a.dueDay)}` : "Card"}</span>}
                </div>
                <div>
                  <div style={{ fontSize: 25, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{inr(Math.abs(a.balance))}</div>
                  <div style={{ fontSize: 10, marginTop: 3, opacity: .82 }}>{a.kind === "bank" ? "Available balance" : "Outstanding"}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {n > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <RoundBtn onClick={() => go(clamped - 1)} style={{ width: 24, height: 24 }}><Ic name="back" size={11} color={C.soft} /></RoundBtn>
          <div style={{ display: "flex", gap: 5 }}>
            {accounts.map((a, i) => (
              <div key={a.id} onClick={() => go(i)} style={{ width: i === clamped ? 16 : 6, height: 6, borderRadius: 3, background: i === clamped ? C.accent : C.overlayStrong, cursor: "pointer", transition: "width .2s ease" }} />
            ))}
          </div>
          <RoundBtn onClick={() => go(clamped + 1)} style={{ width: 24, height: 24 }}><Ic name="back" size={11} color={C.soft} style={{ transform: "rotate(180deg)" }} /></RoundBtn>
        </div>
      )}
    </div>
  );
}

function BreakdownSheet({ book, close }) {
  const t = today();
  const accounts = accountsWithBalances(book, t);
  const net = accounts.reduce((s, a) => s + (a.kind === "card" ? -a.balance : a.balance), 0);
  return (
    <Sheet open title="Your money breakdown" onClose={close}>
      <Card style={{ padding: "2px 16px", marginBottom: 12 }}>
        {accounts.map((a, i) => (
          <RowLine key={a.id} last={i === accounts.length - 1}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: HERO_COLORS[i % HERO_COLORS.length], flexShrink: 0, marginRight: 10 }} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{a.name}</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{a.kind === "card" ? "−" : ""}{inr(Math.abs(a.balance))}</div>
          </RowLine>
        ))}
      </Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 14px" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Net across accounts</span>
        <span style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{inr(net)}</span>
      </div>
      <PrimaryBtn onClick={close}>Done</PrimaryBtn>
    </Sheet>
  );
}

function HomeScreen({ book, go, openSheet, notifCount }) {
  const t = today();
  const monthStart = t.slice(0, 8) + "01";
  const pl = computePL(book, monthStart, t);
  const accounts = accountsWithBalances(book, t);
  const owed = owedAsOf(book, t);
  const unexplainedCount = book.entries.filter((e) => (e.type === "in" || e.type === "out") && !isExplained(e)).length;
  const approvalCount = book.entries.filter((e) => (e.type === "in" || e.type === "out") && e.pendingApproval).length;

  const maxInOut = Math.max(pl.totalIncome, pl.totalExpense, 1);
  const savedPct = pl.totalIncome > 0 ? Math.round((pl.net / pl.totalIncome) * 100) : 0;
  const ringPct = Math.max(0, Math.min(100, savedPct));
  const circumference = 2 * Math.PI * 31;

  return (
    <div style={{ padding: "8px 16px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".05em", textTransform: "uppercase", color: C.muted }}>{greeting()}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{book.prefs.name || "there"}</div>
        </div>
        <BellBtn onClick={() => openSheet("notifications")} notifCount={notifCount} />
      </div>

      <div style={{ ...glass(16), padding: 18, marginBottom: 16 }}>
        <div style={{ fontSize: 9.5, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".05em", color: C.muted, marginBottom: 12 }}>This month</div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ position: "relative", width: 76, height: 76, flexShrink: 0 }}>
            <svg width="76" height="76" viewBox="0 0 76 76">
              <circle cx="38" cy="38" r="31" fill="none" stroke={C.overlayWash} strokeWidth="8" />
              <circle cx="38" cy="38" r="31" fill="none" stroke={C.accent} strokeWidth="8" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ringPct / 100)}
                transform="rotate(-90 38 38)" />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{savedPct}%</div>
              <div style={{ fontSize: 7.5, color: C.muted, textTransform: "uppercase" }}>Saved</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.soft, marginBottom: 3 }}><span>In</span><span style={{ fontWeight: 600, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{inr(pl.totalIncome)}</span></div>
              <div style={{ height: 5, borderRadius: 3, background: C.overlayWash }}><div style={{ width: `${(pl.totalIncome / maxInOut) * 100}%`, height: "100%", borderRadius: 3, background: C.ink }} /></div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.soft, marginBottom: 3 }}><span>Out</span><span style={{ fontWeight: 600, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{inr(pl.totalExpense)}</span></div>
              <div style={{ height: 5, borderRadius: 3, background: C.overlayWash }}><div style={{ width: `${(pl.totalExpense / maxInOut) * 100}%`, height: "100%", borderRadius: 3, background: C.accent }} /></div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 500, marginTop: 12 }}>EMI &amp; lending excluded — see Cash Flow in Reports</div>
      </div>

      {accounts.length === 0 ? (
        <div style={{ ...glass(16), padding: "22px 18px", textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>No accounts yet</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 14 }}>Add a bank or credit card account to see your money here.</div>
          <div onClick={() => go("setup")} style={{ display: "inline-block", background: C.accent, color: "#fff", borderRadius: 10, padding: "9px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Add account</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 2px", gap: 8 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap" }}>Your money</div>
            <div onClick={() => openSheet("breakdown")} style={{ fontSize: 11.5, fontWeight: 500, color: C.ink, cursor: "pointer", whiteSpace: "nowrap" }}>Detailed breakdown ›</div>
          </div>
          <HeroCarousel accounts={accounts} openSheet={openSheet} />
        </>
      )}

      <div style={{ display: "flex", gap: 8, margin: "18px 0" }}>
        <button onClick={() => openSheet("newTx")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "13px 0", border: "none", borderRadius: 999, background: C.accent, color: "#fff", fontFamily: F.sans, fontWeight: 600, fontSize: 13, cursor: "pointer" }}><Ic name="plus" size={14} color="#fff" />Add transaction</button>
        <button onClick={() => openSheet("import")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "13px 0", border: `1px solid ${C.overlayBorder}`, borderRadius: 999, background: "#fff", color: C.ink, fontFamily: F.sans, fontWeight: 600, fontSize: 13, cursor: "pointer" }}><Ic name="upload" size={14} color={C.ink} />Import statement</button>
      </div>

      {(owed.debtors > 0 || owed.creditors > 0) && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 2px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Owed</div>
            <div onClick={() => go("owed")} style={{ fontSize: 11.5, fontWeight: 500, color: C.ink, cursor: "pointer" }}>See all ›</div>
          </div>
          <div onClick={() => go("owed")} style={{ background: "#fff", borderRadius: 16, padding: "4px 14px", marginBottom: 18, cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", borderBottom: `1px solid ${C.line}` }}><span style={{ fontSize: 12, color: C.muted }}>You'll get</span><span style={{ fontSize: 13.5, fontWeight: 700, color: C.accent, fontVariantNumeric: "tabular-nums" }}>{inr(owed.debtors)}</span></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0" }}><span style={{ fontSize: 12, color: C.muted }}>You owe</span><span style={{ fontSize: 13.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{inr(owed.creditors)}</span></div>
          </div>
        </>
      )}

      {(unexplainedCount > 0 || approvalCount > 0) && (
        <>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 8, padding: "0 2px" }}>Needs attention</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
            {unexplainedCount > 0 && (
              <div onClick={() => go("tx")} style={{ ...glass(16), padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 3, whiteSpace: "nowrap" }}>{unexplainedCount} unexplained transaction{unexplainedCount === 1 ? "" : "s"}</div>
                  <div style={{ fontSize: 11, color: C.soft }}>Missing a category</div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 600, padding: "5px 12px", borderRadius: 999, background: C.accent, color: "#fff", flexShrink: 0 }}>Categorize</div>
              </div>
            )}
            {approvalCount > 0 && (
              <div onClick={() => go("tx")} style={{ ...glass(16), padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 3, whiteSpace: "nowrap" }}>{approvalCount} transaction{approvalCount === 1 ? "" : "s"} auto-matched</div>
                  <div style={{ fontSize: 11, color: C.soft }}>Confirm the suggested category</div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 600, padding: "5px 12px", borderRadius: 999, background: C.overlayWash, color: C.ink, flexShrink: 0 }}>Approve</div>
              </div>
            )}
          </div>
        </>
      )}

    </div>
  );
}
function dueOrdinal(d) {
  if (d % 10 === 1 && d !== 11) return "st";
  if (d % 10 === 2 && d !== 12) return "nd";
  if (d % 10 === 3 && d !== 13) return "rd";
  return "th";
}

// The next occurrence of dueDay on or after todayStr -- this month's if it
// hasn't passed yet, otherwise next month's.
function nextDueDate(dueDay, todayStr) {
  const [y, m, d] = todayStr.split("-").map(Number);
  let dd = new Date(y, m - 1, dueDay);
  if (dd < new Date(y, m - 1, d)) dd = new Date(y, m, dueDay);
  return dd;
}

// What the notification bell surfaces: unexplained transactions and credit
// card payments due within a week -- the things in this app that actually
// need the user's attention, as opposed to routine day-to-day activity.
function notificationsFor(book) {
  const t = today();
  const list = [];
  const unexplainedCount = book.entries.filter((e) => (e.type === "in" || e.type === "out") && !isExplained(e)).length;
  if (unexplainedCount > 0) {
    list.push({ id: "unexplained", title: `${unexplainedCount} unexplained transaction${unexplainedCount === 1 ? "" : "s"}`, sub: "Tap to review and code them", tab: "tx" });
  }
  for (const a of book.accounts) {
    if (a.kind !== "card" || !a.dueDay) continue;
    const due = nextDueDate(a.dueDay, t);
    const days = Math.round((due - new Date(t + "T00:00:00")) / 86400000);
    if (days >= 0 && days <= 7) {
      list.push({ id: "due-" + a.id, title: `${a.name} payment due ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}`, sub: `Due on the ${a.dueDay}${dueOrdinal(a.dueDay)}`, tab: "home" });
    }
  }
  return list;
}

function NotificationsSheet({ book, go, close }) {
  const items = notificationsFor(book);
  return (
    <Modal open title="Notifications" onClose={close}>
      {items.length === 0 && <div style={{ padding: "10px 0 16px", fontSize: 12.5, color: C.muted, textAlign: "center" }}>You're all caught up — nothing needs your attention.</div>}
      {items.map((n, i) => (
        <div key={n.id} onClick={() => { go(n.tab); close(); }} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: i === items.length - 1 ? "none" : `1px solid ${C.line}`, cursor: "pointer" }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: n.id.startsWith("due-") ? C.overlayWash : C.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Ic name={n.id.startsWith("due-") ? "card" : "swap"} size={15} color={n.id.startsWith("due-") ? C.ink : C.accent} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>{n.title}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{n.sub}</div>
          </div>
        </div>
      ))}
      <PrimaryBtn style={{ marginTop: 10, padding: "10px 0", fontSize: 12.5 }} onClick={close}>Close</PrimaryBtn>
    </Modal>
  );
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
          <RowLine key={p.id} last={i === rows.length - 1} onClick={() => openSheet("partyDetail", { partyId: p.id })}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 1 }}>{p.balance > 0 ? "Owes you" : "You owe them"}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: p.balance > 0 ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>{inr(Math.abs(p.balance))}</div>
          </RowLine>
        ))}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <PrimaryBtn onClick={() => openSheet("newTx", { tab: "owed", owedMode: "receive" })}>+ Add Receivable</PrimaryBtn>
        <GhostBtn onClick={() => openSheet("recordPayment")}>Record Payment</GhostBtn>
      </div>
    </div>
  );
}

// Tapping a party row in Owed used to jump straight to Record Payment,
// which is fine for settling up but gives no way to actually see what
// made up the outstanding balance -- this is the "what do I actually owe
// them for" detail view, with Record Payment reachable from here too.
function PartyDetailSheet({ book, partyId, openSheet, close }) {
  const t = today();
  const party = book.parties.find((x) => x.id === partyId);
  if (!party) return null;
  const owed = owedAsOf(book, t);
  const row = owed.perParty.find((p) => p.id === partyId);
  const balance = row ? row.balance : 0;
  const accountName = (id) => (book.accounts.find((a) => a.id === id) || {}).name || "—";
  const entries = book.entries
    .filter((e) => e.type === "party" && e.partyId === partyId && isExplained(e))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Sheet open title={party.name} onClose={close}>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>{balance > 0 ? "Owes You" : balance < 0 ? "You Owe Them" : "Settled Up"}</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: balance > 0 ? C.green : balance < 0 ? C.red : C.ink, margin: "6px 0 2px", fontVariantNumeric: "tabular-nums" }}>{inr(Math.abs(balance))}</div>
      </Card>

      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Activity</div>
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        {entries.length === 0 && <div style={{ padding: "14px 0", fontSize: 12.5, color: C.muted }}>No transactions with {party.name} yet.</div>}
        {entries.map((e, i) => {
          const out = e.dir === "out";
          const title = e.merchant || e.note || (out ? "Paid" : "Received");
          return (
            <RowLine key={e.id} last={i === entries.length - 1}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
                <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 1 }}>{accountName(e.accountId)}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: out ? C.red : C.green, fontVariantNumeric: "tabular-nums" }}>{out ? "−" : "+"}{inr(e.amount)}</div>
                <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 600, marginTop: 1 }}>{e.date}</div>
              </div>
            </RowLine>
          );
        })}
      </Card>

      {balance !== 0 && <PrimaryBtn style={{ width: "100%" }} onClick={() => openSheet("recordPayment", { partyId })}>Record Payment</PrimaryBtn>}
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

function FilterListRow({ label, active, onClick, last }) {
  return (
    <RowLine onClick={onClick} last={last}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: active ? 800 : 600, color: active ? C.accentText : C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      {active && <span style={{ fontSize: 14, fontWeight: 800, color: C.accentText, flexShrink: 0 }}>✓</span>}
    </RowLine>
  );
}

// A dedicated sheet instead of a horizontal chip row -- with an account
// list, a type list, and (when the book has any) a category list, a chip
// row would either wrap onto multiple lines or need horizontal scrolling
// past a dozen+ entries; a list-per-section sheet scales to any number of
// accounts/categories without changing shape.
function TxFilterSheet({ book, usedCategories, acctFilter, setAcctFilter, dirFilter, setDirFilter, catFilter, setCatFilter, close }) {
  return (
    <Sheet open title="Filters" onClose={close}>
      <div style={st.label}>Account</div>
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        <FilterListRow label="All accounts" active={acctFilter === "all"} onClick={() => setAcctFilter("all")} last={book.accounts.length === 0} />
        {book.accounts.map((a, i) => <FilterListRow key={a.id} label={a.name} active={acctFilter === a.id} onClick={() => setAcctFilter(a.id)} last={i === book.accounts.length - 1} />)}
      </Card>

      <div style={st.label}>Type</div>
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        <FilterListRow label="All types" active={dirFilter === "all"} onClick={() => setDirFilter("all")} />
        <FilterListRow label="Money Out" active={dirFilter === "out"} onClick={() => setDirFilter("out")} />
        <FilterListRow label="Money In" active={dirFilter === "in"} onClick={() => setDirFilter("in")} last />
      </Card>

      {usedCategories.length > 0 && (
        <>
          <div style={st.label}>Category</div>
          <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
            <FilterListRow label="All categories" active={catFilter === "all"} onClick={() => setCatFilter("all")} />
            {usedCategories.map((c, i) => <FilterListRow key={c} label={c} active={catFilter === c} onClick={() => setCatFilter(c)} last={i === usedCategories.length - 1} />)}
          </Card>
        </>
      )}

      <GhostBtn style={{ width: "100%" }} onClick={() => { setAcctFilter("all"); setDirFilter("all"); setCatFilter("all"); }}>Reset Filters</GhostBtn>
    </Sheet>
  );
}

function TransactionsScreen({ book, up, openSheet, openCodeTx, selectMode, setSelectMode }) {
  const [seg, setSeg] = useState("explained");
  const [q, setQ] = useState("");
  const [acctFilter, setAcctFilter] = useState("all");
  const [dirFilter, setDirFilter] = useState("all"); // all | out | in
  const [catFilter, setCatFilter] = useState("all");
  const [selected, setSelected] = useState(() => new Set());
  const accountName = (id) => (book.accounts.find((a) => a.id === id) || {}).name || "—";

  const codable = book.entries.filter((e) => e.type === "in" || e.type === "out");
  const approval = codable.filter((e) => e.pendingApproval).sort((a, b) => b.date.localeCompare(a.date));
  const explained = book.entries
    .filter((e) => (e.type === "in" || e.type === "out" || e.type === "transfer" || e.type === "party") && isExplained(e) && !e.pendingApproval)
    .sort((a, b) => b.date.localeCompare(a.date));
  const unexplained = codable.filter((e) => !e.pendingApproval && !isExplained(e)).sort((a, b) => b.date.localeCompare(a.date));
  const usedCategories = [...new Set(codable.filter((e) => isExplained(e) && !e.pendingApproval).map((e) => e.category))].sort();

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
  const approvalRows = search(filterDir(filterAcct(approval)));
  const activeRows = seg === "unexplained" ? unexplainedRows : seg === "approval" ? approvalRows : [];
  const activeFilterCount = (acctFilter !== "all" ? 1 : 0) + (dirFilter !== "all" ? 1 : 0) + (catFilter !== "all" ? 1 : 0);

  useEffect(() => { setSelectMode(false); setSelected(new Set()); }, [seg]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSelected = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedEntries = activeRows.filter((e) => selected.has(e.id));
  const mixedTypes = new Set(selectedEntries.map((e) => e.type)).size > 1;

  // Select all always resolves to ONE direction, so the result is always
  // codeable in one action without hitting the mixed-direction guard: it
  // respects the direction filter when one is set, otherwise it follows
  // whichever direction the most recent row is.
  const selectAllType = dirFilter !== "all" ? dirFilter : (activeRows[0] ? activeRows[0].type : "out");
  const selectAllRows = activeRows.filter((e) => e.type === selectAllType);
  const allSelectAllSelected = selectAllRows.length > 0 && selectAllRows.every((e) => selected.has(e.id));
  const toggleSelectAll = () => setSelected(allSelectAllSelected ? new Set() : new Set(selectAllRows.map((e) => e.id)));

  const openBulkCode = () => {
    if (selected.size === 0 || mixedTypes) return;
    openSheet("bulkCode", { entryIds: [...selected], onApplied: () => { setSelected(new Set()); setSelectMode(false); } });
  };

  const approveEntry = (id) => up((b) => {
    const idx = b.entries.findIndex((e) => e.id === id);
    if (idx >= 0) b.entries[idx] = { ...b.entries[idx], pendingApproval: false };
    return b;
  });
  const rejectEntry = (id) => up((b) => {
    const idx = b.entries.findIndex((e) => e.id === id);
    if (idx >= 0) b.entries[idx] = { ...b.entries[idx], category: "Suspense", pendingApproval: false };
    return b;
  });
  const bulkApprove = () => {
    up((b) => {
      for (const id of selected) {
        const idx = b.entries.findIndex((e) => e.id === id);
        if (idx >= 0) b.entries[idx] = { ...b.entries[idx], pendingApproval: false };
      }
      return b;
    });
    setSelected(new Set());
    setSelectMode(false);
  };
  const bulkReject = () => {
    up((b) => {
      for (const id of selected) {
        const idx = b.entries.findIndex((e) => e.id === id);
        if (idx >= 0) b.entries[idx] = { ...b.entries[idx], category: "Suspense", pendingApproval: false };
      }
      return b;
    });
    setSelected(new Set());
    setSelectMode(false);
  };

  return (
    <div style={{ padding: "4px 16px 90px" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <input style={{ ...st.input, flex: 1 }} placeholder="Search by name, category, note, date, or amount" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button onClick={() => setQ("")} style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, background: "none", border: "none", cursor: "pointer", flexShrink: 0, fontFamily: F.sans }}>Clear</button>}
      </div>
      <Seg value={seg} onChange={setSeg} style={{ marginBottom: 10 }} options={[
        { v: "explained", label: "Explained" },
        { v: "approval", label: "Approval", badge: approval.length || undefined },
        { v: "unexplained", label: "Unexplained", badge: unexplained.length || undefined },
      ]} />
      <button
        onClick={() => openSheet("txFilters", { acctFilter, setAcctFilter, dirFilter, setDirFilter, catFilter, setCatFilter, usedCategories })}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, padding: "8px 14px", marginBottom: 14, borderRadius: 999, border: `1px solid ${activeFilterCount > 0 ? "transparent" : C.overlayBorder}`, color: activeFilterCount > 0 ? "#fff" : C.muted, background: activeFilterCount > 0 ? C.grad : "none", cursor: "pointer", fontFamily: F.sans }}>
        <Ic name="sliders" size={12} />
        Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
      </button>

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
      ) : seg === "approval" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 2px", gap: 8 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, flex: 1 }}>
              {selectMode ? "Tap to select, then approve or reject them all at once." : "Auto-matched by your coding rules — confirm or reject each one."}
            </div>
            {approvalRows.length > 0 && (
              selectMode ? (
                <button onClick={() => { setSelectMode(false); setSelected(new Set()); }} style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, background: "none", border: "none", cursor: "pointer", flexShrink: 0, fontFamily: F.sans }}>Cancel</button>
              ) : (
                <button onClick={() => setSelectMode(true)} style={{ fontSize: 10.5, fontWeight: 700, color: C.accentText, background: "none", border: "none", cursor: "pointer", flexShrink: 0, fontFamily: F.sans }}>Select</button>
              )
            )}
          </div>
          {selectMode && approvalRows.length > 0 && (
            <button onClick={toggleSelectAll} style={{ fontSize: 10.5, fontWeight: 700, color: C.accentText, background: "none", border: "none", cursor: "pointer", padding: "0 2px 8px", display: "block", fontFamily: F.sans }}>
              {allSelectAllSelected ? "Deselect all" : `Select all — Money ${selectAllType === "out" ? "Out" : "In"}`}
            </button>
          )}
          <Card style={{ padding: "2px 16px" }}>
            {approvalRows.length === 0 && <div style={{ padding: "14px 0", fontSize: 12.5, color: C.muted }}>Nothing waiting for approval.</div>}
            {approvalRows.map((e, i) => {
              const checked = selected.has(e.id);
              return (
                <RowLine key={e.id} last={i === approvalRows.length - 1} onClick={() => (selectMode ? toggleSelected(e.id) : openCodeTx(e.id))}>
                  {selectMode && (
                    <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginRight: 10, display: "flex", alignItems: "center", justifyContent: "center", background: checked ? C.grad : "transparent", border: checked ? "none" : `1px solid ${C.overlayBorder}`, color: "#fff", fontSize: 11, fontWeight: 800 }}>
                      {checked ? "✓" : ""}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.merchant || "Unrecognized transaction"}</div>
                    <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 1 }}>Suggested: {e.category} · {accountName(e.accountId)}</div>
                  </div>
                  {!selectMode && (
                    <div style={{ display: "flex", gap: 6, marginRight: 8, flexShrink: 0 }}>
                      <div onClick={(ev) => { ev.stopPropagation(); rejectEntry(e.id); }} style={{ width: 24, height: 24, borderRadius: "50%", background: C.overlayWash, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="close" size={11} color={C.red} /></div>
                      <div onClick={(ev) => { ev.stopPropagation(); approveEntry(e.id); }} style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(15,106,92,.12)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="check" size={12} color={C.green} /></div>
                    </div>
                  )}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: e.type === "in" ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>{e.type === "in" ? "+" : "−"}{inr(e.amount)}</div>
                    <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 600, marginTop: 1 }}>{e.date}</div>
                  </div>
                </RowLine>
              );
            })}
          </Card>
        </>
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

      {selectMode && selected.size > 0 && seg === "approval" && (
        <div style={{ position: "fixed", left: 16, right: 16, bottom: 82, zIndex: 26, ...glass(16), padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700 }}>{selected.size} selected</div>
          <GhostBtn style={{ width: "auto", padding: "9px 16px" }} onClick={bulkReject}>Reject</GhostBtn>
          <PrimaryBtn style={{ width: "auto", padding: "9px 18px" }} onClick={bulkApprove}>Approve</PrimaryBtn>
        </div>
      )}
      {selectMode && selected.size > 0 && seg === "unexplained" && (
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
// Matches the design handoff's own period-navigation model: a period type
// (Month / Quarter / Financial Year / Custom) plus an integer offset from
// today's period, with quick chips to step back through recent periods --
// not a raw FY/month <select> pair.
function usePeriodPicker(book) {
  const t = today();
  // Defaulting to "this month" silently shows nothing for a book whose data
  // is all in the past (e.g. everything just imported from an old
  // statement) -- default to whichever month the most recent entry is
  // actually in instead, only landing on the real current month when that
  // happens to be where the data is.
  const latestEntryDate = useMemo(() => {
    let max = null;
    for (const e of book.entries) if (!max || e.date > max) max = e.date;
    return max || t;
  }, [book.entries, t]);
  const monthsBack = (t.slice(0, 4) - latestEntryDate.slice(0, 4)) * 12 + (+t.slice(5, 7) - +latestEntryDate.slice(5, 7));

  const [periodType, setPeriodType] = useState("month");
  const [offset, setOffset] = useState(Math.max(0, monthsBack));
  const [customFrom, setCustomFrom] = useState(t.slice(0, 8) + "01");
  const [customTo, setCustomTo] = useState(t);
  const [compare, setCompare] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const setType = (v) => { setPeriodType(v); setOffset(0); };

  const range = periodType === "custom"
    ? { from: customFrom, to: customTo, label: `${customFrom} – ${customTo}` }
    : periodByOffset(periodType, offset, t);
  const prevRange = previousPeriod(periodType, offset, customFrom, customTo, t);

  return {
    periodType, setType, offset, setOffset,
    customFrom, setCustomFrom, customTo, setCustomTo,
    compare, setCompare, pickerOpen, setPickerOpen,
    from: range.from, to: range.to, label: range.label,
    prevFrom: prevRange.from, prevTo: prevRange.to, prevLabel: prevRange.label,
    t,
  };
}

function PeriodPicker(p) {
  const periodTypeOptions = [["month", "Month"], ["quarter", "Quarter"], ["fy", "Financial Year"], ["custom", "Custom"]];
  const quickOffsets = p.periodType === "fy" ? [0, 1] : [0, 1, 2, 3];
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ ...glass(16), display: "flex", alignItems: "center", padding: "10px 12px", gap: 10 }}>
        <div onClick={() => p.setPickerOpen(!p.pickerOpen)} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, cursor: "pointer" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
          <Ic name="chevronDown" size={12} color={C.muted} style={{ flexShrink: 0 }} />
        </div>
        <div style={{ width: 1, height: 20, background: C.line, flexShrink: 0 }} />
        <div onClick={() => p.setCompare(!p.compare)} style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, cursor: "pointer" }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: C.soft, whiteSpace: "nowrap" }}>Compare</span>
          <Toggle value={p.compare} onChange={p.setCompare} />
        </div>
      </div>

      {p.pickerOpen && (
        <div style={{ ...glass(16), padding: 10, marginTop: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {periodTypeOptions.map(([v, label]) => (
              <div key={v} onClick={() => p.setType(v)} style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 600, padding: "6px 11px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", background: p.periodType === v ? C.accent : C.overlayWash, color: p.periodType === v ? "#fff" : C.soft }}>{label}</div>
            ))}
          </div>
          {p.periodType === "custom" ? (
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: C.faint, marginBottom: 3 }}>From</div>
                <input type="date" value={p.customFrom} onChange={(e) => p.setCustomFrom(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.overlayBorder}`, borderRadius: 8, padding: "6px 8px", fontFamily: F.sans, fontSize: 10.5, color: C.ink, background: "#fff" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: C.faint, marginBottom: 3 }}>To</div>
                <input type="date" value={p.customTo} onChange={(e) => p.setCustomTo(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.overlayBorder}`, borderRadius: 8, padding: "6px 8px", fontFamily: F.sans, fontSize: 10.5, color: C.ink, background: "#fff" }} />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {quickOffsets.map((o) => {
                const r = periodByOffset(p.periodType, o, p.t);
                return <div key={o} onClick={() => p.setOffset(o)} style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 500, padding: "5px 10px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", background: p.offset === o ? C.accent : C.overlayWash, color: p.offset === o ? "#fff" : C.soft }}>{r.label}</div>;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Prev-period delta as a "+12%"/"−8%" label, matching the design handoff's
// own rptVals pctDelta exactly (including its zero-previous special case).
function pctDelta(cur, prev) {
  if (prev === 0) return cur === 0 ? "0%" : cur > 0 ? "+100%" : "−100%";
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return (pct >= 0 ? "+" : "−") + Math.abs(pct) + "%";
}

// Shared read-only row used by the report drill-down sheet -- description
// (the imported merchant text or a manually-typed note) is the primary
// line since the category/party grouping is already known from context
// (it's the sheet's own title), account is secondary, amount+date sit
// right-aligned matching every other transaction list in the app.
function reportDetailRowInfo(book, e) {
  const accountName = (id) => (book.accounts.find((a) => a.id === id) || {}).name || "—";
  const partyName = (id) => (book.parties.find((p) => p.id === id) || {}).name || "Unknown";
  if (e.type === "party") {
    const out = e.dir === "out";
    return {
      title: e.merchant || e.note || (out ? `Paid ${partyName(e.partyId)}` : `Received from ${partyName(e.partyId)}`),
      sub: accountName(e.accountId), sign: out ? "−" : "+", color: out ? C.red : C.green,
    };
  }
  return {
    title: e.merchant || e.note || e.category,
    sub: accountName(e.accountId), sign: e.type === "in" ? "+" : "−", color: e.type === "in" ? C.green : C.red,
  };
}

function CategoryDetailSheet({ book, title, entries, close }) {
  const rows = (entries || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Sheet open title={title} onClose={close}>
      <Card style={{ padding: "2px 16px" }}>
        {rows.length === 0 && <div style={{ padding: "14px 0", fontSize: 12.5, color: C.muted }}>No transactions in this period.</div>}
        {rows.map((e, i) => {
          const info = reportDetailRowInfo(book, e);
          return (
            <RowLine key={e.id} last={i === rows.length - 1}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{info.title}</div>
                <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 1 }}>{info.sub}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: info.color, fontVariantNumeric: "tabular-nums" }}>{info.sign}{inr(e.amount)}</div>
                <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 600, marginTop: 1 }}>{e.date}</div>
              </div>
            </RowLine>
          );
        })}
      </Card>
    </Sheet>
  );
}

/* Report table rows -- built to match the design handoff's own markup
   exactly: a 3-column layout (category / current-period / previous-period,
   the last only when Compare is on), plain (uncolored) amounts at the row
   and section-total level, and dynamic teal/maroon color reserved for the
   Net Profit / Net Cash Flow lines only. */
const rptSectionLabel = { fontSize: 10.5, fontWeight: 700, color: C.soft, textTransform: "uppercase", letterSpacing: ".04em", padding: "10px 0 2px" };
const rptEmpty = { fontSize: 11, color: C.muted, padding: "6px 0" };
function magInr(n) { return inr(Math.abs(n)); }
function plusInr(n) { return "+" + magInr(n); }
function minusInr(n) { return "−" + magInr(n); }
function signedInr(n) { return (n < 0 ? "−" : "+") + magInr(n); }

function RptRow({ label, onClick, current, prev, compare }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${C.line}` }}>
      <span onClick={onClick} style={{ flex: 1, fontSize: 12, minWidth: 0, cursor: onClick ? "pointer" : "default", display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {onClick && <Ic name="back" size={9} color={C.faint} style={{ transform: "rotate(180deg)", flexShrink: 0 }} />}
      </span>
      <span style={{ width: 78, textAlign: "right", fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}>{current}</span>
      {compare && <span style={{ width: 78, textAlign: "right", fontSize: 11, color: C.faint, flexShrink: 0 }}>{prev}</span>}
    </div>
  );
}
function RptTotalRow({ label, current, prev, compare, delta, deltaMarginBottom }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", padding: "9px 0", borderTop: `1px solid ${C.line}`, marginTop: 2 }}>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>{label}</span>
        <span style={{ width: 78, textAlign: "right", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{current}</span>
        {compare && <span style={{ width: 78, textAlign: "right", fontSize: 11, color: C.faint, flexShrink: 0 }}>{prev}</span>}
      </div>
      {compare && <div style={{ textAlign: "right", fontSize: 10, color: C.soft, marginBottom: deltaMarginBottom }}>{delta} vs previous period</div>}
    </>
  );
}
function RptNetRow({ label, current, prev, compare, color, delta, fontSize1, fontSize2, padding }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", padding: padding, borderTop: `2px solid ${C.overlayStrong}`, marginTop: 4 }}>
        <span style={{ flex: 1, fontSize: fontSize1, fontWeight: 700 }}>{label}</span>
        <span style={{ width: 78, textAlign: "right", fontSize: fontSize2, fontWeight: 700, color, flexShrink: 0 }}>{current}</span>
        {compare && <span style={{ width: 78, textAlign: "right", fontSize: 11, color: C.faint, flexShrink: 0 }}>{prev}</span>}
      </div>
      {compare && delta != null && <div style={{ textAlign: "right", fontSize: 10, color: C.soft }}>{delta} vs previous period</div>}
    </>
  );
}
function RptBalanceRow({ label, current, prev, compare, border, padding, fontSize }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding, borderBottom: border ? `1px solid ${C.line}` : "none" }}>
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>{label}</span>
      <span style={{ width: 78, textAlign: "right", fontSize: fontSize || 13, fontWeight: 700, flexShrink: 0 }}>{current}</span>
      {compare && <span style={{ width: 78, textAlign: "right", fontSize: 11, color: C.faint, flexShrink: 0 }}>{prev}</span>}
    </div>
  );
}
function ExportPills({ onExcel, onPdf }) {
  const [flash, setFlash] = useState(null);
  const fire = (kind, fn) => { fn(); setFlash(kind); setTimeout(() => setFlash((k) => (k === kind ? null : k)), 1600); };
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      <div onClick={() => fire("excel", onExcel)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", borderRadius: 12, background: "rgba(15,106,92,.08)", color: C.green, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
        <Ic name="upload" size={13} color={C.green} />{flash === "excel" ? "Exported ✓" : "Export Excel"}
      </div>
      <div onClick={() => fire("pdf", onPdf)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", borderRadius: 12, background: "rgba(122,46,59,.08)", color: "#7a2e3b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
        <Ic name="upload" size={13} color="#7a2e3b" />{flash === "pdf" ? "Exported ✓" : "Export PDF"}
      </div>
    </div>
  );
}

function PLReport({ book, p, openSheet }) {
  const pl = computePL(book, p.from, p.to);
  const prevPl = p.compare ? computePL(book, p.prevFrom, p.prevTo) : null;
  const income = Object.entries(pl.income).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const expense = Object.entries(pl.expense).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const inRange = (e) => e.date >= p.from && e.date <= p.to && isExplained(e);
  const openCategory = (title, entries) => openSheet("categoryDetail", { title, entries });

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
      <ExportPills onExcel={downloadCsv} onPdf={() => window.print()} />

      <div style={{ ...glass(16), padding: "4px 14px 14px" }}>
        <div style={{ display: "flex", alignItems: "baseline", paddingTop: 10, paddingBottom: 6, borderBottom: `1px solid ${C.overlayBorder}` }}>
          <span style={{ flex: 1, fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: ".04em" }}>Category</span>
          <span style={{ width: 78, textAlign: "right", fontSize: 9.5, color: C.faint, textTransform: "uppercase" }}>{p.label}</span>
          {p.compare && <span style={{ width: 78, textAlign: "right", fontSize: 9.5, color: C.faint, textTransform: "uppercase" }}>{p.prevLabel}</span>}
        </div>

        <div style={rptSectionLabel}>Income</div>
        {income.length === 0 && <div style={rptEmpty}>No income recorded</div>}
        {income.map(([c, a]) => (
          <RptRow key={c} label={c} compare={p.compare}
            current={plusInr(a)} prev={prevPl ? plusInr(prevPl.income[c] || 0) : null}
            onClick={() => openCategory(c, book.entries.filter((e) => inRange(e) && e.type === "in" && e.category === c && !isRefund(book, e)))} />
        ))}
        <RptTotalRow label="Total Income" compare={p.compare} deltaMarginBottom={6}
          current={plusInr(pl.totalIncome)} prev={prevPl ? plusInr(prevPl.totalIncome) : null}
          delta={prevPl ? pctDelta(pl.totalIncome, prevPl.totalIncome) : null} />

        <div style={rptSectionLabel}>Expenses</div>
        {expense.length === 0 && <div style={rptEmpty}>No expenses recorded</div>}
        {expense.map(([c, a]) => (
          <RptRow key={c} label={c} compare={p.compare}
            current={minusInr(a)} prev={prevPl ? minusInr(prevPl.expense[c] || 0) : null}
            onClick={() => openCategory(c, book.entries.filter((e) => inRange(e) && e.category === c && (e.type === "out" || isRefund(book, e))))} />
        ))}
        <RptTotalRow label="Total Expenses" compare={p.compare} deltaMarginBottom={8}
          current={minusInr(pl.totalExpense)} prev={prevPl ? minusInr(prevPl.totalExpense) : null}
          delta={prevPl ? pctDelta(pl.totalExpense, prevPl.totalExpense) : null} />

        <RptNetRow label="Net Profit" compare={p.compare} fontSize1={13.5} fontSize2={14} padding="12px 0 4px"
          current={signedInr(pl.net)} prev={prevPl ? signedInr(prevPl.net) : null}
          color={pl.net < 0 ? "#7a2e3b" : C.green} delta={prevPl ? pctDelta(pl.net, prevPl.net) : null} />
      </div>
    </div>
  );
}

// Matches the design handoff exactly: a literal running ledger (Opening ->
// Money In -> Money Out -> Other Movement -> Net -> Closing) inside a
// single continuous card, instead of a P&L/Balance-Sheet bifurcation.
function CashFlowReport({ book, p, openSheet }) {
  const cf = computeCashFlow(book, p.from, p.to);
  const prevCf = p.compare ? computeCashFlow(book, p.prevFrom, p.prevTo) : null;
  const prevIn = prevCf ? Object.fromEntries(prevCf.moneyIn.map((r) => [r.category, r.amount])) : null;
  const prevOut = prevCf ? Object.fromEntries(prevCf.moneyOut.map((r) => [r.category, r.amount])) : null;
  const prevOther = prevCf ? Object.fromEntries(prevCf.other.map((r) => [r.label, r.amount])) : null;
  const inRange = (e) => e.date >= p.from && e.date <= p.to && isExplained(e);
  const openCategory = (title, entries) => openSheet("categoryDetail", { title, entries });

  const downloadCsv = () => {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [["Section", "Line", "Amount"].map(esc).join(",")];
    lines.push(["", "Opening Balance", cf.opening].map(esc).join(","));
    for (const r of cf.moneyIn) lines.push(["Money In", r.category, r.amount].map(esc).join(","));
    lines.push(["Money In", "Total", cf.totalIn].map(esc).join(","));
    for (const r of cf.moneyOut) lines.push(["Money Out", r.category, -r.amount].map(esc).join(","));
    lines.push(["Money Out", "Total", -cf.totalOut].map(esc).join(","));
    for (const r of cf.other) lines.push(["Other Movement", r.label, r.amount].map(esc).join(","));
    lines.push(["Other Movement", "Total", cf.totalOther].map(esc).join(","));
    lines.push(["", "Net Cash Flow", cf.net].map(esc).join(","));
    lines.push(["", "Closing Balance", cf.closing].map(esc).join(","));
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
      <ExportPills onExcel={downloadCsv} onPdf={() => window.print()} />

      <div style={{ ...glass(16), padding: "4px 14px 14px" }}>
        <RptBalanceRow label="Opening Balance" compare={p.compare} border padding="10px 0"
          current={magInr(cf.opening)} prev={prevCf ? magInr(prevCf.opening) : null} />

        <div style={rptSectionLabel}>Money In</div>
        {cf.moneyIn.length === 0 && <div style={rptEmpty}>No money in recorded</div>}
        {cf.moneyIn.map((r) => (
          <RptRow key={r.category} label={r.category} compare={p.compare}
            current={plusInr(r.amount)} prev={prevIn ? plusInr(prevIn[r.category] || 0) : null}
            onClick={() => openCategory(r.category, book.entries.filter((e) => inRange(e) && e.type === "in" && e.category === r.category && !isRefund(book, e)))} />
        ))}
        <RptTotalRow label="Total Money In" compare={p.compare} deltaMarginBottom={6}
          current={plusInr(cf.totalIn)} prev={prevCf ? plusInr(prevCf.totalIn) : null}
          delta={prevCf ? pctDelta(cf.totalIn, prevCf.totalIn) : null} />

        <div style={rptSectionLabel}>Money Out</div>
        {cf.moneyOut.length === 0 && <div style={rptEmpty}>No money out recorded</div>}
        {cf.moneyOut.map((r) => (
          <RptRow key={r.category} label={r.category} compare={p.compare}
            current={minusInr(r.amount)} prev={prevOut ? minusInr(prevOut[r.category] || 0) : null}
            onClick={() => openCategory(r.category, book.entries.filter((e) => inRange(e) && e.category === r.category && (e.type === "out" || isRefund(book, e))))} />
        ))}
        <RptTotalRow label="Total Money Out" compare={p.compare} deltaMarginBottom={8}
          current={minusInr(cf.totalOut)} prev={prevCf ? minusInr(prevCf.totalOut) : null}
          delta={prevCf ? pctDelta(cf.totalOut, prevCf.totalOut) : null} />

        <div style={rptSectionLabel}>Other Movement</div>
        {cf.other.length === 0 && <div style={rptEmpty}>No other movements recorded</div>}
        {cf.other.map((r) => (
          <RptRow key={r.label} compare={p.compare}
            label={<>{r.label}{r.bs && <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: "rgba(251,191,36,.18)", border: "1px solid rgba(251,191,36,.4)", color: C.amberText, marginLeft: 6 }}>BS</span>}</>}
            current={signedInr(r.amount)} prev={prevOther ? signedInr(prevOther[r.label] || 0) : null}
            onClick={() => openCategory(r.label, book.entries.filter((e) => r.partyIds
              ? (inRange(e) && e.type === "party" && r.partyIds.includes(e.partyId))
              : (inRange(e) && e.category === r.label && (e.type === "out" || e.type === "in"))))} />
        ))}
        <RptTotalRow label="Total Other Movement" compare={p.compare} deltaMarginBottom={8}
          current={signedInr(cf.totalOther)} prev={prevCf ? signedInr(prevCf.totalOther) : null}
          delta={prevCf ? pctDelta(cf.totalOther, prevCf.totalOther) : null} />

        <RptNetRow label="Net Cash Flow" compare={p.compare} fontSize1={13} fontSize2={13.5} padding="10px 0" delta={null}
          current={signedInr(cf.net)} prev={prevCf ? signedInr(prevCf.net) : null}
          color={cf.net < 0 ? "#7a2e3b" : C.green} />
        <RptBalanceRow label="Closing Balance" compare={p.compare} border={false} padding="10px 0 4px" fontSize={14}
          current={magInr(cf.closing)} prev={prevCf ? magInr(prevCf.closing) : null} />
      </div>
    </div>
  );
}

const RPT_INFO = {
  pl: {
    title: "About the P&L report",
    paragraphs: [
      "The Profit & Loss report shows how much your business earned and spent in the selected period, grouped by category.",
      "Income lists money earned from sales, services, interest and other income categories. Expenses lists everything spent on running the business.",
      "Net Profit is Total Income minus Total Expenses. Transfers between your own accounts, loan repayments, asset purchases and similar items are excluded — this report reflects trading performance only.",
      "Turn on Compare to see the previous period's figures and the change alongside each line.",
    ],
  },
  cashflow: {
    title: "About the Cash Flow report",
    paragraphs: [
      "The Cash Flow report tracks money that actually moved in and out of your accounts in the selected period.",
      "Money In and Money Out mirror the Income and Expenses from your P&L. Other Movement covers everything else — transfers between accounts, loan repayments, asset purchases and similar items — which can add to or subtract from cash depending on the transaction.",
      "Opening Balance plus Money In, Money Out and Other Movement gives the Closing Balance for the period.",
      "Turn on Compare to see the previous period's figures alongside each line.",
    ],
  },
};

function ReportsScreen({ book, openSheet }) {
  const [view, setView] = useState("pl");
  const [infoOpen, setInfoOpen] = useState(false);
  const p = usePeriodPicker(book);
  const info = RPT_INFO[view];
  return (
    <div style={{ padding: "4px 16px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Reports</div>
        <RoundBtn onClick={() => setInfoOpen(true)}><Ic name="info" size={15} color={C.soft} /></RoundBtn>
      </div>
      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title={info.title}>
        {info.paragraphs.map((t, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: C.soft, marginBottom: 8 }}>{t}</div>)}
        <PrimaryBtn style={{ marginTop: 8 }} onClick={() => setInfoOpen(false)}>Got it</PrimaryBtn>
      </Modal>
      <Seg value={view} onChange={setView} style={{ marginBottom: 10 }} options={[{ v: "pl", label: "P&L" }, { v: "cashflow", label: "Cash Flow" }]} />
      {view === "pl" ? <PLReport book={book} p={p} openSheet={openSheet} /> : <CashFlowReport book={book} p={p} openSheet={openSheet} />}
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
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        <SetupRow title="Profile" sub={book.prefs.name || "Add your name"} onClick={() => openSheet("setupProfile")} last />
      </Card>
      <Card style={{ padding: "2px 16px" }}>
        <SetupRow title="Accounts" sub={`${book.accounts.length} account${book.accounts.length === 1 ? "" : "s"}`} onClick={openAccountsPage} />
        <SetupRow title="Categories" sub={`${book.categories.expense.filter((c) => c !== "Suspense").length} categories`} onClick={() => openSheet("setupCategories")} />
        <SetupRow title="Income Categories" sub={`${book.categories.income.length} categor${book.categories.income.length === 1 ? "y" : "ies"}`} onClick={() => openSheet("setupIncomeCategories")} />
        <SetupRow title="Balance Sheet Categories" sub={`${book.bsCategories.length} categor${book.bsCategories.length === 1 ? "y" : "ies"}`} onClick={() => openSheet("setupBsCategories")} />
        <SetupRow title="Auto-coding Rules" sub={`${book.codingRules.length} rules`} onClick={() => openSheet("setupRules")} />
        <SetupRow title="Import & OCR" sub="Upload PDFs or photos" onClick={() => openSheet("import")} />
        <SetupRow title="Security & App Lock" sub={book.prefs.lock.on ? "PIN lock is on" : "PIN lock is off"} onClick={() => openSheet("setupPrefs")} />
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

function SetupIncomeCategoriesSheet({ book, up, close }) {
  const cats = book.categories.income;
  return (
    <Sheet open title="Income Categories" onClose={close}>
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 10 }}>Where money-in transactions get coded — these count toward P&amp;L too.</div>
      <Card style={{ padding: "2px 16px", marginBottom: 14 }}>
        {cats.map((c, i) => (
          <RowLine key={c} last={i === cats.length - 1}>
            <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{c}</div>
            <RoundBtn onClick={() => {
              if (!confirmCategoryDelete(book, c)) return;
              up((b) => { b.categories.income = b.categories.income.filter((x) => x !== c); return b; });
            }}><Ic name="close" size={12} /></RoundBtn>
          </RowLine>
        ))}
        {cats.length === 0 && <div style={{ padding: "12px 0", fontSize: 12.5, color: C.muted }}>No income categories yet.</div>}
      </Card>
      <AddInline placeholder="New income category name" onAdd={(name) => up((b) => { if (!b.categories.income.includes(name)) b.categories.income.push(name); return b; })} />
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

function ProfileSheet({ book, up, close }) {
  const [name, setName] = useState(book.prefs.name || "");
  return (
    <Sheet open title="Profile" onClose={close}>
      <div style={st.label}>Your name</div>
      <input style={st.input} placeholder="e.g. Asha" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginTop: 8 }}>Shown on Home. Never leaves this device.</div>
      <PrimaryBtn style={{ marginTop: 16 }} onClick={() => { up((b) => { b.prefs.name = name.trim(); return b; }); close(); }}>Save</PrimaryBtn>
    </Sheet>
  );
}

function SetupPrefsSheet({ book, up, close }) {
  const [pin, setPin] = useState(book.prefs.lock.pin || "");
  return (
    <Sheet open title="Preferences" onClose={close}>
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
// A searchable, tappable category list -- replaces the plain <select> for
// Add Transaction's Expense/Income/Refund pickers, matching the mockup.
function CategoryPickList({ items, value, onChange, maxHeight }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle ? items.filter((it) => it.label.toLowerCase().includes(needle)) : items;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 11px", border: `1px solid ${C.overlayBorder}`, borderRadius: 10, marginBottom: 8 }}>
        <Ic name="search" size={13} color={C.faint} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search categories" style={{ flex: 1, minWidth: 0, border: "none", outline: "none", fontFamily: F.sans, fontSize: 12, background: "none", color: C.ink }} />
      </div>
      <div style={{ maxHeight: maxHeight || 150, overflowY: "auto", marginBottom: 8 }}>
        {filtered.map((it) => (
          <div key={it.value} onClick={() => onChange(it.value)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 10px", borderRadius: 10, cursor: "pointer", background: value === it.value ? C.accentSoft : "transparent" }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: value === it.value ? 700 : 500, color: value === it.value ? C.accent : C.ink }}>{it.label}</span>
            {it.isBS && <span style={{ fontSize: 8.5, fontWeight: 800, padding: "2px 6px", borderRadius: 999, background: "rgba(166,116,28,.14)", color: C.amberText, flexShrink: 0 }}>BS</span>}
            {value === it.value && <Ic name="check" size={13} color={C.accent} style={{ flexShrink: 0 }} />}
          </div>
        ))}
        {filtered.length === 0 && <div style={{ padding: "10px 4px", fontSize: 11.5, color: C.muted }}>No matches.</div>}
      </div>
    </div>
  );
}

// A flat "label / value" row, for the compact Account & Date summary rows
// the mockup shows beneath each picker instead of full form fields.
function SummaryRow({ label, children, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: last ? "none" : `1px solid ${C.line}` }}>
      <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );
}
const rowSelectStyle = { border: "none", outline: "none", background: "none", fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink, textAlign: "right", cursor: "pointer" };

// Add Transaction: rebuilt around the mockup's 4-tab shape (Expense / Income
// / Transfer / Settle owed) instead of the old Direction+Type grid. Splitting
// a payment into a Balance Sheet category is intentionally not offered here
// (the mockup only supports splitting with a person) -- Code Transaction
// still has that power-user option for imported rows.
function NewTransactionSheet({ book, up, close, preset }) {
  const [tab, setTab] = useState((preset && preset.tab) || "expense");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());

  const firstAccountId = (book.accounts[0] || {}).id || "";
  const secondAccountId = (book.accounts[1] || book.accounts[0] || {}).id || "";

  const [expCategory, setExpCategory] = useState(() => book.categories.expense.find((c) => c !== "Suspense") || book.bsCategories[0] || "");
  const [expAccountId, setExpAccountId] = useState(firstAccountId);
  const [splitOn, setSplitOn] = useState(false);
  const [splitPartyId, setSplitPartyId] = useState(book.parties[0] ? book.parties[0].id : "");

  const [incomeMode, setIncomeMode] = useState("income"); // income | refund
  const [incCategory, setIncCategory] = useState(book.categories.income[0] || "");
  const [refundFor, setRefundFor] = useState(book.categories.expense.find((c) => c !== "Suspense") || "");
  const [incAccountId, setIncAccountId] = useState(firstAccountId);

  const [fromAccountId, setFromAccountId] = useState(firstAccountId);
  const [toAccountId, setToAccountId] = useState(secondAccountId);

  const [owedMode, setOwedMode] = useState((preset && preset.owedMode) || "receive"); // receive | pay
  const [owedPartyId, setOwedPartyId] = useState(book.parties[0] ? book.parties[0].id : "");
  const [owedAccountId, setOwedAccountId] = useState(firstAccountId);

  const expenseCatItems = [
    ...book.categories.expense.filter((c) => c !== "Suspense").map((c) => ({ value: c, label: c })),
    ...book.bsCategories.map((c) => ({ value: c, label: c, isBS: true })),
  ];
  const incomeCatItems = book.categories.income.map((c) => ({ value: c, label: c }));
  const refundCatItems = book.categories.expense.filter((c) => c !== "Suspense").map((c) => ({ value: c, label: c }));

  const amt = parseAmount(amount) || 0;
  const transferInvalid = tab === "transfer" && fromAccountId === toAccountId;

  const save = () => {
    if (!amt || amt <= 0 || transferInvalid) return;
    up((b) => {
      if (tab === "expense") {
        b.entries.push({ id: uid(), date, amount: amt, type: "out", category: expCategory, accountId: expAccountId, note });
        // Full amount is your own expense; the other half is a receivable
        // (dir "out" -- see owedAsOf: money conceptually went to them, so
        // their balance rises and they now owe you back).
        if (splitOn && splitPartyId) {
          b.entries.push({ id: uid(), date, amount: Math.round(amt / 2), type: "party", partyId: splitPartyId, accountId: expAccountId, dir: "out", note: note || "Split expense" });
        }
      } else if (tab === "income") {
        b.entries.push({ id: uid(), date, amount: amt, type: "in", category: incomeMode === "refund" ? refundFor : incCategory, accountId: incAccountId, note });
      } else if (tab === "transfer") {
        b.entries.push({ id: uid(), date, amount: amt, type: "transfer", fromAccountId, toAccountId, note });
      } else if (tab === "owed") {
        b.entries.push({ id: uid(), date, amount: amt, type: "party", partyId: owedPartyId, accountId: owedAccountId, dir: owedMode === "receive" ? "out" : "in", note });
      }
      return b;
    });
    close();
  };

  if (book.accounts.length === 0) {
    return <Sheet open title="Add transaction" onClose={close}><div style={{ fontSize: 13, color: C.muted }}>Add an account first, in Setup ▸ Accounts.</div></Sheet>;
  }

  const AccountDateCard = ({ accountId, setAccountId, accountLabel }) => (
    <Card style={{ padding: "2px 14px", marginBottom: 12 }}>
      <SummaryRow label={accountLabel || "Account"}>
        <select style={rowSelectStyle} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {book.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </SummaryRow>
      <SummaryRow label="Date" last>
        <input type="date" style={rowSelectStyle} value={date} onChange={(e) => setDate(e.target.value)} />
      </SummaryRow>
    </Card>
  );

  return (
    <Sheet open title="Add transaction" onClose={close}>
      <Seg value={tab} onChange={setTab} style={{ marginBottom: 14 }} wrap4 options={[
        { v: "expense", label: "Expense" }, { v: "income", label: "Income" },
        { v: "transfer", label: "Transfer" }, { v: "owed", label: "Settle owed" },
      ]} />

      {tab !== "owed" && (
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 28, fontWeight: 700 }}>₹<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" style={{ border: "none", outline: "none", fontFamily: F.sans, fontSize: 28, fontWeight: 700, width: 150, textAlign: "center", background: "none", color: C.ink }} /></span>
        </div>
      )}

      {tab === "expense" && (
        <div>
          <div style={st.label}>Category</div>
          <CategoryPickList items={expenseCatItems} value={expCategory} onChange={setExpCategory} />
          <AccountDateCard accountId={expAccountId} setAccountId={setExpAccountId} />
          <input style={st.input} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
          <Card style={{ marginTop: 12, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Split with someone</span>
              <Toggle value={splitOn} onChange={setSplitOn} />
            </div>
            {splitOn && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
                <PartySelect book={book} up={up} value={splitPartyId} onChange={setSplitPartyId} />
                {splitPartyId && amt > 0 && (
                  <div style={{ fontSize: 11.5, color: C.accent, fontWeight: 600, marginTop: 8 }}>
                    {(book.parties.find((p) => p.id === splitPartyId) || {}).name} owes you {inr(Math.round(amt / 2))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "income" && (
        <div>
          <Seg value={incomeMode} onChange={setIncomeMode} style={{ marginBottom: 14 }} options={[{ v: "income", label: "Income" }, { v: "refund", label: "Refund" }]} />
          {incomeMode === "refund" ? (
            <>
              <div style={st.label}>Which expense is this refunding?</div>
              <CategoryPickList items={refundCatItems} value={refundFor} onChange={setRefundFor} />
            </>
          ) : (
            <>
              <div style={st.label}>Category</div>
              <CategoryPickList items={incomeCatItems} value={incCategory} onChange={setIncCategory} />
            </>
          )}
          <AccountDateCard accountId={incAccountId} setAccountId={setIncAccountId} />
          <input style={st.input} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}

      {tab === "transfer" && (
        <div>
          <Card style={{ padding: "2px 14px", marginBottom: 12 }}>
            <SummaryRow label="From account">
              <select style={rowSelectStyle} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
                {book.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </SummaryRow>
            <SummaryRow label="To account">
              <select style={rowSelectStyle} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                {book.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </SummaryRow>
            <SummaryRow label="Date" last>
              <input type="date" style={rowSelectStyle} value={date} onChange={(e) => setDate(e.target.value)} />
            </SummaryRow>
          </Card>
          {transferInvalid && <div style={{ fontSize: 11, color: C.red, fontWeight: 600, marginBottom: 8 }}>From and To accounts must be different.</div>}
          <input style={st.input} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}

      {tab === "owed" && (
        <div>
          <Seg value={owedMode} onChange={setOwedMode} style={{ marginBottom: 14 }} options={[{ v: "receive", label: "You'll receive" }, { v: "pay", label: "You'll pay" }]} />
          <div style={st.label}>Person</div>
          <PartySelect book={book} up={up} value={owedPartyId} onChange={setOwedPartyId} />
          <div style={{ textAlign: "center", margin: "16px 0" }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", marginBottom: 4 }}>{owedMode === "receive" ? "They'll owe you" : "You'll owe them"}</div>
            <span style={{ fontSize: 24, fontWeight: 700 }}>₹<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" style={{ border: "none", outline: "none", fontFamily: F.sans, fontSize: 24, fontWeight: 700, width: 110, textAlign: "center", background: "none", color: C.ink }} /></span>
          </div>
          <Card style={{ padding: "2px 14px", marginBottom: 12 }}>
            <SummaryRow label="Account" last>
              <select style={rowSelectStyle} value={owedAccountId} onChange={(e) => setOwedAccountId(e.target.value)}>
                {book.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </SummaryRow>
          </Card>
          <input style={st.input} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}

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
  // "Description" is the transaction's own identifying text: the raw
  // bank-statement narration for an imported row (entry.merchant, which
  // survives coding untouched), falling back to whatever note was typed in
  // for a manually-added row. Direction is dropped as a separate row --
  // it's already conveyed by the amount's sign/color below, and Type
  // already implies it (Income/Expense/Party to Pay/Party to Receive).
  const description = entry.merchant || entry.note || "";
  const amountSign = entry.type === "transfer" ? null : (entry.type === "in" || (entry.type === "party" && entry.dir === "in")) ? "+" : "−";
  const amountColor = amountSign === "+" ? C.green : amountSign === "−" ? C.red : C.ink;

  const rows = [];
  if (description) rows.push(["Description", description]);
  if (entry.type === "transfer") {
    rows.push(["Type", "Transfer"]);
    rows.push(["From Account", accountName(entry.fromAccountId)]);
    rows.push(["To Account", accountName(entry.toAccountId)]);
  } else if (entry.type === "party") {
    rows.push(["Type", entry.dir === "out" ? "Party to Pay" : "Party to Receive"]);
    rows.push(["Party", partyName(entry.partyId)]);
    rows.push(["Account", accountName(entry.accountId)]);
  } else {
    rows.push(["Type", refund ? "Refund" : entry.type === "in" ? "Income" : "Expense"]);
    rows.push(["Category", entry.category]);
    rows.push(["Account", accountName(entry.accountId)]);
  }
  rows.push(["Date", entry.date]);

  return (
    <Sheet open title="Transaction Details" onClose={close}>
      <Card style={{ padding: "13px 15px", marginBottom: 14 }}>
        <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>Amount</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: amountColor, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{amountSign || ""}{inr(entry.amount)}</div>
      </Card>
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
        b.entries[idx] = { ...base, category: f.category, pendingApproval: false };
      } else if (subKind === "refund") {
        b.entries[idx] = { ...base, category: f.refundFor, pendingApproval: false };
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
  const [refundFor, setRefundFor] = useState(() => book.categories.expense.find((c) => c !== "Suspense") || "");
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
          b.entries[idx] = { ...base, category, pendingApproval: false };
        } else if (subKind === "refund") {
          b.entries[idx] = { ...base, category: refundFor, pendingApproval: false };
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
    : [["category", "Income"], ["refund", "Refund"], ["party", "Party to Receive"], ["transfer", "Transfer"]];

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
          <Seg value={subKind} onChange={setSubKind} wrap4={!debit} options={KINDS.map(([v, label]) => ({ v, label }))} />
          {subKind === "category" && (
            <>
              <div style={st.label}>Category</div>
              <CategorySelect book={book} value={category} onChange={setCategory} direction={debit ? "out" : "in"} />
            </>
          )}
          {subKind === "refund" && (
            <>
              <div style={st.label}>Refund For</div>
              <select style={st.input} value={refundFor} onChange={(e) => setRefundFor(e.target.value)}>
                {book.categories.expense.filter((c) => c !== "Suspense").map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={{ fontSize: 10, color: C.accentText, fontWeight: 600, marginTop: 6 }}>Refunds reduce that category's spend this month instead of counting as new income.</div>
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

/* ══════════════════════════ RECORD PAYMENT / IMPORT ══════════════════════════ */
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

function ImportSheet({ book, up, close }) {
  const bankAccounts = book.accounts.filter((a) => a.kind === "bank");
  const cardAccounts = book.accounts.filter((a) => a.kind === "card");
  const [kind, setKind] = useState(bankAccounts.length > 0 || cardAccounts.length === 0 ? "bank" : "card");
  const list = kind === "bank" ? bankAccounts : cardAccounts;
  const [accountId, setAccountId] = useState((list[0] || {}).id || "");
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const fileRef = useRef(null);

  const selectKind = (k) => {
    setKind(k);
    const l = k === "bank" ? bankAccounts : cardAccounts;
    setAccountId((l[0] || {}).id || "");
  };

  // A row whose merchant matches an auto-coding rule is provisionally
  // tagged with that category and routed to Approval instead of
  // Unexplained -- it still needs a one-tap confirm (or reject back to
  // Suspense) before it counts as actually coded.
  const importRows = (rows) => {
    up((b) => {
      for (const r of rows) {
        if (!r.amount || !r.date) continue;
        const merchant = r.note || "";
        const matched = suggestHead(b, merchant);
        if (matched !== "Suspense") {
          b.entries.push({ id: uid(), date: r.date, amount: r.amount, type: r.type, category: matched, accountId, merchant, note: "", pendingApproval: true });
        } else {
          b.entries.push({ id: uid(), date: r.date, amount: r.amount, type: r.type, category: "Suspense", accountId, merchant, note: "" });
        }
      }
      return b;
    });
  };

  const handleFile = async (file) => {
    if (!accountId) { setStatus("Add an account first."); return; }
    setError(false);
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
      setError(true);
      setStatus(err && err.message ? err.message : "Make sure it's a CSV, PDF, or clear photo of a statement.");
    }
  };

  if (book.accounts.length === 0) {
    return <Modal open title="Import statement" onClose={close}><div style={{ fontSize: 13, color: C.muted, textAlign: "center" }}>Add an account first, in Setup ▸ Accounts.</div></Modal>;
  }

  return (
    <Modal open title="Import statement" onClose={close}>
      {!error ? (
        <>
          {bankAccounts.length > 0 && cardAccounts.length > 0 && (
            <Seg value={kind} onChange={selectKind} style={{ marginBottom: 12 }} options={[{ v: "bank", label: "Bank accounts" }, { v: "card", label: "Credit cards" }]} />
          )}
          <div style={{ maxHeight: 140, overflowY: "auto", marginBottom: 12 }}>
            {list.map((a, i) => (
              <div key={a.id} onClick={() => setAccountId(a.id)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 4px", cursor: "pointer", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: accountId === a.id ? C.accent : "transparent", border: accountId === a.id ? "none" : `1.5px solid ${C.overlayBorder}` }} />
                <span style={{ fontSize: 12.5, fontWeight: accountId === a.id ? 700 : 500 }}>{a.name}</span>
              </div>
            ))}
            {list.length === 0 && <div style={{ fontSize: 11.5, color: C.muted, padding: "8px 4px" }}>No {kind === "bank" ? "bank accounts" : "credit cards"} yet.</div>}
          </div>
          <PrimaryBtn style={{ marginBottom: 8 }} onClick={() => fileRef.current && fileRef.current.click()}>Choose file to import</PrimaryBtn>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; if (f) handleFile(f); }} />
          <button onClick={close} style={{ width: "100%", padding: "4px 0", border: "none", background: "none", color: C.muted, fontFamily: F.sans, fontWeight: 500, fontSize: 12, cursor: "pointer" }}>Cancel</button>
          {status && <div style={{ fontSize: 11, color: C.accentText, fontWeight: 600, marginTop: 8, textAlign: "center" }}>{status}</div>}
          <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 600, marginTop: 10, textAlign: "center" }}>Everything stays on your device — nothing is uploaded anywhere.</div>
        </>
      ) : (
        <div style={{ background: "rgba(204,51,51,.08)", border: "1px solid rgba(204,51,51,.2)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(204,51,51,.14)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
            <Ic name="close" size={16} color={C.red} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Import failed</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>{status}</div>
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <GhostBtn style={{ flex: 1, padding: "10px 0", fontSize: 12 }} onClick={close}>Cancel</GhostBtn>
            <PrimaryBtn style={{ flex: 1, padding: "10px 0", fontSize: 12 }} onClick={() => fileRef.current && fileRef.current.click()}>Try again</PrimaryBtn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ══════════════════════════ nav + root shell ══════════════════════════ */
const TABS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "owed", label: "Owed", icon: "people" },
  { id: "tx", label: "Transactions", icon: "swap" },
  { id: "reports", label: "Reports", icon: "bars" },
  { id: "setup", label: "Setup", icon: "sliders" },
];

function NavBar({ tab, setTab }) {
  return (
    <div style={{ position: "fixed", left: 14, right: 14, bottom: 14, zIndex: 30, ...glass(20), display: "flex", alignItems: "center", justifyContent: "space-around", padding: "10px 4px" }}>
      {TABS.map((tItem) => {
        const active = tItem.id === tab;
        return (
          <button key={tItem.id} data-tab={tItem.id} onClick={() => setTab(tItem.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: active ? C.accent : C.faint, background: "none", border: "none", cursor: "pointer", fontFamily: F.sans, padding: 0 }}>
            <Ic name={tItem.icon} size={19} color={active ? C.accent : C.faint} />
            <div style={{ fontSize: 8.5, fontWeight: active ? 700 : 500 }}>{tItem.label}</div>
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
      <div style={{ position: "fixed", inset: 0, background: C.bgGradient, zIndex: 0 }} />
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

const GLOBAL_CSS = `
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; padding: 0; overflow-x: hidden; overscroll-behavior-x: none; touch-action: manipulation; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
::-webkit-scrollbar { display: none; }
input, select, textarea { -webkit-user-select: text; user-select: text; }
@keyframes cbShake { 0%,100% { transform: translateX(0); } 20%,60% { transform: translateX(-8px); } 40%,80% { transform: translateX(8px); } }
`;

export default function App() {
  const [book, setBook] = useState(null);
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
      computePL, computeCashFlow, accountsWithBalances, owedAsOf,
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

  const notifCount = notificationsFor(book).length;
  const headerActions = tab === "tx" ? <IconBtn onClick={() => openSheet("import")}><Ic name="upload" size={13} /></IconBtn> : null;

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: F.sans, overflowX: "hidden" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ position: "fixed", inset: 0, background: C.bgGradient, zIndex: 0 }} />
      <div style={{ position: "relative", zIndex: 2, minHeight: "100vh", paddingBottom: 70 }}>
        {tab !== "home" && tab !== "reports" && <Header title={TABS.find((x) => x.id === tab).label} actions={headerActions} />}
        {tab === "home" && <HomeScreen book={book} go={go} openSheet={openSheet} notifCount={notifCount} />}
        {tab === "owed" && <OwedScreen book={book} openSheet={openSheet} />}
        {tab === "tx" && <TransactionsScreen book={book} up={up} openSheet={openSheet} openCodeTx={openCodeTx} selectMode={txSelectMode} setSelectMode={setTxSelectMode} />}
        {tab === "reports" && <ReportsScreen book={book} openSheet={openSheet} />}
        {tab === "setup" && <SetupScreen book={book} openSheet={openSheet} openAccountsPage={() => setAccountsPageOpen(true)} />}
      </div>

      {tab === "tx" && !txSelectMode && (
        <button onClick={() => openSheet("newTx")} style={{ position: "fixed", zIndex: 25, right: 18, bottom: 92, width: 50, height: 50, borderRadius: "50%", background: C.grad, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: `0 14px 28px -8px ${C.accentDeep}`, border: "none", cursor: "pointer" }}>
          <Ic name="plus" size={19} />
        </button>
      )}

      <NavBar tab={tab} setTab={setTab} />

      <SetupAccountsPage book={book} up={up} open={accountsPageOpen} onBack={() => setAccountsPageOpen(false)} />

      {sheet && sheet.name === "newTx" && <NewTransactionSheet book={book} up={up} close={closeSheet} preset={sheet.ctx} />}
      {sheet && sheet.name === "codeTx" && <CodeTransactionSheet book={book} up={up} close={closeSheet} entryId={sheet.ctx.entryId} />}
      {sheet && sheet.name === "viewTx" && <ViewTransactionSheet book={book} up={up} close={closeSheet} entryId={sheet.ctx.entryId} />}
      {sheet && sheet.name === "categoryDetail" && <CategoryDetailSheet book={book} close={closeSheet} title={sheet.ctx.title} entries={sheet.ctx.entries} />}
      {sheet && sheet.name === "txFilters" && <TxFilterSheet book={book} close={closeSheet} {...sheet.ctx} />}
      {sheet && sheet.name === "bulkCode" && <BulkCodeSheet book={book} up={up} close={closeSheet} entryIds={sheet.ctx.entryIds} onApplied={sheet.ctx.onApplied} />}
      {sheet && sheet.name === "recordPayment" && <RecordPaymentSheet book={book} up={up} close={closeSheet} presetPartyId={sheet.ctx.partyId} />}
      {sheet && sheet.name === "partyDetail" && <PartyDetailSheet book={book} openSheet={openSheet} close={closeSheet} partyId={sheet.ctx.partyId} />}
      {sheet && sheet.name === "notifications" && <NotificationsSheet book={book} go={go} close={closeSheet} />}
      {sheet && sheet.name === "breakdown" && <BreakdownSheet book={book} close={closeSheet} />}
      {sheet && sheet.name === "import" && <ImportSheet book={book} up={up} close={closeSheet} />}
      {sheet && sheet.name === "setupCategories" && <SetupCategoriesSheet book={book} up={up} close={closeSheet} />}
      {sheet && sheet.name === "setupIncomeCategories" && <SetupIncomeCategoriesSheet book={book} up={up} close={closeSheet} />}
      {sheet && sheet.name === "setupBsCategories" && <SetupBsCategoriesSheet book={book} up={up} close={closeSheet} />}
      {sheet && sheet.name === "setupRules" && <SetupRulesSheet book={book} up={up} close={closeSheet} />}
      {sheet && sheet.name === "setupPrefs" && <SetupPrefsSheet book={book} up={up} close={closeSheet} />}
      {sheet && sheet.name === "setupProfile" && <ProfileSheet book={book} up={up} close={closeSheet} />}
    </div>
  );
}
