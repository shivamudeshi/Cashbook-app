import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadBook, saveBook, defaultBook } from "./storage.js";
import {
  inr, parseAmount, today, addDays, periodByOffset, previousPeriod, shortDateLabel,
  uid, isExplained, isRefund, computePL, computeCashFlow, accountsWithBalances,
  owedAsOf, suggestHead, keywordOf, applyCodingRules,
} from "./engine.js";
import { extractPdfPages, parsePdfTable, parseStatementText, getOcrWorker } from "./pdf.js";
import ExcelJS from "exceljs";

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
    trash: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6",
    edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
    undo: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
    arrowUp: "M12 19V5M5 12l7-7 7 7",
    arrowDown: "M12 5v14M5 12l7 7 7-7",
    grid2: "M4 4h7v7h-7z M13 13h7v7h-7z",
    bolt: "M13 2 4 14h6l-1 8 9-12h-6z",
    shield: "M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6l7-3z",
    cloud: "M7 17a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A4.5 4.5 0 0 1 17 17H7z",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
    eyeOff: "M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.4 18.4 0 0 1 4.22-5.15M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24 M2 2l20 20",
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
  return <div className="tap" onClick={onClick} style={{ width: 30, height: 30, borderRadius: "50%", background: C.glassSoft, border: C.overlayBorder ? `1px solid ${C.overlayBorder}` : undefined, display: "flex", alignItems: "center", justifyContent: "center", color: C.soft, flexShrink: 0, cursor: "pointer", ...style }}>{children}</div>;
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
function Toggle({ value, onChange, reverse }) {
  const opts = reverse ? [["off", "Off"], ["on", "On"]] : [["on", "On"], ["off", "Off"]];
  return (
    <div style={{ display: "flex", gap: 0, background: C.overlayWash, border: `1px solid ${C.line}`, borderRadius: 999, padding: 3 }}>
      {opts.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v === "on")} style={{ padding: "6px 14px", borderRadius: 999, border: "none", fontWeight: 700, fontSize: 12, fontFamily: F.sans, cursor: "pointer", background: (value ? "on" : "off") === v ? C.grad : "transparent", color: (value ? "on" : "off") === v ? "#fff" : C.muted }}>{l}</button>
      ))}
    </div>
  );
}

function Sheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center", background: C.dimBg, backdropFilter: "blur(4px)", animation: "fadeIn .18s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", boxSizing: "border-box", background: C.sheetBg, border: C.border, borderTop: `1px solid ${C.overlayStrong}`, borderRadius: "24px 24px 0 0", padding: "10px 18px 28px", fontFamily: F.sans, color: C.ink, animation: "sheetUp .22s cubic-bezier(.2,.8,.2,1)" }}>
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: C.dimBg, backdropFilter: "blur(10px) saturate(140%)", WebkitBackdropFilter: "blur(10px) saturate(140%)", animation: "fadeIn .18s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: width || 280, maxWidth: "calc(100vw - 40px)", boxSizing: "border-box", background: "#fff", borderRadius: 20, padding: 20, boxShadow: "0 12px 30px rgba(17,17,17,.2)", fontFamily: F.sans, color: C.ink, animation: "popIn .18s cubic-bezier(.2,.8,.2,1)" }}>
        {title && <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, textAlign: "center" }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

// A brief bottom banner for confirming a destructive action just taken
// (deleting a transaction), with an optional Undo -- since delete is
// permanent and irreversible without it, every delete path routes through
// this rather than a plain toast.
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="no-print" style={{ position: "fixed", left: 16, right: 16, bottom: 82, zIndex: 300, ...glass(14), padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, animation: "toastIn .22s ease" }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>{toast.message}</div>
      {toast.undo && <button onClick={toast.undo} style={{ fontSize: 12, fontWeight: 800, color: C.accentText, background: "none", border: "none", cursor: "pointer", fontFamily: F.sans, flexShrink: 0 }}>Undo</button>}
    </div>
  );
}

// Full-page slide-over, used for every Setup sub-screen -- a left-aligned
// back chevron + title that scrolls with the content, matching the approved
// handoff's Settings screen exactly (no round back-button, no centered/
// sticky header bar).
function PageOverlay({ open, onBack, title, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 190, background: C.bg, overflowY: "auto", fontFamily: F.sans, color: C.ink, animation: "fadeIn .2s ease" }}>
      <div style={{ padding: "16px 16px 90px" }}>
        <div onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, cursor: "pointer" }}>
          <Ic name="back" size={16} color={C.ink} />
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        </div>
        {children}
      </div>
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

/* ────────────────────────── header + card helpers ────────────────────────── */
function Header({ title, actions }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 8px", gap: 10 }}>
      <div style={{ fontSize: 20, fontWeight: 700, flex: 1 }}>{title}</div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>{actions}</div>
    </div>
  );
}
function BellBtn({ onClick, notifCount }) {
  return (
    <div className="tap" onClick={onClick} style={{ width: 44, height: 44, borderRadius: "50%", position: "relative", overflow: "hidden", cursor: "pointer", flexShrink: 0 }}>
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
  return <div className={onClick ? "tap" : undefined} onClick={onClick} style={{ ...glass(18), padding: 16, ...style }}>{children}</div>;
}
function RowLine({ children, onClick, last }) {
  return <div className={onClick ? "tap" : undefined} onClick={onClick} style={{ display: "flex", alignItems: "center", padding: "12px 0", borderTop: last ? "none" : `1px solid ${C.line}`, cursor: onClick ? "pointer" : "default" }}>{children}</div>;
}

// A standalone card row that reveals a colored action (Delete / Unexplain)
// when dragged left, matching the mockup's swipe gesture exactly -- one row
// stays "open" at a time via the shared openId/setOpenId pair, and dragging
// is disabled while select mode is on (selecting rows takes over the tap).
const SWIPE_OPEN_DX = -76;
function SwipeRow({ id, openId, setOpenId, action, disabled, locked, onClick, children }) {
  const [dx, setDx] = useState(0);
  const drag = useRef(null); // { startX, moved }
  // A mouseup/pointerup after real movement still gets a synthetic click
  // event right behind it (browsers don't suppress click just because the
  // pointer travelled between down and up) -- without this flag that
  // phantom click hits handleTap's "tap an open row to close it" branch
  // and immediately re-closes the row the drag just opened.
  const justDragged = useRef(false);
  const isOpen = openId === id;

  useEffect(() => { if (!isOpen) setDx(0); }, [isOpen]);

  const onPointerDown = (e) => {
    if (disabled) return;
    drag.current = { startX: e.clientX, startY: e.clientY, moved: false, axis: null };
  };
  const onPointerMove = (e) => {
    if (disabled || !drag.current) return;
    const dxAbs = Math.abs(e.clientX - drag.current.startX);
    const dyAbs = Math.abs(e.clientY - drag.current.startY);
    // Undecided gestures don't touch dx at all -- only once there's been
    // enough movement to tell direction does this either commit to the
    // horizontal swipe or bail out entirely, so a vertical scroll attempt
    // starting on a row never fights the browser's own native scrolling
    // (touch-action: pan-y below already tells it to take over, but this
    // keeps this component's own state from flickering mid-gesture too).
    if (!drag.current.axis) {
      if (dxAbs < 6 && dyAbs < 6) return;
      if (dyAbs > dxAbs) { drag.current = null; return; }
      drag.current.axis = "x";
    }
    const base = isOpen ? SWIPE_OPEN_DX : 0;
    let next = base + (e.clientX - drag.current.startX);
    next = Math.max(SWIPE_OPEN_DX, Math.min(0, next));
    if (dxAbs > 6) drag.current.moved = true;
    setDx(next);
  };
  const endDrag = () => {
    if (disabled || !drag.current) return;
    const open = dx < SWIPE_OPEN_DX / 2;
    if (drag.current.moved) justDragged.current = true;
    setOpenId(open ? id : null);
    setDx(open ? SWIPE_OPEN_DX : 0);
    drag.current = null;
  };
  const handleTap = () => {
    if (justDragged.current) { justDragged.current = false; return; }
    if (locked) return;
    if (isOpen) { setOpenId(null); return; }
    if (onClick) onClick();
  };

  return (
    <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", marginBottom: 8 }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 20, background: dx < 0 ? action.color : "transparent" }}>
        {dx < 0 && (
          <div onClick={(e) => { e.stopPropagation(); setOpenId(null); setDx(0); action.onTrigger(); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: "#fff", cursor: "pointer", width: 64 }}>
            <Ic name={action.icon} size={15} color="#fff" />
            <span style={{ fontSize: 9, fontWeight: 700 }}>{action.label}</span>
          </div>
        )}
      </div>
      <div
        onPointerDown={disabled ? undefined : onPointerDown}
        onPointerMove={disabled ? undefined : onPointerMove}
        onPointerUp={disabled ? undefined : endDrag}
        onPointerCancel={disabled ? undefined : endDrag}
        onClick={handleTap}
        style={{
          border: `1px solid ${C.line}`, borderRadius: 14, padding: "10px 12px", boxSizing: "border-box",
          background: locked ? "rgba(17,17,17,.04)" : C.glass, opacity: locked ? 0.45 : 1, cursor: locked ? "default" : "pointer", touchAction: "pan-y",
          transform: `translateX(${dx}px)`, transition: drag.current ? "none" : "transform .2s ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ══════════════════════════ HOME ══════════════════════════ */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const HERO_COLORS = ["#1d3a8f", "#4c68b3", "#142a68", "#7a2e3b", "#0f6a5c", "#a6741c"];

function HeroCarousel({ accounts, openSheet, masked }) {
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
                  <div style={{ fontSize: 25, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{masked ? "••••" : inr(Math.abs(a.balance))}</div>
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

function HomeScreen({ book, go, openSheet, notifCount, balancesRevealed, setBalancesRevealed }) {
  const t = today();
  const lastMonth = periodByOffset("month", 1, t);
  const pl = computePL(book, lastMonth.from, lastMonth.to);
  const accounts = accountsWithBalances(book, t);
  const owed = owedAsOf(book, t);
  const unexplainedCount = book.entries.filter((e) => (e.type === "in" || e.type === "out") && !isExplained(e)).length;
  const approvalCount = book.entries.filter((e) => (e.type === "in" || e.type === "out") && e.pendingApproval).length;
  const masked = !!book.prefs.hideBalances && !balancesRevealed;

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
        <div style={{ fontSize: 9.5, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".05em", color: C.muted, marginBottom: 12 }}>Last month</div>
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
          <div className="tap" onClick={() => go("setup")} style={{ display: "inline-block", background: C.accent, color: "#fff", borderRadius: 10, padding: "9px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Add account</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 2px", gap: 8 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap" }}>Your money</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {book.prefs.hideBalances && (
                <div onClick={() => setBalancesRevealed((v) => !v)} style={{ cursor: "pointer", display: "flex", flexShrink: 0 }}>
                  <Ic name={masked ? "eye" : "eyeOff"} size={15} color={C.soft} />
                </div>
              )}
              <div className="tap" onClick={() => openSheet("breakdown")} style={{ fontSize: 11.5, fontWeight: 500, color: C.ink, cursor: "pointer", whiteSpace: "nowrap" }}>Detailed breakdown ›</div>
            </div>
          </div>
          <HeroCarousel accounts={accounts} openSheet={openSheet} masked={masked} />
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
            <div className="tap" onClick={() => go("owed")} style={{ fontSize: 11.5, fontWeight: 500, color: C.ink, cursor: "pointer" }}>See all ›</div>
          </div>
          <div className="tap" onClick={() => go("owed")} style={{ background: "#fff", borderRadius: 16, padding: "4px 14px", marginBottom: 18, cursor: "pointer" }}>
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
              <div className="tap" onClick={() => go("tx", "unexplained")} style={{ ...glass(16), padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 3, whiteSpace: "nowrap" }}>{unexplainedCount} unexplained transaction{unexplainedCount === 1 ? "" : "s"}</div>
                  <div style={{ fontSize: 11, color: C.soft }}>Missing a category</div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 600, padding: "5px 12px", borderRadius: 999, background: C.accent, color: "#fff", flexShrink: 0 }}>Categorize</div>
              </div>
            )}
            {approvalCount > 0 && (
              <div className="tap" onClick={() => go("tx", "approval")} style={{ ...glass(16), padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer" }}>
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

// What the notification bell surfaces: unexplained transactions,
// auto-matched transactions awaiting approval, and credit card payments due
// within a week -- the things in this app that actually need the user's
// attention, as opposed to routine day-to-day activity. Each bucket can be
// turned off from Setup ▸ Notifications (book.prefs.notifPrefs).
function notificationsFor(book) {
  const t = today();
  const list = [];
  const prefs = book.prefs.notifPrefs || {};
  const codable = book.entries.filter((e) => e.type === "in" || e.type === "out");
  const unexplainedCount = codable.filter((e) => !e.pendingApproval && !isExplained(e)).length;
  if (prefs.unexplained !== false && unexplainedCount > 0) {
    list.push({ id: "unexplained", title: `${unexplainedCount} unexplained transaction${unexplainedCount === 1 ? "" : "s"}`, sub: "Tap to review and code them", tab: "tx", txTab: "unexplained" });
  }
  const approvalCount = codable.filter((e) => e.pendingApproval).length;
  if (prefs.approval !== false && approvalCount > 0) {
    list.push({ id: "approval", title: `${approvalCount} transaction${approvalCount === 1 ? "" : "s"} auto-matched`, sub: "Tap to confirm the suggested category", tab: "tx", txTab: "approval" });
  }
  if (prefs.paymentDue !== false) {
    for (const a of book.accounts) {
      if (a.kind !== "card" || !a.dueDay) continue;
      const due = nextDueDate(a.dueDay, t);
      const days = Math.round((due - new Date(t + "T00:00:00")) / 86400000);
      if (days >= 0 && days <= 7) {
        list.push({ id: "due-" + a.id, title: `${a.name} payment due ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}`, sub: `Due on the ${a.dueDay}${dueOrdinal(a.dueDay)}`, tab: "home" });
      }
    }
  }
  return list;
}

function NotificationsSheet({ book, go, close }) {
  const items = notificationsFor(book);
  return (
    <Modal open title="Notifications" onClose={close}>
      {items.length === 0 && <div style={{ padding: "10px 0 16px", fontSize: 12.5, color: C.muted, textAlign: "center" }}>You're all caught up — nothing needs your attention.</div>}
      {items.map((n, i) => {
        const isDue = n.id.startsWith("due-");
        const isApproval = n.id === "approval";
        const icon = isDue ? "card" : isApproval ? "check" : "swap";
        const color = isDue ? C.ink : isApproval ? C.amberText : C.accent;
        const bg = isDue ? C.overlayWash : isApproval ? "rgba(166,116,28,.12)" : C.accentSoft;
        return (
        <div key={n.id} onClick={() => { go(n.tab, n.txTab); close(); }} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: i === items.length - 1 ? "none" : `1px solid ${C.line}`, cursor: "pointer" }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Ic name={icon} size={15} color={color} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>{n.title}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{n.sub}</div>
          </div>
        </div>
        );
      })}
      <PrimaryBtn style={{ marginTop: 10, padding: "10px 0", fontSize: 12.5 }} onClick={close}>Close</PrimaryBtn>
    </Modal>
  );
}

/* ══════════════════════════ OWED ══════════════════════════ */
// Parties don't carry a stored color -- a small deterministic hash over
// the id keeps each person's avatar stable across renders/sessions
// without needing to persist a color choice anywhere.
const OWED_AVATAR_PALETTE = [
  { color: C.accent, bg: "rgba(29,58,143,.14)" },
  { color: C.green, bg: "rgba(15,106,92,.14)" },
  { color: C.amberText, bg: "rgba(166,116,28,.14)" },
  { color: "#7a2e3b", bg: "rgba(122,46,59,.14)" },
];
function partyAvatar(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return OWED_AVATAR_PALETTE[h % OWED_AVATAR_PALETTE.length];
}
function PartyAvatarCircle({ id, name, size, muted }) {
  const av = partyAvatar(id);
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.34, fontWeight: 700, flexShrink: 0, background: muted ? C.overlayWash : av.bg, color: muted ? C.muted : av.color }}>
      {(name || "?").trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

// A party's full history, newest first, signed the same way owedAsOf
// sums balances: dir "out" (money left your account) raises what they
// owe you, dir "in" lowers it -- so a positive/negative sign here always
// matches the direction that entry actually moved the balance.
function partyHistory(book, partyId) {
  return book.entries
    .filter((e) => e.type === "party" && e.partyId === partyId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => ({
      id: e.id,
      note: e.note || (e.dir === "out" ? "You paid" : "They paid"),
      when: e.date,
      signed: e.dir === "out" ? e.amount : -e.amount,
    }));
}

const OWED_SORTS = [["amount-desc", "Amount: high to low"], ["amount-asc", "Amount: low to high"], ["az", "A – Z"]];
const owedSortLabel = (sortBy) => (sortBy === "amount-asc" ? "Amount ▴" : sortBy === "az" ? "A – Z" : "Amount ▾");

function OwedScreen({ book, up, openSheet, showToast }) {
  const t = today();
  const owed = owedAsOf(book, t);
  const [activeTab, setActiveTab] = useState("get"); // get | owe | settled
  const [search, setSearch] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [sortBy, setSortBy] = useState("amount-desc");
  const [selectedId, setSelectedId] = useState(null);

  const selectTab = (v) => { setActiveTab(v); setSearch(""); setSortOpen(false); };

  if (selectedId) {
    const party = book.parties.find((p) => p.id === selectedId);
    if (!party) return null;
    const row = owed.perParty.find((p) => p.id === selectedId);
    const balance = row ? row.balance : 0;
    const hist = partyHistory(book, selectedId);
    const av = partyAvatar(selectedId);
    const headline = balance > 0 ? "Owes you" : balance < 0 ? "You owe" : "Settled up";
    const color = balance > 0 ? C.accent : balance < 0 ? C.ink : C.muted;
    // Removing a row from a party's history never deletes the underlying
    // transaction -- it unexplains it back to a plain Suspense entry (see
    // unexplainEntryInPlace), so the money still shows up needing
    // recategorization in Unexplained instead of vanishing from the ledger.
    const deleteEntry = (id) => {
      const original = book.entries.find((e) => e.id === id);
      if (!original) return;
      up((b) => unexplainEntryInPlace(b, id));
      if (showToast) {
        showToast(`"${original.note || party.name || "Transaction"}" marked unexplained`, () => {
          up((b) => undoUnexplain(b, original));
        });
      }
    };

    return (
      <div style={{ padding: "4px 16px 90px" }}>
        <div onClick={() => setSelectedId(null)} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, cursor: "pointer" }}>
          <Ic name="back" size={16} />
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap" }}>{party.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, background: av.bg, color: av.color, marginBottom: 10 }}>
            {party.name.trim().charAt(0).toUpperCase() || "?"}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>{headline}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{inr(Math.abs(balance))}</div>
        </div>
        {balance !== 0 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <PrimaryBtn style={{ padding: "12px 0" }} onClick={() => openSheet("recordPayment", { partyId: selectedId })}>Settle up</PrimaryBtn>
          </div>
        )}
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, padding: "0 2px" }}>History</div>
        <Card style={{ padding: "2px 16px" }}>
          {hist.length === 0 && <div style={{ padding: "14px 0", fontSize: 12.5, color: C.muted }}>No transactions with {party.name} yet.</div>}
          {hist.map((h, i) => (
            <RowLine key={h.id} last={i === hist.length - 1} onClick={() => openSheet("viewTx", { entryId: h.id })}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.note}</div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{h.when}</div>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginRight: 6, fontVariantNumeric: "tabular-nums" }}>{h.signed >= 0 ? "+" : "−"}{inr(Math.abs(h.signed))}</div>
              <div onClick={(ev) => { ev.stopPropagation(); deleteEntry(h.id); }} style={{ cursor: "pointer", flexShrink: 0, display: "flex" }}><Ic name="undo" size={14} color={C.faint} /></div>
            </RowLine>
          ))}
        </Card>
      </div>
    );
  }

  const isSettled = activeTab === "settled";
  const q = search.trim().toLowerCase();
  const getCount = owed.perParty.filter((p) => p.balance > 0).length;
  const oweCount = owed.perParty.filter((p) => p.balance < 0).length;

  let rows = owed.perParty
    .filter((p) => (activeTab === "get" ? p.balance > 0 : p.balance < 0))
    .filter((p) => p.name.toLowerCase().includes(q));
  rows.sort((a, b) => (sortBy === "amount-asc" ? Math.abs(a.balance) - Math.abs(b.balance) : sortBy === "az" ? a.name.localeCompare(b.name) : Math.abs(b.balance) - Math.abs(a.balance)));

  let settledRows = owed.perParty
    .map((p) => ({ p, hist: partyHistory(book, p.id) }))
    .filter(({ p, hist }) => p.balance === 0 && hist.length > 0 && p.name.toLowerCase().includes(q))
    .map(({ p, hist }) => ({ id: p.id, name: p.name, note: hist[0].note, when: hist[0].when, amount: Math.abs(hist[0].signed) }));
  settledRows.sort((a, b) => (sortBy === "amount-asc" ? a.amount - b.amount : sortBy === "az" ? a.name.localeCompare(b.name) : b.amount - a.amount));

  const total = isSettled ? settledRows.reduce((s, r) => s + r.amount, 0) : rows.reduce((s, p) => s + Math.abs(p.balance), 0);
  const totalColor = isSettled ? C.muted : activeTab === "get" ? C.accent : C.ink;

  const tabBtn = (key, label, count) => {
    const active = activeTab === key;
    return (
      <div key={key} onClick={() => selectTab(key)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 0", borderRadius: 8, fontSize: 11, fontWeight: active ? 700 : 500, color: active ? C.ink : C.muted, background: active ? "#fff" : "transparent", whiteSpace: "nowrap", cursor: "pointer" }}>
        {label}
        {count != null && <span style={{ display: "inline-flex", alignItems: "center", fontSize: 9, fontWeight: 500, padding: "1px 6px", borderRadius: 999, background: active ? C.accent : "rgba(17,17,17,.1)", color: active ? "#fff" : "#555" }}>{count}</span>}
      </div>
    );
  };

  return (
    <div style={{ padding: "4px 16px 90px" }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 14 }}>Owed</div>
      <div style={{ display: "flex", background: "rgba(17,17,17,.06)", borderRadius: 10, padding: 3, marginBottom: 10 }}>
        {tabBtn("get", "You'll get", getCount)}
        {tabBtn("owe", "You owe", oweCount)}
        {tabBtn("settled", "Settled")}
      </div>

      <div style={{ position: "relative", display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ ...glass(14), flex: 1, display: "flex", alignItems: "center", gap: 6, padding: "8px 11px" }}>
          <Ic name="search" size={12} color={C.muted} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" style={{ flex: 1, minWidth: 0, border: "none", background: "none", fontFamily: F.sans, fontSize: 11, color: C.ink }} />
          {search && <div onClick={() => setSearch("")} style={{ cursor: "pointer", flexShrink: 0, display: "flex" }}><Ic name="close" size={12} color={C.muted} /></div>}
        </div>
        <div onClick={() => setSortOpen((v) => !v)} style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", fontSize: 10.5, fontWeight: 500, padding: "3px 12px", borderRadius: 999, cursor: "pointer", background: sortOpen ? C.grad : C.overlayWash, color: sortOpen ? "#fff" : C.ink }}>
          {owedSortLabel(sortBy)}
        </div>
        {sortOpen && (
          <div style={{ ...glass(14), position: "absolute", top: 38, right: 0, width: 172, padding: 6, zIndex: 2 }}>
            {OWED_SORTS.map(([v, label]) => (
              <div key={v} onClick={() => { setSortBy(v); setSortOpen(false); }} style={{ padding: "8px 10px", borderRadius: 8, fontSize: 12, fontWeight: sortBy === v ? 600 : 400, color: sortBy === v ? C.accentText : C.soft, background: sortBy === v ? C.accentSoft : "transparent", cursor: "pointer" }}>{label}</div>
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize: 15, fontWeight: 700, color: totalColor, marginBottom: 10 }}>{inr(total)} {isSettled ? "settled" : "total"}</div>
      <Card style={{ padding: "2px 16px", opacity: isSettled ? 0.75 : 1 }}>
        {isSettled ? (
          <>
            {settledRows.length === 0 && <div style={{ padding: "14px 0", fontSize: 12.5, color: C.muted }}>Nothing settled yet.</div>}
            {settledRows.map((r, i) => (
              <RowLine key={r.id} last={i === settledRows.length - 1}>
                <PartyAvatarCircle id={r.id} name={r.name} size={38} muted />
                <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                  <div style={{ fontSize: 10, color: C.faint, marginTop: 1 }}>{r.note} · {r.when}</div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 500, padding: "3px 9px", borderRadius: 999, background: "rgba(17,17,17,.06)", color: C.muted, fontVariantNumeric: "tabular-nums" }}>{inr(r.amount)}</div>
              </RowLine>
            ))}
          </>
        ) : (
          <>
            {rows.length === 0 && <div style={{ padding: "14px 0", fontSize: 12.5, color: C.muted }}>Nothing here yet.</div>}
            {rows.map((p, i) => (
              <RowLine key={p.id} last={i === rows.length - 1} onClick={() => setSelectedId(p.id)}>
                <PartyAvatarCircle id={p.id} name={p.name} size={38} />
                <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{p.balance > 0 ? "Owes you" : "You owe them"}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: p.balance > 0 ? C.accent : C.ink, fontVariantNumeric: "tabular-nums" }}>{inr(Math.abs(p.balance))}</div>
              </RowLine>
            ))}
          </>
        )}
      </Card>
    </div>
  );
}

/* ══════════════════════════ TRANSACTIONS ══════════════════════════ */
// Explained rows now include Transfer and Party entries too (they used to
// be filtered out of Transactions entirely, which made them vanish the
// moment an Unexplained row was coded as one -- looked exactly like the
// app "didn't save" the change). Each type gets its own title/subtitle/
// amount-sign treatment since none of them share Category/Party/Transfer
// shape.
// title is the row's own identifying text (bank narration for an imported
// row, or whatever note was typed for a manual one) with category shown
// separately as a pill -- matching the mockup's shape, where "name" (a
// description) and "category" are always two distinct fields, never one
// standing in for the other.
function explainedRowInfo(book, e) {
  const accountName = (id) => (book.accounts.find((a) => a.id === id) || {}).name || "—";
  const partyName = (id) => (book.parties.find((p) => p.id === id) || {}).name || "Unknown";
  if (e.type === "transfer") {
    return { title: "Transfer", sub: `${accountName(e.fromAccountId)} → ${accountName(e.toAccountId)}`, pill: null, sign: null, color: C.ink };
  }
  if (e.type === "party") {
    const out = e.dir === "out";
    // No accountId at all means this IOU was recorded as not linked to any
    // bank account (see NewTransactionSheet's owedNoAccount) -- say so
    // explicitly rather than falling through accountName's "—" fallback,
    // which reads like missing data rather than an intentional choice.
    const sub = e.accountId ? accountName(e.accountId) : "Not linked to a bank account";
    return { title: out ? `Paid ${partyName(e.partyId)}` : `Received from ${partyName(e.partyId)}`, sub, pill: null, sign: out ? "−" : "+", color: out ? C.red : C.green };
  }
  const isBS = book.bsCategories.includes(e.category);
  return {
    title: e.merchant || e.note || e.category,
    sub: accountName(e.accountId),
    pill: e.category, isBS,
    sign: e.type === "in" ? "+" : "−", color: e.type === "in" ? C.green : C.red,
  };
}

const TX_TAB_DEFS = [["explained", "Explained"], ["unexplained", "Unexplained"], ["approval", "Approval"]];
const TX_DATE_OPTIONS = [["all", "Any time"], ["today", "Today"], ["week", "This week"], ["month", "This month"], ["custom", "Custom range"]];
const TX_SORT_OPTIONS = [["newest", "Newest first"], ["oldest", "Oldest first"], ["amount_high", "Amount: high to low"], ["amount_low", "Amount: low to high"]];
const txChipBtn = (active) => ({ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 600, padding: "6px 11px", borderRadius: 999, border: "none", cursor: "pointer", whiteSpace: "nowrap", fontFamily: F.sans, background: active ? C.grad : C.overlayWash, color: active ? "#fff" : "#444" });
// Approval-tab row actions -- a real 36px-tall tap target with a label, not
// just an icon, since the old 22px unlabeled circles were reported too small
// and fiddly to hit reliably.
const approvalActionBtnStyle = (color, bg) => ({ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, height: 36, borderRadius: 11, border: "none", background: bg, color, fontWeight: 700, fontSize: 11.5, fontFamily: F.sans, cursor: "pointer" });

function TransactionsScreen({ book, up, openSheet, selectMode, setSelectMode, showToast, initialTab, clearInitialTab }) {
  const [tab, setTabState] = useState(initialTab || "explained");
  useEffect(() => { if (initialTab && clearInitialTab) clearInitialTab(); }, []);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [drill, setDrill] = useState(null); // "account" | "category" | "date" | null
  const [acctFilter, setAcctFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [catSearch, setCatSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [openSwipeId, setOpenSwipeId] = useState(null);
  const t = today();
  const accountName = (id) => (book.accounts.find((a) => a.id === id) || {}).name || "—";
  const partyName = (id) => (book.parties.find((p) => p.id === id) || {}).name || "Unknown";

  const setTab = (v) => { setTabState(v); setSelected(new Set()); setSelectMode(false); setOpenSwipeId(null); };
  const toggleDrill = (d) => setDrill((cur) => (cur === d ? null : d));

  const codable = book.entries.filter((e) => e.type === "in" || e.type === "out");
  const approval = codable.filter((e) => e.pendingApproval);
  const explainedAll = book.entries.filter((e) => (e.type === "in" || e.type === "out" || e.type === "transfer" || e.type === "party") && isExplained(e) && !e.pendingApproval);
  const unexplainedAll = codable.filter((e) => !e.pendingApproval && !isExplained(e));
  const usedCategories = [...new Set(codable.filter((e) => isExplained(e) && !e.pendingApproval).map((e) => e.category))].sort();
  const rowsForTab = tab === "unexplained" ? unexplainedAll : tab === "approval" ? approval : explainedAll;

  const withinDate = (e) => {
    if (dateFilter === "all") return true;
    if (dateFilter === "today") return e.date === t;
    if (dateFilter === "week") return e.date >= addDays(t, -6) && e.date <= t;
    if (dateFilter === "month") return e.date >= addDays(t, -29) && e.date <= t;
    if (dateFilter === "custom") return (!dateFrom || e.date >= dateFrom) && (!dateTo || e.date <= dateTo);
    return true;
  };
  const matches = (e) => {
    if (acctFilter !== "all" && e.accountId !== acctFilter && e.fromAccountId !== acctFilter && e.toAccountId !== acctFilter) return false;
    if (catFilter === "__transfer__") { if (e.type !== "transfer") return false; }
    else if (catFilter !== "all" && e.category !== catFilter) return false;
    if (!withinDate(e)) return false;
    const needle = search.trim().toLowerCase();
    if (needle) {
      const hay = [e.merchant, e.category, e.note, e.date, String(e.amount)].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  };
  let rows = rowsForTab.filter(matches);
  rows = rows.slice().sort((a, b) => {
    if (sortBy === "oldest") return a.date.localeCompare(b.date);
    if (sortBy === "amount_high") return b.amount - a.amount;
    if (sortBy === "amount_low") return a.amount - b.amount;
    return b.date.localeCompare(a.date); // newest
  });
  const groups = [];
  for (const e of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.rows.push(e);
    else groups.push({ date: e.date, label: shortDateLabel(e.date), rows: [e] });
  }
  const activeFilterCount = (acctFilter !== "all" ? 1 : 0) + (catFilter !== "all" ? 1 : 0) + (dateFilter !== "all" ? 1 : 0);

  const selectedIds = [...selected];
  const lockedType = selectedIds.length > 0 ? (rowsForTab.find((e) => e.id === selectedIds[0]) || {}).type : null;
  const eligible = lockedType ? rows.filter((e) => e.type === lockedType) : rows;
  const allSelected = eligible.length > 0 && eligible.every((e) => selected.has(e.id));
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(eligible.map((e) => e.id)));
  const toggleSelected = (id) => setSelected((s) => {
    const row = rowsForTab.find((e) => e.id === id);
    if (!row) return s;
    const n = new Set(s);
    if (n.has(id)) { n.delete(id); return n; }
    if (lockedType && lockedType !== row.type) return s;
    n.add(id);
    return n;
  });

  const deleteEntries = (ids) => {
    let removed = [];
    up((b) => { removed = b.entries.filter((e) => ids.includes(e.id)); b.entries = b.entries.filter((e) => !ids.includes(e.id)); });
    setSelected(new Set());
    setSelectMode(false);
    if (removed.length) {
      showToast(`${removed.length > 1 ? removed.length + " transactions" : "Transaction"} deleted`, () => { up((b) => { b.entries.push(...removed); }); });
    }
  };
  // Explained/Owed transactions are never actually deleted from here --
  // swiping or bulk-acting on an explained row (category, owed person, or
  // transfer alike) puts it back in Unexplained via unexplainEntryInPlace
  // instead, so a real imported bank row never silently vanishes. Only the
  // Unexplained tab's own rows (nothing recoded onto them yet) still permit
  // an actual delete, e.g. for a genuine duplicate import.
  const unexplainOne = (e) => {
    up((b) => unexplainEntryInPlace(b, e.id));
    showToast(`"${e.merchant || e.category || explainedRowInfo(book, e).title}" marked unexplained`, () => {
      up((b) => undoUnexplain(b, e));
    });
  };
  const bulkUnexplain = () => {
    const removed = rowsForTab.filter((e) => selected.has(e.id));
    up((b) => { for (const e of removed) unexplainEntryInPlace(b, e.id); });
    setSelected(new Set());
    setSelectMode(false);
    if (removed.length) {
      showToast(`${removed.length > 1 ? removed.length + " transactions" : "Transaction"} marked unexplained`, () => {
        up((b) => { for (const e of removed) undoUnexplain(b, e); });
      });
    }
  };
  const swipeActionFor = (e) => (tab === "explained"
    ? { label: "Unexplain", icon: "undo", color: C.accent, onTrigger: () => unexplainOne(e) }
    : { label: "Delete", icon: "trash", color: "#c33", onTrigger: () => deleteEntries([e.id]) });

  // A rule-suggested party match (e.suggestedParty) approves into a real
  // "party" entry, exactly like a manual Categorize-sheet recode. A
  // suggested transfer match (e.suggestedTransferAccount) approves into a
  // real "transfer" entry, merging away the matching opposite leg in that
  // account if one was found -- only on this explicit approve does that
  // merge/delete ever happen, never on a plain sweep. A suggested category
  // match just clears pendingApproval, since e.category is already set to
  // the suggestion.
  const approveOne = (b, id) => {
    const idx = b.entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const e = b.entries[idx];
    if (e.suggestedParty) { recodeEntryAsParty(b, id, e.suggestedParty); return; }
    if (e.suggestedTransferAccount) { recodeEntryAsTransfer(b, id, e.suggestedTransferAccount); return; }
    b.entries[idx] = { ...e, pendingApproval: false };
  };
  const rejectOne = (b, id) => {
    const idx = b.entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const { suggestedParty, suggestedTransferAccount, ...rest } = b.entries[idx];
    b.entries[idx] = { ...rest, category: "Suspense", pendingApproval: false, codingRejected: true };
  };
  const approveEntry = (id) => up((b) => { approveOne(b, id); });
  const rejectEntry = (id) => up((b) => { rejectOne(b, id); });
  const bulkApprove = () => { up((b) => { for (const id of selected) approveOne(b, id); }); setSelected(new Set()); setSelectMode(false); };
  const bulkReject = () => { up((b) => { for (const id of selected) rejectOne(b, id); }); setSelected(new Set()); setSelectMode(false); };
  const openCategorize = (ids, onApplied) => openSheet("categorize", { entryIds: ids, onApplied });
  // Bulk actions exit select mode themselves (bulkApprove/bulkReject/deleteEntries
  // all clear it), but the Categorize sheet is opened and closed asynchronously --
  // this callback fires only once the sheet actually applies a change (not on a
  // plain cancel), so the selection UI clears right after the bulk categorize
  // completes instead of lingering with nothing left to act on.
  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  // Income/Expense/Other-movement/Transfer are separate filter *types*, not
  // one flat "Category" drill grouped internally -- a transaction only ever
  // belongs to one of these, so they're mutually exclusive filter buttons
  // rather than nested sub-groups of a single chip.
  const needleFor = (list) => list.filter((c) => c.toLowerCase().includes(catSearch.trim().toLowerCase()));
  const usedIncomeCats = needleFor(usedCategories.filter((c) => book.categories.income.includes(c)));
  const usedExpenseCats = needleFor(usedCategories.filter((c) => book.categories.expense.includes(c)));
  const usedOtherCats = needleFor(usedCategories.filter((c) => book.bsCategories.includes(c)));
  const catFilterType = catFilter === "all" || catFilter === "__transfer__" ? null
    : book.categories.income.includes(catFilter) ? "income"
    : book.categories.expense.includes(catFilter) ? "expense"
    : book.bsCategories.includes(catFilter) ? "other" : null;

  return (
    <div style={{ padding: "4px 16px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Transactions</div>
        {selectMode ? (
          <button onClick={() => { setSelectMode(false); setSelected(new Set()); }} style={{ ...txChipBtn(false), padding: "5px 11px" }}>Cancel</button>
        ) : (
          <button onClick={() => setSelectMode(true)} style={{ ...txChipBtn(true), padding: "5px 11px" }}>Select</button>
        )}
      </div>

      <div style={{ display: "flex", background: "rgba(17,17,17,.06)", borderRadius: 10, padding: 3, marginBottom: 8 }}>
        {TX_TAB_DEFS.map(([key, label]) => {
          const active = tab === key;
          const count = key === "unexplained" ? unexplainedAll.length : key === "approval" ? approval.length : null;
          return (
            <div key={key} onClick={() => setTab(key)} style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 8, fontWeight: active ? 700 : 500, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap", background: active ? "#fff" : "transparent", color: active ? C.accentText : C.muted, boxShadow: active ? "0 1px 3px rgba(17,17,17,.12)" : "none" }}>
              {label}{count != null && count > 0 && <span style={{ display: "inline-flex", alignItems: "center", fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 999, background: "rgba(17,17,17,.1)", color: "#555", marginLeft: 5 }}>{count}</span>}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ ...glass(12), flex: 1, display: "flex", alignItems: "center", gap: 7, padding: "9px 11px" }}>
          <Ic name="search" size={13} color={C.muted} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search transactions" style={{ flex: 1, minWidth: 0, border: "none", background: "none", fontFamily: F.sans, fontSize: 11, color: C.ink }} />
        </div>
        <button onClick={() => { setSortOpen((v) => !v); setFilterOpen(false); setOpenSwipeId(null); }} style={{ ...txChipBtn(sortOpen), display: "inline-flex", alignItems: "center", gap: 4, padding: "9px 12px", flexShrink: 0 }}>
          <Ic name="sliders" size={12} color={sortOpen ? "#fff" : "#444"} />Sort
        </button>
        <button onClick={() => { setFilterOpen((v) => !v); setSortOpen(false); setOpenSwipeId(null); }} style={{ ...txChipBtn(filterOpen), padding: "9px 13px", flexShrink: 0 }}>
          Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : " ▾"}
        </button>
      </div>

      {sortOpen && (
        <div style={{ ...glass(14), display: "flex", flexWrap: "wrap", gap: 6, padding: 10, marginBottom: 12 }}>
          {TX_SORT_OPTIONS.map(([v, label]) => <button key={v} onClick={() => { setSortBy(v); setSortOpen(false); }} style={txChipBtn(sortBy === v)}>{label}</button>)}
        </div>
      )}

      {filterOpen && (
        <div style={{ ...glass(14), marginBottom: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: 10, flexWrap: "wrap" }}>
            <button onClick={() => toggleDrill("account")} style={txChipBtn(drill === "account")}>Account: {acctFilter === "all" ? "All" : accountName(acctFilter)} {drill === "account" ? "▴" : "▾"}</button>
            <button onClick={() => toggleDrill("income")} style={txChipBtn(drill === "income")}>Income: {catFilterType === "income" ? catFilter : "All"} {drill === "income" ? "▴" : "▾"}</button>
            <button onClick={() => toggleDrill("expense")} style={txChipBtn(drill === "expense")}>Expense: {catFilterType === "expense" ? catFilter : "All"} {drill === "expense" ? "▴" : "▾"}</button>
            <button onClick={() => toggleDrill("other")} style={txChipBtn(drill === "other")}>Other: {catFilterType === "other" ? catFilter : "All"} {drill === "other" ? "▴" : "▾"}</button>
            <button onClick={() => setCatFilter(catFilter === "__transfer__" ? "all" : "__transfer__")} style={txChipBtn(catFilter === "__transfer__")}>Transfer</button>
            <button onClick={() => toggleDrill("date")} style={txChipBtn(drill === "date")}>Date: {(TX_DATE_OPTIONS.find(([v]) => v === dateFilter) || [, "Any time"])[1]} {drill === "date" ? "▴" : "▾"}</button>
            {activeFilterCount > 0 && (
              <button onClick={() => { setAcctFilter("all"); setCatFilter("all"); setCatSearch(""); setDateFilter("all"); setDateFrom(""); setDateTo(""); setDrill(null); }} style={{ marginLeft: "auto", background: "none", border: "none", fontFamily: F.sans, fontSize: 10.5, fontWeight: 600, color: C.accentText, cursor: "pointer", padding: "6px 4px", whiteSpace: "nowrap" }}>Clear filters</button>
            )}
          </div>
          {drill === "account" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 10px 12px", borderTop: `1px solid ${C.line}` }}>
              <button onClick={() => setAcctFilter("all")} style={{ ...txChipBtn(acctFilter === "all"), marginTop: 8 }}>All accounts</button>
              {book.accounts.map((a) => <button key={a.id} onClick={() => setAcctFilter(a.id)} style={{ ...txChipBtn(acctFilter === a.id), marginTop: 8 }}>{a.name}</button>)}
            </div>
          )}
          {(drill === "income" || drill === "expense" || drill === "other") && (() => {
            const cats = drill === "income" ? usedIncomeCats : drill === "expense" ? usedExpenseCats : usedOtherCats;
            const label = drill === "income" ? "income categories" : drill === "expense" ? "expense categories" : "other movement categories";
            return (
              <div style={{ padding: "10px 10px 12px", borderTop: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 10px", border: `1px solid ${C.overlayBorder}`, borderRadius: 10, marginBottom: 8, background: "#fff" }}>
                  <Ic name="search" size={12} color={C.muted} />
                  <input value={catSearch} onChange={(e) => setCatSearch(e.target.value)} placeholder={`Search ${label}`} style={{ flex: 1, minWidth: 0, border: "none", background: "none", fontFamily: F.sans, fontSize: 11, color: C.ink }} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button onClick={() => setCatFilter("all")} style={txChipBtn(catFilterType !== drill)}>All {label}</button>
                  {cats.map((c) => <button key={c} onClick={() => setCatFilter(c)} style={txChipBtn(catFilter === c)}>{c}</button>)}
                </div>
                {cats.length === 0 && <div style={{ fontSize: 11, color: C.muted, padding: "8px 2px 0" }}>No matching categories.</div>}
              </div>
            );
          })()}
          {drill === "date" && (
            <div style={{ padding: "10px 10px 12px", borderTop: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {TX_DATE_OPTIONS.map(([v, label]) => <button key={v} onClick={() => setDateFilter(v)} style={txChipBtn(dateFilter === v)}>{label}</button>)}
              </div>
              {dateFilter === "custom" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: C.muted, marginBottom: 3 }}>From</div>
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ ...st.input, fontSize: 10.5, padding: "6px 8px" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: C.muted, marginBottom: 3 }}>To</div>
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ ...st.input, fontSize: 10.5, padding: "6px 8px" }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {selectMode && rows.length > 0 && (
        // "Select all" needs at least one row picked first to know which
        // sign to lock to -- otherwise it'd indiscriminately grab both money
        // in and money out. Dimmed the same way a locked opposite-sign row
        // is, rather than just silently doing nothing when tapped.
        <div onClick={() => { if (selected.size > 0) toggleSelectAll(); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 2px 10px", cursor: selected.size === 0 ? "not-allowed" : "pointer", opacity: selected.size === 0 ? 0.45 : 1 }}>
          <div style={{ width: 18, height: 18, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: allSelected ? C.grad : "transparent", border: allSelected ? "none" : `1.5px solid ${C.overlayBorder}` }}>
            {allSelected && <Ic name="check" size={11} color="#fff" />}
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{allSelected ? "Deselect all" : "Select all"}</span>
        </div>
      )}

      {rows.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 10px", fontSize: 12, color: C.muted }}>
          {tab === "explained" ? "No transactions yet." : tab === "unexplained" ? "Nothing to code — you're all caught up." : "Nothing waiting for approval."}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.date}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", padding: "10px 2px 6px" }}>{g.label}</div>
          {g.rows.map((e) => {
            const checked = selected.has(e.id);
            const rowLocked = selectMode && !!lockedType && lockedType !== e.type && !checked;
            const info = tab === "explained" ? explainedRowInfo(book, e) : null;
            const match = tab === "unexplained" ? suggestHead(book, e.merchant || "") : null;
            const transferMatch = tab === "approval" && e.suggestedTransferAccount ? findTransferMatch(book, e, e.suggestedTransferAccount) : null;
            const approvalSuggestion = e.suggestedParty
              ? `${partyName(e.suggestedParty)} (owed)`
              : e.suggestedTransferAccount
              ? `Transfer to ${accountName(e.suggestedTransferAccount)}${transferMatch ? " · matches an entry there" : ""}`
              : e.category;
            return (
              <SwipeRow key={e.id} id={e.id} openId={openSwipeId} setOpenId={setOpenSwipeId} action={swipeActionFor(e)} disabled={selectMode} locked={rowLocked}
                onClick={() => (selectMode ? toggleSelected(e.id) : openSheet("viewTx", { entryId: e.id }))}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  {selectMode && (
                    <div onClick={(ev) => { ev.stopPropagation(); if (!rowLocked) toggleSelected(e.id); }} style={{ width: 17, height: 17, borderRadius: 5, flexShrink: 0, alignSelf: "center", display: "flex", alignItems: "center", justifyContent: "center", cursor: rowLocked ? "not-allowed" : "pointer", background: checked ? C.grad : rowLocked ? C.overlayWash : "transparent", border: checked ? "none" : `1.5px solid ${rowLocked ? C.line : C.overlayBorder}` }}>
                      {checked && <Ic name="check" size={10} color="#fff" />}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {tab === "explained" ? info.title : (e.merchant || "Unrecognized transaction")}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, color: tab === "explained" ? info.color : (e.type === "in" ? C.green : C.ink), fontVariantNumeric: "tabular-nums" }}>
                    {tab === "explained" ? (info.sign || "") : (e.type === "in" ? "+" : "−")}{inr(e.amount)}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                  <div style={{ fontSize: 10, color: C.faint, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", flex: 1 }}>
                    {tab === "explained" ? info.sub : tab === "approval" ? `Suggested: ${approvalSuggestion} · ${accountName(e.accountId)}` : (match !== "Suspense" ? `Auto-matched: ${match}` : "Needs a category") + " · " + accountName(e.accountId)}
                  </div>
                  {tab === "explained" && info.pill && (
                    <span style={{ display: "inline-flex", alignItems: "center", fontSize: 9.5, fontWeight: 500, padding: "2px 8px", borderRadius: 999, background: info.isBS ? "rgba(251,191,36,.18)" : "rgba(17,17,17,.06)", border: info.isBS ? "1px solid rgba(251,191,36,.4)" : "none", color: info.isBS ? C.amberText : "#444", flexShrink: 0, whiteSpace: "nowrap" }}>{info.pill}{info.isBS ? " · BS" : ""}</span>
                  )}
                  {!selectMode && tab === "unexplained" && (
                    <div onClick={(ev) => { ev.stopPropagation(); openCategorize([e.id]); }} style={{ display: "inline-flex", alignItems: "center", fontSize: 9.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999, background: C.accent, color: "#fff", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}>Categorize</div>
                  )}
                </div>
                {/* Full-width, 36px-tall action row -- real thumb-sized targets
                    instead of the cramped 22px circles this used to be, since
                    those were reported too small/fiddly to tap reliably. */}
                {!selectMode && tab === "approval" && (
                  <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
                    <button onClick={(ev) => { ev.stopPropagation(); rejectEntry(e.id); }} style={approvalActionBtnStyle("#7a2e3b", "rgba(122,46,59,.1)")}>
                      <Ic name="close" size={13} color="#7a2e3b" />Reject
                    </button>
                    <button onClick={(ev) => { ev.stopPropagation(); openCategorize([e.id]); }} style={approvalActionBtnStyle(C.accent, C.accentSoft)}>
                      <Ic name="edit" size={13} color={C.accent} />Edit
                    </button>
                    <button onClick={(ev) => { ev.stopPropagation(); approveEntry(e.id); }} style={approvalActionBtnStyle(C.green, "rgba(15,106,92,.14)")}>
                      <Ic name="check" size={14} color={C.green} />Approve
                    </button>
                  </div>
                )}
              </SwipeRow>
            );
          })}
        </div>
      ))}

      {selectMode && selected.size > 0 && tab === "approval" && (
        <div style={{ position: "fixed", left: 16, right: 16, bottom: 82, zIndex: 26, ...glass(16), padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700 }}>{selected.size} selected</div>
          <GhostBtn style={{ width: "auto", padding: "9px 16px" }} onClick={bulkReject}>Reject</GhostBtn>
          <PrimaryBtn style={{ width: "auto", padding: "9px 18px" }} onClick={bulkApprove}>Approve</PrimaryBtn>
        </div>
      )}
      {selectMode && selected.size > 0 && tab === "unexplained" && (
        <div style={{ position: "fixed", left: 16, right: 16, bottom: 82, zIndex: 26, ...glass(16), padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700 }}>{selected.size} selected</div>
          <GhostBtn style={{ width: "auto", padding: "9px 16px" }} onClick={() => deleteEntries(selectedIds)}>Delete</GhostBtn>
          <PrimaryBtn style={{ width: "auto", padding: "9px 18px" }} onClick={() => openCategorize(selectedIds, exitSelectMode)}>Categorize ▾</PrimaryBtn>
        </div>
      )}
      {selectMode && selected.size > 0 && tab === "explained" && (
        <div style={{ position: "fixed", left: 16, right: 16, bottom: 82, zIndex: 26, ...glass(16), padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700 }}>{selected.size} selected</div>
          <GhostBtn style={{ width: "auto", padding: "9px 16px" }} onClick={bulkUnexplain}>Unexplain</GhostBtn>
          {(lockedType === "in" || lockedType === "out") && <PrimaryBtn style={{ width: "auto", padding: "9px 18px" }} onClick={() => openCategorize(selectedIds, exitSelectMode)}>Recategorize ▾</PrimaryBtn>}
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
    <div className="no-print" style={{ marginBottom: 8 }}>
      <div style={{ ...glass(16), display: "flex", alignItems: "center", padding: "10px 12px", gap: 10 }}>
        <div onClick={() => p.setPickerOpen(!p.pickerOpen)} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, cursor: "pointer" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
          <Ic name="chevronDown" size={12} color={C.muted} style={{ flexShrink: 0 }} />
        </div>
        <div style={{ width: 1, height: 20, background: C.line, flexShrink: 0 }} />
        <div onClick={() => p.setCompare(!p.compare)} style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, cursor: "pointer" }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: C.soft, whiteSpace: "nowrap" }}>Compare</span>
          <Toggle value={p.compare} onChange={p.setCompare} reverse />
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
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{info.title}</div>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, marginTop: 1 }}>{info.sub}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: info.color, fontVariantNumeric: "tabular-nums" }}>{info.sign}{inr(e.amount)}</div>
                <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, marginTop: 1 }}>{e.date}</div>
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
  const fire = (kind, fn) => {
    Promise.resolve(fn()).then(() => {
      setFlash(kind);
      setTimeout(() => setFlash((k) => (k === kind ? null : k)), 1600);
    });
  };
  return (
    <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      <div onClick={() => fire("excel", onExcel)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", borderRadius: 12, background: "rgba(15,106,92,.08)", color: C.green, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
        <Ic name="upload" size={13} color={C.green} />{flash === "excel" ? "Exported ✓" : "Export Excel"}
      </div>
      <div onClick={() => fire("pdf", onPdf)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", borderRadius: 12, background: "rgba(122,46,59,.08)", color: "#7a2e3b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
        <Ic name="upload" size={13} color="#7a2e3b" />{flash === "pdf" ? "Exported ✓" : "Export PDF"}
      </div>
    </div>
  );
}

// The print-only report layout Export PDF actually produces -- a clean A4/
// Letter table (title, period, generated-on date) instead of a printout of
// the phone-width app chrome. rows: [{ kind: "section"|"data"|"total"|"net"
// |"balance", label, current, previous }].
function PrintReport({ reportTitle, periodLabel, prevPeriodLabel, compare, rows }) {
  return (
    <div className="print-only">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>Cash Book</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{reportTitle}</div>
      <div style={{ fontSize: 11, color: "#555", marginBottom: 2 }}>Period: {periodLabel}{compare ? ` · Compared to ${prevPeriodLabel}` : ""}</div>
      <div style={{ fontSize: 9.5, color: "#888", marginBottom: 14 }}>Generated on {new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div>
      <table className="print-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>{periodLabel}</th>
            {compare && <th>{prevPeriodLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (r.kind === "section") return <tr key={i} className="print-section-row"><td colSpan={compare ? 3 : 2}>{r.label}</td></tr>;
            const cls = r.kind === "total" ? "print-total-row" : r.kind === "net" ? "print-net-row" : "";
            return (
              <tr key={i} className={cls}>
                <td>{r.label}</td>
                <td>{r.current}</td>
                {compare && <td>{r.previous}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Export Excel: a real, auditable .xlsx workbook -- bold navy header row,
// shaded section headers, real numbers with a currency format (so a user
// can re-sort/re-total in Excel), and live SUM/reference formulas for every
// total/net/closing row rather than baked-in values.
const RPT_CURRENCY_FMT = '"₹"#,##0;[Red]-"₹"#,##0';
function xlsxTitleBlock(ws, reportTitle, periodLabel, prevPeriodLabel, compare) {
  ws.addRow(["Cash Book"]).font = { bold: true, size: 14 };
  ws.addRow([reportTitle]).font = { bold: true, size: 12, color: { argb: "FF1D3A8F" } };
  ws.addRow([`Period: ${periodLabel}` + (compare ? `   |   Compared to: ${prevPeriodLabel}` : "")]).font = { italic: true, size: 10, color: { argb: "FF555555" } };
  ws.addRow([`Generated on ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`]).font = { size: 9, color: { argb: "FF999999" } };
  ws.addRow([]);
  const header = ws.addRow(compare ? ["Category", periodLabel, prevPeriodLabel] : ["Category", periodLabel]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D3A8F" } }; });
  header.getCell(2).alignment = { horizontal: "right" };
  if (compare) header.getCell(3).alignment = { horizontal: "right" };
}
function xlsxSectionRow(ws, label) {
  const r = ws.addRow([label]);
  r.font = { bold: true, size: 10, color: { argb: "FF555555" } };
  r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  return r;
}
function xlsxDataRow(ws, label, cur, prev, compare) {
  const r = ws.addRow(compare ? [label, cur, prev] : [label, cur]);
  r.getCell(2).numFmt = RPT_CURRENCY_FMT;
  if (compare) r.getCell(3).numFmt = RPT_CURRENCY_FMT;
  return r;
}
function xlsxTotalRow(ws, label, startRowNum, endRowNum, compare, hasRows) {
  const cur = hasRows ? { formula: `SUM(B${startRowNum}:B${endRowNum})` } : 0;
  const prev = !compare ? undefined : hasRows ? { formula: `SUM(C${startRowNum}:C${endRowNum})` } : 0;
  const r = ws.addRow(compare ? [label, cur, prev] : [label, cur]);
  r.font = { bold: true };
  r.getCell(1).border = { top: { style: "thin" } };
  r.getCell(2).numFmt = RPT_CURRENCY_FMT;
  r.getCell(2).border = { top: { style: "thin" } };
  if (compare) { r.getCell(3).numFmt = RPT_CURRENCY_FMT; r.getCell(3).border = { top: { style: "thin" } }; }
  return r;
}
function xlsxNetRow(ws, label, curFormula, prevFormula, compare, color) {
  const r = ws.addRow(compare ? [label, { formula: curFormula }, { formula: prevFormula }] : [label, { formula: curFormula }]);
  r.font = { bold: true, size: 12, color: { argb: color } };
  r.getCell(1).border = { top: { style: "double" } };
  r.getCell(2).numFmt = RPT_CURRENCY_FMT;
  r.getCell(2).border = { top: { style: "double" } };
  if (compare) { r.getCell(3).numFmt = RPT_CURRENCY_FMT; r.getCell(3).border = { top: { style: "double" } }; r.getCell(3).font = { size: 10, color: { argb: "FF999999" } }; }
  return r;
}
async function downloadWorkbook(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function PLReport({ book, p, openSheet }) {
  const pl = computePL(book, p.from, p.to);
  const prevPl = p.compare ? computePL(book, p.prevFrom, p.prevTo) : null;
  const income = Object.entries(pl.income).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const expense = Object.entries(pl.expense).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const inRange = (e) => e.date >= p.from && e.date <= p.to && isExplained(e);
  const openCategory = (title, entries) => openSheet("categoryDetail", { title, entries });

  const downloadXlsx = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Cash Book";
    wb.created = new Date();
    const ws = wb.addWorksheet("Profit & Loss");
    ws.columns = p.compare ? [{ width: 30 }, { width: 16 }, { width: 16 }] : [{ width: 30 }, { width: 16 }];
    xlsxTitleBlock(ws, "Profit & Loss Report", p.label, p.prevLabel, p.compare);

    xlsxSectionRow(ws, "Income");
    const incomeStart = ws.rowCount + 1;
    if (income.length === 0) ws.addRow(["No income recorded"]);
    else for (const [c, a] of income) xlsxDataRow(ws, c, a, prevPl ? (prevPl.income[c] || 0) : 0, p.compare);
    const totalIncomeRow = xlsxTotalRow(ws, "Total Income", incomeStart, ws.rowCount, p.compare, income.length > 0);

    xlsxSectionRow(ws, "Expenses");
    const expenseStart = ws.rowCount + 1;
    if (expense.length === 0) ws.addRow(["No expenses recorded"]);
    else for (const [c, a] of expense) xlsxDataRow(ws, c, -a, prevPl ? -(prevPl.expense[c] || 0) : 0, p.compare);
    const totalExpenseRow = xlsxTotalRow(ws, "Total Expenses", expenseStart, ws.rowCount, p.compare, expense.length > 0);

    xlsxNetRow(ws, "Net Profit", `B${totalIncomeRow.number}+B${totalExpenseRow.number}`,
      p.compare ? `C${totalIncomeRow.number}+C${totalExpenseRow.number}` : null, p.compare, pl.net < 0 ? "FF7A2E3B" : "FF0F6A5C");

    await downloadWorkbook(wb, `cash-book-pl-${p.from}-to-${p.to}.xlsx`);
  };

  const printRows = [
    { kind: "section", label: "Income" },
    ...(income.length === 0
      ? [{ kind: "data", label: "No income recorded", current: "", previous: "" }]
      : income.map(([c, a]) => ({ kind: "data", label: c, current: plusInr(a), previous: prevPl ? plusInr(prevPl.income[c] || 0) : "" }))),
    { kind: "total", label: "Total Income", current: plusInr(pl.totalIncome), previous: prevPl ? plusInr(prevPl.totalIncome) : "" },
    { kind: "section", label: "Expenses" },
    ...(expense.length === 0
      ? [{ kind: "data", label: "No expenses recorded", current: "", previous: "" }]
      : expense.map(([c, a]) => ({ kind: "data", label: c, current: minusInr(a), previous: prevPl ? minusInr(prevPl.expense[c] || 0) : "" }))),
    { kind: "total", label: "Total Expenses", current: minusInr(pl.totalExpense), previous: prevPl ? minusInr(prevPl.totalExpense) : "" },
    { kind: "net", label: "Net Profit", current: signedInr(pl.net), previous: prevPl ? signedInr(prevPl.net) : "" },
  ];

  return (
    <div>
      <PeriodPicker {...p} />
      <ExportPills onExcel={downloadXlsx} onPdf={() => window.print()} />

      <div className="no-print" style={{ ...glass(16), padding: "4px 14px 14px" }}>
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

      <PrintReport reportTitle="Profit & Loss Report" periodLabel={p.label} prevPeriodLabel={p.prevLabel} compare={p.compare} rows={printRows} />
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

  const downloadXlsx = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Cash Book";
    wb.created = new Date();
    const ws = wb.addWorksheet("Cash Flow");
    ws.columns = p.compare ? [{ width: 30 }, { width: 16 }, { width: 16 }] : [{ width: 30 }, { width: 16 }];
    xlsxTitleBlock(ws, "Cash Flow Report", p.label, p.prevLabel, p.compare);

    const openingRow = ws.addRow(p.compare ? ["Opening Balance", cf.opening, prevCf ? prevCf.opening : 0] : ["Opening Balance", cf.opening]);
    openingRow.font = { bold: true };
    openingRow.getCell(2).numFmt = RPT_CURRENCY_FMT;
    if (p.compare) openingRow.getCell(3).numFmt = RPT_CURRENCY_FMT;

    xlsxSectionRow(ws, "Money In");
    const inStart = ws.rowCount + 1;
    if (cf.moneyIn.length === 0) ws.addRow(["No money in recorded"]);
    else for (const r of cf.moneyIn) xlsxDataRow(ws, r.category, r.amount, prevIn ? (prevIn[r.category] || 0) : 0, p.compare);
    const totalInRow = xlsxTotalRow(ws, "Total Money In", inStart, ws.rowCount, p.compare, cf.moneyIn.length > 0);

    xlsxSectionRow(ws, "Money Out");
    const outStart = ws.rowCount + 1;
    if (cf.moneyOut.length === 0) ws.addRow(["No money out recorded"]);
    else for (const r of cf.moneyOut) xlsxDataRow(ws, r.category, -r.amount, prevOut ? -(prevOut[r.category] || 0) : 0, p.compare);
    const totalOutRow = xlsxTotalRow(ws, "Total Money Out", outStart, ws.rowCount, p.compare, cf.moneyOut.length > 0);

    xlsxSectionRow(ws, "Other Movement");
    const otherStart = ws.rowCount + 1;
    if (cf.other.length === 0) ws.addRow(["No other movements recorded"]);
    else for (const r of cf.other) xlsxDataRow(ws, r.label + (r.bs ? " (Balance Sheet)" : ""), r.amount, prevOther ? (prevOther[r.label] || 0) : 0, p.compare);
    const totalOtherRow = xlsxTotalRow(ws, "Total Other Movement", otherStart, ws.rowCount, p.compare, cf.other.length > 0);

    const netRow = xlsxNetRow(ws, "Net Cash Flow", `B${totalInRow.number}+B${totalOutRow.number}+B${totalOtherRow.number}`,
      p.compare ? `C${totalInRow.number}+C${totalOutRow.number}+C${totalOtherRow.number}` : null, p.compare, cf.net < 0 ? "FF7A2E3B" : "FF0F6A5C");

    const closingRow = ws.addRow(p.compare
      ? ["Closing Balance", { formula: `B${openingRow.number}+B${netRow.number}` }, { formula: `C${openingRow.number}+C${netRow.number}` }]
      : ["Closing Balance", { formula: `B${openingRow.number}+B${netRow.number}` }]);
    closingRow.font = { bold: true };
    closingRow.getCell(2).numFmt = RPT_CURRENCY_FMT;
    if (p.compare) closingRow.getCell(3).numFmt = RPT_CURRENCY_FMT;

    await downloadWorkbook(wb, `cash-book-cashflow-${p.from}-to-${p.to}.xlsx`);
  };

  const printRows = [
    { kind: "balance", label: "Opening Balance", current: magInr(cf.opening), previous: prevCf ? magInr(prevCf.opening) : "" },
    { kind: "section", label: "Money In" },
    ...(cf.moneyIn.length === 0
      ? [{ kind: "data", label: "No money in recorded", current: "", previous: "" }]
      : cf.moneyIn.map((r) => ({ kind: "data", label: r.category, current: plusInr(r.amount), previous: prevIn ? plusInr(prevIn[r.category] || 0) : "" }))),
    { kind: "total", label: "Total Money In", current: plusInr(cf.totalIn), previous: prevCf ? plusInr(prevCf.totalIn) : "" },
    { kind: "section", label: "Money Out" },
    ...(cf.moneyOut.length === 0
      ? [{ kind: "data", label: "No money out recorded", current: "", previous: "" }]
      : cf.moneyOut.map((r) => ({ kind: "data", label: r.category, current: minusInr(r.amount), previous: prevOut ? minusInr(prevOut[r.category] || 0) : "" }))),
    { kind: "total", label: "Total Money Out", current: minusInr(cf.totalOut), previous: prevCf ? minusInr(prevCf.totalOut) : "" },
    { kind: "section", label: "Other Movement" },
    ...(cf.other.length === 0
      ? [{ kind: "data", label: "No other movements recorded", current: "", previous: "" }]
      : cf.other.map((r) => ({ kind: "data", label: r.label + (r.bs ? " (Balance Sheet)" : ""), current: signedInr(r.amount), previous: prevOther ? signedInr(prevOther[r.label] || 0) : "" }))),
    { kind: "total", label: "Total Other Movement", current: signedInr(cf.totalOther), previous: prevCf ? signedInr(prevCf.totalOther) : "" },
    { kind: "net", label: "Net Cash Flow", current: signedInr(cf.net), previous: prevCf ? signedInr(prevCf.net) : "" },
    { kind: "balance", label: "Closing Balance", current: magInr(cf.closing), previous: prevCf ? magInr(prevCf.closing) : "" },
  ];

  return (
    <div>
      <PeriodPicker {...p} />
      <ExportPills onExcel={downloadXlsx} onPdf={() => window.print()} />

      <div className="no-print" style={{ ...glass(16), padding: "4px 14px 14px" }}>
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

      <PrintReport reportTitle="Cash Flow Report" periodLabel={p.label} prevPeriodLabel={p.prevLabel} compare={p.compare} rows={printRows} />
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
      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Reports</div>
        <RoundBtn onClick={() => setInfoOpen(true)}><Ic name="info" size={15} color={C.soft} /></RoundBtn>
      </div>
      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title={info.title}>
        {info.paragraphs.map((t, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: C.soft, marginBottom: 8 }}>{t}</div>)}
        <PrimaryBtn style={{ marginTop: 8 }} onClick={() => setInfoOpen(false)}>Got it</PrimaryBtn>
      </Modal>
      <div className="no-print">
        <Seg value={view} onChange={setView} style={{ marginBottom: 10 }} options={[{ v: "pl", label: "P&L" }, { v: "cashflow", label: "Cash Flow" }]} />
      </div>
      {view === "pl" ? <PLReport book={book} p={p} openSheet={openSheet} /> : <CashFlowReport book={book} p={p} openSheet={openSheet} />}
    </div>
  );
}

/* ══════════════════════════ SETUP ══════════════════════════ */
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

// iOS-style grouped sections -- a profile row up top, then SETUP / SECURITY /
// DATA groups, each row a soft-tint colored icon chip with a trailing status
// pill, matching the colored-chip + section-header language already used
// elsewhere in the app (Reports categories, Transactions filter groups).
// A compact iOS-style switch for the dense settings-list toggles (Passcode,
// Hide balances, per-rule enable, notification prefs) -- distinct from the
// segmented Off/On <Toggle> used in form contexts (Add Transaction, Code
// Transaction), which would be far too large repeated down a settings list.
function Switch({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{ width: 38, height: 22, borderRadius: 999, background: value ? C.accent : "rgba(17,17,17,.15)", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s ease" }}>
      <div style={{ position: "absolute", top: 2, left: value ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(17,17,17,.3)", transition: "left .15s ease" }} />
    </div>
  );
}

// A plain settings-list row -- label, optional meta text or right-side
// control, and a chevron if it navigates -- with a bottom-border divider on
// every row but the last. Matches the approved handoff's actual Settings
// screen exactly: no icon chips (this app's own earlier guess, before the
// real Settings screen state inside the combined mockup file was found).
function SettingsRow({ label, meta, onClick, last, right }) {
  return (
    <div className={onClick ? "tap" : undefined} onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", borderBottom: last ? "none" : `1px solid ${C.line}`, cursor: onClick ? "pointer" : "default" }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500 }}>{label}</span>
      {meta != null && <span style={{ fontSize: 9.5, color: C.muted, flexShrink: 0 }}>{meta}</span>}
      {right}
      {onClick && !right && <div style={{ color: C.faint, fontSize: 15, flexShrink: 0 }}>›</div>}
    </div>
  );
}

// A small styled confirm dialog matching the mockup's own delete-account and
// log-out popups -- used here for deleting an account, which is the one
// Setup action destructive enough (it also deletes every transaction on
// that account) to warrant more than a plain native confirm().
function ConfirmModal({ open, title, body, confirmLabel, onCancel, onConfirm }) {
  if (!open) return null;
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 210, background: C.dimBg, backdropFilter: "blur(10px) saturate(140%)", WebkitBackdropFilter: "blur(10px) saturate(140%)", display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn .18s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 270, background: "#fff", borderRadius: 18, padding: 20, boxShadow: "0 12px 30px rgba(17,17,17,.2)", fontFamily: F.sans, animation: "popIn .18s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, textAlign: "center" }}>{title}</div>
        <div style={{ fontSize: 11.5, color: C.muted, textAlign: "center", marginBottom: 18 }}>{body}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "10px 0", border: `1px solid ${C.overlayBorder}`, borderRadius: 10, background: "none", color: C.ink, fontFamily: F.sans, fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 10, background: "#c33", color: "#fff", fontFamily: F.sans, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>{confirmLabel || "Delete"}</button>
        </div>
      </div>
    </div>
  );
}

const NOTIF_PREF_DEFS = [
  { key: "paymentDue", label: "Payment due reminders", desc: "Before a credit card payment is due" },
  { key: "unexplained", label: "Unexplained transactions", desc: "When a bank transaction needs a category" },
  { key: "approval", label: "Awaiting approval", desc: "When an auto-categorized transaction needs review" },
];

// Single-view-state Setup screen, matching the approved handoff's actual
// Settings screen exactly (found inside Cash Book Home.dc.html's own
// 'settings' state -- a fuller and more authoritative source than the
// separate static "Settings Screen Options" exploration file this screen
// was first built from). Currency and Financial-period preferences, and the
// Sessions/Log-out block, are in that mockup but assume a cloud-backed
// multi-currency, accrual-accounting, multi-device product this app simply
// isn't -- none of that exists anywhere in engine.js, so they're dropped
// rather than faked, same as dropping the mockup's non-functional "Merge"
// button in Transactions.
function SetupScreen({ book, up, onLockNow, openSheet }) {
  const [view, setView] = useState("list");
  const [resetOpen, setResetOpen] = useState(false);
  const back = () => setView("list");
  const resetApp = () => {
    up((b) => { for (const k of Object.keys(b)) delete b[k]; Object.assign(b, defaultBook()); });
    setResetOpen(false);
    setView("list");
  };

  const expenseCats = book.categories.expense.filter((c) => c !== "Suspense");
  const notifOnCount = NOTIF_PREF_DEFS.filter((n) => (book.prefs.notifPrefs || {})[n.key] !== false).length;

  return (
    <>
      <div style={{ padding: "4px 16px 90px" }}>
        <div className="tap" onClick={() => setView("profile")} style={{ ...glass(16), padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
          <div style={{ width: 42, height: 42, borderRadius: "50%", background: C.grad, color: "#fff", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {(book.prefs.name || "").trim().charAt(0).toUpperCase() || "?"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{book.prefs.name || "Add your name"}</div>
            <div style={{ fontSize: 10.5, color: C.muted }}>Tap to edit profile</div>
          </div>
          <div style={{ color: C.faint, fontSize: 15, flexShrink: 0 }}>›</div>
        </div>

        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em", padding: "0 2px 6px", marginTop: 18 }}>Setup</div>
        <Card style={{ padding: "0 14px" }}>
          <SettingsRow label="Accounts" meta={`${book.accounts.length}`} onClick={() => setView("accounts")} />
          <SettingsRow label="Income categories" meta={`${book.categories.income.length}`} onClick={() => setView("income")} />
          <SettingsRow label="Expense categories" meta={`${expenseCats.length}`} onClick={() => setView("expense")} />
          <SettingsRow label="Balance Sheet categories" meta={`${book.bsCategories.length}`} onClick={() => setView("other")} />
          <SettingsRow label="Auto-coding rules" meta={`${book.codingRules.length}`} last onClick={() => setView("rules")} />
        </Card>

        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em", padding: "0 2px 6px", marginTop: 18 }}>Preferences</div>
        <Card style={{ padding: "0 14px" }}>
          <SettingsRow label="Notifications" meta={`${notifOnCount} on`} last onClick={() => setView("notifications")} />
        </Card>

        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em", padding: "0 2px 6px", marginTop: 18 }}>Security</div>
        <Card style={{ padding: "0 14px" }}>
          <SettingsRow label="Passcode & security" last onClick={() => setView("security")} />
        </Card>

        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em", padding: "0 2px 6px", marginTop: 18 }}>Data</div>
        <Card style={{ padding: "0 14px" }}>
          <SettingsRow label="Backup & Restore" onClick={() => setView("backup")} />
          <SettingsRow label={<span style={{ color: "#c33" }}>Reset app</span>} last onClick={() => setResetOpen(true)} />
        </Card>
      </div>

      <ConfirmModal open={resetOpen} title="Reset Cash Book?"
        body="This permanently erases every account, transaction, category, and rule stored on this device, and restores the default categories and auto-coding rules. This can't be undone."
        confirmLabel="Reset" onCancel={() => setResetOpen(false)} onConfirm={resetApp} />

      <ProfilePage open={view === "profile"} book={book} up={up} onBack={back} />
      <AccountsPage open={view === "accounts"} book={book} up={up} onBack={back} openSheet={openSheet} />
      <CategoryListPage open={view === "income"} title="Income categories" onBack={back}
        help="Where money-in transactions get coded — these count toward P&amp;L too."
        cats={book.categories.income}
        onDelete={(c) => { if (confirmCategoryDelete(book, c)) up((b) => { b.categories.income = b.categories.income.filter((x) => x !== c); }); }}
        onAdd={(name) => up((b) => { if (!b.categories.income.includes(name)) b.categories.income.push(name); })}
        addPlaceholder="New category name" />
      <CategoryListPage open={view === "expense"} title="Expense categories" onBack={back}
        help="Your everyday expense categories — these count toward P&amp;L."
        cats={expenseCats}
        onDelete={(c) => { if (confirmCategoryDelete(book, c)) up((b) => { b.categories.expense = b.categories.expense.filter((x) => x !== c); }); }}
        onAdd={(name) => up((b) => { if (!b.categories.expense.includes(name)) b.categories.expense.splice(b.categories.expense.length - 1, 0, name); })}
        addPlaceholder="New category name" />
      <CategoryListPage open={view === "other"} title="Balance Sheet categories" onBack={back}
        help="A separate list, on purpose — these are real cash movements (EMI principal, lending, etc.) that always show in Cash Flow but never count as P&amp;L income or expense."
        cats={book.bsCategories}
        onDelete={(c) => { if (confirmCategoryDelete(book, c, "It'll also disappear from Cash Flow's Balance Sheet section for new activity. ")) up((b) => { b.bsCategories = b.bsCategories.filter((x) => x !== c); }); }}
        onAdd={(name) => up((b) => { if (!b.bsCategories.includes(name)) b.bsCategories.push(name); })}
        addPlaceholder="e.g. Car Loan EMI" />
      <RulesPage open={view === "rules"} book={book} up={up} onBack={back} />
      <NotificationsPrefsPage open={view === "notifications"} book={book} up={up} onBack={back} />
      <SecurityPage open={view === "security"} book={book} up={up} onBack={back} onLockNow={onLockNow} />
      <BackupPage open={view === "backup"} book={book} up={up} onBack={back} />
    </>
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

// Shared shape for Income / Expense / Balance Sheet categories -- a plain
// name+delete list with an inline add row below, matching the mockup
// exactly (the mockup itself never confirms a delete since it isn't backed
// by real data; onDelete callers here still route through
// confirmCategoryDelete, which is a real correctness guard, not decoration).
function CategoryListPage({ open, title, help, cats, onDelete, onAdd, addPlaceholder, onBack }) {
  return (
    <PageOverlay open={open} onBack={onBack} title={title}>
      {help && <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }} dangerouslySetInnerHTML={{ __html: help }} />}
      <Card style={{ padding: "0 14px", marginBottom: 14 }}>
        {cats.map((c, i) => (
          <SettingsRow key={c} label={c} last={i === cats.length - 1} right={
            <div onClick={() => onDelete(c)} style={{ cursor: "pointer", padding: 4, display: "flex" }}><Ic name="trash" size={14} color="#c33" /></div>
          } />
        ))}
        {cats.length === 0 && <div style={{ padding: "12px 0", fontSize: 12, color: C.muted }}>None yet.</div>}
      </Card>
      <Card style={{ padding: "12px 14px", display: "flex", gap: 8 }}>
        <AddInline placeholder={addPlaceholder} onAdd={onAdd} />
      </Card>
    </PageOverlay>
  );
}

// Auto-coding rules: each rule can be individually enabled/disabled (a real
// switch backed by engine.js's suggestHead/applyCodingRules skipping
// r.enabled === false), not just deleted. The rule's target category is
// still a picker constrained to real categories, not free text -- a
// category name typed by hand that doesn't exist anywhere else would
// silently orphan any row coded to it (missing from every other category
// picker in the app). Same reasoning extends "Owed person" and "Transfer"
// as further real target types, alongside Income/Expense/Balance Sheet
// category groups -- matching the same Category/Owed person/Transfer split
// CategorizeSheet already offers for manual recoding, rather than a flat
// unbifurcated list. A transfer match never merges/deletes anything on its
// own sweep -- it only ever sets e.suggestedTransferAccount and waits in
// the Approval tab, so a wrong guess can't silently corrupt real imported
// transactions; the actual merge (see recodeEntryAsTransfer) only happens
// once a human approves it there.
function RulesPage({ open, book, up, onBack }) {
  const [adding, setAdding] = useState(false);
  const [match, setMatch] = useState("");
  const [targetType, setTargetType] = useState("category"); // category | party | transfer
  const [head, setHead] = useState(book.categories.expense.find((c) => c !== "Suspense") || book.categories.income[0] || "");
  const [partyId, setPartyId] = useState(book.parties[0] ? book.parties[0].id : "");
  const [toAccountId, setToAccountId] = useState(book.accounts[0] ? book.accounts[0].id : "");
  const [catSearch, setCatSearch] = useState("");
  const [addingParty, setAddingParty] = useState(false);
  const [newPartyName, setNewPartyName] = useState("");

  const catGroups = [
    { label: "Income", items: book.categories.income },
    { label: "Expense", items: book.categories.expense.filter((c) => c !== "Suspense") },
    { label: "Balance Sheet", items: book.bsCategories },
  ]
    .map((g) => ({ ...g, items: g.items.filter((c) => c.toLowerCase().includes(catSearch.trim().toLowerCase())) }))
    .filter((g) => g.items.length > 0);

  const targetLabel = (r) =>
    r.targetType === "party" ? `${(book.parties.find((p) => p.id === r.partyId) || {}).name || "Unknown"} (owed)`
    : r.targetType === "transfer" ? `Transfer to ${(book.accounts.find((a) => a.id === r.toAccountId) || {}).name || "Unknown"}`
    : r.head;

  const addRule = () => {
    if (!match.trim()) return;
    if (targetType === "party" && !partyId) return;
    if (targetType === "transfer" && !toAccountId) return;
    up((b) => {
      if (targetType === "party") b.codingRules.push({ match: match.trim(), targetType: "party", partyId, enabled: true });
      else if (targetType === "transfer") b.codingRules.push({ match: match.trim(), targetType: "transfer", toAccountId, enabled: true });
      else b.codingRules.push({ match: match.trim(), targetType: "category", head, enabled: true });
      applyCodingRules(b);
    });
    setMatch("");
    setAdding(false);
  };
  const addPartyInline = () => {
    const n = newPartyName.trim();
    if (!n) return;
    const id = uid();
    up((b) => { b.parties.push({ id, name: n }); });
    setPartyId(id);
    setAddingParty(false);
    setNewPartyName("");
  };

  return (
    <PageOverlay open={open} onBack={onBack} title="Auto-coding rules">
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Automatically categorize transactions whose description matches a rule.</div>
      <Card style={{ padding: "0 14px", marginBottom: 12 }}>
        {book.codingRules.map((r, i) => (
          <SettingsRow key={r.match + i} last={i === book.codingRules.length - 1} label={
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>If contains "{r.match}"</div>
              <div style={{ fontSize: 10.5, color: C.muted }}>→ {targetLabel(r)}</div>
            </div>
          } right={
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Switch value={r.enabled !== false} onChange={(on) => up((b) => { b.codingRules[i].enabled = on; })} />
              <div onClick={() => up((b) => { b.codingRules.splice(i, 1); })} style={{ cursor: "pointer", padding: 4, display: "flex" }}><Ic name="trash" size={13} color="#c33" /></div>
            </div>
          } />
        ))}
        {book.codingRules.length === 0 && <div style={{ padding: "12px 0", fontSize: 12, color: C.muted }}>No rules yet.</div>}
      </Card>
      <DashedBtn onClick={() => setAdding((v) => !v)}>+ Add rule</DashedBtn>
      {adding && (
        <Card style={{ padding: "14px 16px", marginTop: 10 }}>
          <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 4 }}>If description contains</div>
          <input style={{ ...st.input, marginBottom: 12 }} placeholder="e.g. SWIGGY" value={match} onChange={(e) => setMatch(e.target.value)} autoFocus />
          <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 6 }}>Categorize as</div>
          <Seg value={targetType} onChange={setTargetType} style={{ marginBottom: 12 }} options={[{ v: "category", label: "Category" }, { v: "party", label: "Owed person" }, { v: "transfer", label: "Transfer" }]} />
          {targetType === "category" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 10px", border: `1px solid ${C.overlayBorder}`, borderRadius: 10, marginBottom: 8, background: "#fff" }}>
                <Ic name="search" size={12} color={C.muted} />
                <input value={catSearch} onChange={(e) => setCatSearch(e.target.value)} placeholder="Search categories" style={{ flex: 1, minWidth: 0, border: "none", background: "none", fontFamily: F.sans, fontSize: 11, color: C.ink }} />
              </div>
              <div style={{ maxHeight: 180, overflowY: "auto", marginBottom: 12 }}>
                {catGroups.map((g) => (
                  <div key={g.label} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 5 }}>{g.label}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {g.items.map((c) => <button key={c} onClick={() => setHead(c)} style={txChipBtn(head === c)}>{c}</button>)}
                    </div>
                  </div>
                ))}
                {catGroups.length === 0 && <div style={{ fontSize: 11, color: C.muted }}>No matching categories.</div>}
              </div>
            </>
          )}
          {targetType === "party" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {book.parties.map((p) => <button key={p.id} onClick={() => setPartyId(p.id)} style={txChipBtn(partyId === p.id)}>{p.name}</button>)}
              {addingParty ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={newPartyName} autoFocus onChange={(e) => setNewPartyName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPartyInline()} placeholder="Person's name" style={{ ...st.input, padding: "5px 9px", fontSize: 10.5, width: 120 }} />
                  <button onClick={addPartyInline} style={{ ...txChipBtn(false), border: "none" }}>Add</button>
                </div>
              ) : (
                <button onClick={() => setAddingParty(true)} style={txChipBtn(false)}>+ New person</button>
              )}
            </div>
          )}
          {targetType === "transfer" && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {book.accounts.map((a) => <button key={a.id} onClick={() => setToAccountId(a.id)} style={txChipBtn(toAccountId === a.id)}>{a.name}</button>)}
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
                A match only ever gets suggested in the Approval tab — nothing merges automatically. If a matching entry already exists in {(book.accounts.find((a) => a.id === toAccountId) || {}).name || "the other account"}, approving will link the two into one transfer and remove the duplicate; otherwise it's saved as a one-sided transfer that links up once the other side is imported.
              </div>
            </>
          )}
          <PrimaryBtn onClick={addRule}>Save rule</PrimaryBtn>
        </Card>
      )}
    </PageOverlay>
  );
}

function NotificationsPrefsPage({ open, book, up, onBack }) {
  const prefs = book.prefs.notifPrefs || {};
  return (
    <PageOverlay open={open} onBack={onBack} title="Notifications">
      <Card style={{ padding: "0 14px" }}>
        {NOTIF_PREF_DEFS.map((n, i) => (
          <SettingsRow key={n.key} last={i === NOTIF_PREF_DEFS.length - 1} label={
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{n.label}</div>
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{n.desc}</div>
            </div>
          } right={<Switch value={prefs[n.key] !== false} onChange={(on) => up((b) => { b.prefs.notifPrefs = { ...(b.prefs.notifPrefs || {}), [n.key]: on }; })} />} />
        ))}
      </Card>
    </PageOverlay>
  );
}

function ProfilePage({ open, book, up, onBack }) {
  const [name, setName] = useState(book.prefs.name || "");
  useEffect(() => { if (open) setName(book.prefs.name || ""); }, [open]);
  return (
    <PageOverlay open={open} onBack={onBack} title="Profile">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.grad, color: "#fff", fontWeight: 700, fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {(name || "").trim().charAt(0).toUpperCase() || "?"}
        </div>
      </div>
      <Card style={{ padding: "14px 16px", marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 4 }}>Name</div>
        <input style={{ width: "100%", boxSizing: "border-box", border: "none", background: "none", fontFamily: F.sans, fontSize: 13, fontWeight: 600, padding: 0, color: C.ink, outline: "none" }} placeholder="e.g. Asha" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Card>
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 12 }}>Shown on Home. Never leaves this device.</div>
      <PrimaryBtn onClick={() => { up((b) => { b.prefs.name = name.trim(); }); onBack(); }}>Save</PrimaryBtn>
    </PageOverlay>
  );
}

const AUTO_LOCK_OPTIONS = [
  ["immediate", "Immediately"],
  ["1min", "After 1 min"],
  ["5min", "After 5 min"],
];

function SecurityPage({ open, book, up, onBack, onLockNow }) {
  const [changeOpen, setChangeOpen] = useState(false);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const passcodeOn = book.prefs.lock.on;

  const openChange = () => { setP1(""); setP2(""); setErr(""); setChangeOpen(true); };
  const saveChange = () => {
    if (p1.length !== 4) { setErr("Enter a 4-digit passcode"); return; }
    if (p1 !== p2) { setErr("Passcodes don't match"); return; }
    up((b) => { b.prefs.lock.pin = p1; b.prefs.lock.on = true; });
    setChangeOpen(false);
  };

  return (
    <PageOverlay open={open} onBack={onBack} title="Security">
      <Card style={{ padding: "0 14px", marginBottom: 14 }}>
        <SettingsRow label="Passcode" right={<Switch value={passcodeOn} onChange={(on) => {
          if (on && !book.prefs.lock.pin) { openChange(); return; }
          up((b) => { b.prefs.lock.on = on; });
        }} />} />
        {passcodeOn && <SettingsRow label="Change passcode" onClick={openChange} />}
        <SettingsRow last label="Hide balances until unlocked" right={<Switch value={!!book.prefs.hideBalances} onChange={(on) => up((b) => { b.prefs.hideBalances = on; })} />} />
      </Card>

      {passcodeOn && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em", padding: "0 2px 6px" }}>Auto-lock</div>
          <div style={{ display: "flex", background: "rgba(17,17,17,.06)", borderRadius: 10, padding: 3, marginBottom: 10 }}>
            {AUTO_LOCK_OPTIONS.map(([v, label]) => {
              const active = (book.prefs.autoLockOption || "1min") === v;
              return <div key={v} onClick={() => up((b) => { b.prefs.autoLockOption = v; })} style={{ flex: 1, textAlign: "center", padding: "7px 0", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", background: active ? C.accent : "transparent", color: active ? "#fff" : "#777" }}>{label}</div>;
            })}
          </div>
          <div onClick={onLockNow} style={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, color: C.accentText, padding: "6px 0 14px", cursor: "pointer" }}>Lock Cash Book now</div>
        </>
      )}

      {changeOpen && (
        <div onClick={() => setChangeOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 210, background: C.dimBg, backdropFilter: "blur(10px) saturate(140%)", WebkitBackdropFilter: "blur(10px) saturate(140%)", display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn .18s ease" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 270, background: "#fff", borderRadius: 18, padding: 20, boxShadow: "0 12px 30px rgba(17,17,17,.2)", fontFamily: F.sans, animation: "popIn .18s cubic-bezier(.2,.8,.2,1)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, textAlign: "center" }}>{book.prefs.lock.pin ? "Change passcode" : "Set passcode"}</div>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 5 }}>New passcode</div>
            <input type="tel" maxLength={4} inputMode="numeric" value={p1} onChange={(e) => setP1(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4 digits" style={{ ...st.input, marginBottom: 10, letterSpacing: ".3em" }} autoFocus />
            <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 5 }}>Confirm passcode</div>
            <input type="tel" maxLength={4} inputMode="numeric" value={p2} onChange={(e) => setP2(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4 digits" style={{ ...st.input, marginBottom: 8, letterSpacing: ".3em" }} />
            {err && <div style={{ fontSize: 11, color: "#c33", marginBottom: 10 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button onClick={() => setChangeOpen(false)} style={{ flex: 1, padding: "10px 0", border: `1px solid ${C.overlayBorder}`, borderRadius: 10, background: "none", color: C.ink, fontFamily: F.sans, fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveChange} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 10, background: C.accent, color: "#fff", fontFamily: F.sans, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </PageOverlay>
  );
}

function BackupPage({ open, book, up, onBack }) {
  const [flash, setFlash] = useState(null); // "backup" | "restore" | null
  const fileRef = useRef(null);

  const backupNow = () => {
    const blob = new Blob([JSON.stringify(book, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cashbook-simple-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    up((b) => { b.prefs.lastBackup = new Date().toISOString(); });
    setFlash("backup");
    setTimeout(() => setFlash(null), 1600);
  };

  const restore = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(reader.result); } catch { window.alert("That file isn't a valid Cash Book backup."); return; }
      if (!parsed || !Array.isArray(parsed.entries) || !Array.isArray(parsed.accounts)) { window.alert("That file isn't a valid Cash Book backup."); return; }
      if (!window.confirm("Restoring replaces everything currently in Cash Book with this backup. This can't be undone. Continue?")) return;
      up((b) => { for (const k of Object.keys(b)) delete b[k]; Object.assign(b, parsed); });
      setFlash("restore");
      setTimeout(() => setFlash(null), 1600);
    };
    reader.readAsText(file);
  };

  return (
    <PageOverlay open={open} onBack={onBack} title="Backup & Restore">
      <Card style={{ padding: "14px 16px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Last backup</span>
          <span style={{ fontSize: 11.5, color: C.muted }}>{book.prefs.lastBackup ? new Date(book.prefs.lastBackup).toLocaleString() : "Never"}</span>
        </div>
      </Card>
      <div style={{ display: "flex", gap: 8 }}>
        <PrimaryBtn style={{ flex: 1 }} onClick={backupNow}>{flash === "backup" ? "Backed up ✓" : "Back up now"}</PrimaryBtn>
        <GhostBtn style={{ flex: 1 }} onClick={() => fileRef.current && fileRef.current.click()}>{flash === "restore" ? "Restored ✓" : "Restore"}</GhostBtn>
      </div>
      <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; if (f) restore(f); e.target.value = ""; }} />
    </PageOverlay>
  );
}

function AccountsPage({ open, book, up, onBack, openSheet }) {
  const [newType, setNewType] = useState("bank");
  const [newName, setNewName] = useState("");
  const [newOpening, setNewOpening] = useState("");
  const [newDueDay, setNewDueDay] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name, count } | null
  // Opening balance (and a card's due day) can be fixed after the account
  // already exists -- there was previously no way to correct a typo or an
  // opening figure that was wrong from the start short of deleting the
  // whole account (and every transaction on it) and starting over.
  const [editingId, setEditingId] = useState(null);
  const [editOpening, setEditOpening] = useState("");
  const [editDueDay, setEditDueDay] = useState("");

  const withBal = accountsWithBalances(book, today());
  const bankRows = withBal.filter((a) => a.kind !== "card");
  const cardRows = withBal.filter((a) => a.kind === "card");

  const addAccount = () => {
    const name = newName.trim();
    if (!name) return;
    const parsedOpening = parseAmount(newOpening) || 0;
    // A card's opening balance is always stored as the amount owed (a
    // positive number, per accountsWithBalances) -- but "-15000" is how
    // most people naturally describe existing card debt, and parseAmount
    // now accepts that minus sign rather than silently rejecting it and
    // resetting to 0. Normalize to the same magnitude either way so typing
    // either "15000" or "-15000" for a card records the same outstanding debt.
    const opening = newType === "card" ? Math.abs(parsedOpening) : parsedOpening;
    const dueDay = newType === "card" && newDueDay ? +newDueDay : undefined;
    up((b) => { b.accounts.push({ id: uid(), name, kind: newType, opening, dueDay }); });
    setNewName(""); setNewOpening(""); setNewDueDay("");
  };

  const startEdit = (a) => { setEditingId(a.id); setEditOpening(String(a.opening || 0)); setEditDueDay(a.dueDay ? String(a.dueDay) : ""); };
  const cancelEdit = () => { setEditingId(null); setEditOpening(""); setEditDueDay(""); };
  const saveEdit = (a) => {
    const parsed = parseAmount(editOpening) || 0;
    const opening = a.kind === "card" ? Math.abs(parsed) : parsed;
    const dueDay = a.kind === "card" && editDueDay ? +editDueDay : undefined;
    up((b) => {
      const acc = b.accounts.find((x) => x.id === a.id);
      if (acc) { acc.opening = opening; if (a.kind === "card") acc.dueDay = dueDay; }
    });
    cancelEdit();
  };

  const requestDelete = (a) => {
    const count = book.entries.filter((e) => e.accountId === a.id || e.fromAccountId === a.id || e.toAccountId === a.id).length;
    setConfirmDelete({ id: a.id, name: a.name, count });
  };
  const doDelete = () => {
    const { id } = confirmDelete;
    up((b) => { b.accounts = b.accounts.filter((x) => x.id !== id); b.entries = b.entries.filter((e) => e.accountId !== id && e.fromAccountId !== id && e.toAccountId !== id); });
    setConfirmDelete(null);
  };
  // "Pay card" is just a pre-filled Transfer -- same account-to-account
  // mechanism (and the same duplicate-leg matching) a bank-to-bank transfer
  // already gets, just pre-aimed at this card with today's outstanding
  // balance filled in so paying it off doesn't mean re-entering that
  // number by hand.
  const payCard = (a) => openSheet && openSheet("newTx", { tab: "transfer", toAccountId: a.id, amount: a.balance > 0 ? String(Math.round(a.balance)) : "" });

  const AccountRow = (a, i, arr, isCredit) => (
    <React.Fragment key={a.id}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderBottom: i < arr.length - 1 || editingId === a.id ? `1px solid ${C.line}` : "none" }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: isCredit ? "rgba(122,46,59,.10)" : "rgba(29,58,143,.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Ic name="card" size={15} color={isCredit ? "#7a2e3b" : C.accent} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
          <div style={{ fontSize: 10, color: C.muted }}>{isCredit ? "Credit card" : "Bank account"}{isCredit && a.dueDay ? ` · Due on the ${a.dueDay}${dueOrdinal(a.dueDay)}` : ""}</div>
          <div style={{ fontSize: 9.5, color: C.faint, marginTop: 1 }}>Opening {inr(Math.abs(a.opening || 0))}{a.opening < 0 ? " (overdrawn)" : ""}</div>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: isCredit ? "#7a2e3b" : C.green, marginRight: 2 }}>{isCredit && a.balance > 0 ? "−" : ""}{inr(Math.abs(a.balance))}</div>
        {isCredit && a.balance > 0 && openSheet && (
          <div onClick={() => payCard(a)} style={{ display: "inline-flex", alignItems: "center", fontSize: 9.5, fontWeight: 700, padding: "4px 9px", borderRadius: 999, background: C.accent, color: "#fff", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap", marginRight: 2 }}>Pay</div>
        )}
        <div onClick={() => (editingId === a.id ? cancelEdit() : startEdit(a))} style={{ cursor: "pointer", padding: 4, color: editingId === a.id ? C.accent : "#bbb", display: "flex" }}><Ic name="edit" size={13} color={editingId === a.id ? C.accent : "#bbb"} /></div>
        <div onClick={() => requestDelete(a)} style={{ cursor: "pointer", padding: 4, color: "#bbb", display: "flex" }}><Ic name="trash" size={13} color="#bbb" /></div>
      </div>
      {editingId === a.id && (
        <div style={{ padding: "10px 14px 14px", borderBottom: i < arr.length - 1 ? `1px solid ${C.line}` : "none" }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 5 }}>Opening balance</div>
          <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.overlayBorder}`, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
            <div style={{ padding: "10px 0 10px 11px", fontSize: 12, fontWeight: 600, color: C.muted }}>₹</div>
            <input style={{ flex: 1, boxSizing: "border-box", border: "none", padding: "10px 11px 10px 4px", fontFamily: F.sans, fontSize: 12, fontVariantNumeric: "tabular-nums", outline: "none" }} inputMode="decimal" placeholder="0" value={editOpening} onChange={(e) => setEditOpening(e.target.value)} />
          </div>
          {isCredit && (
            <>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 5 }}>Payment due date</div>
              <input style={{ ...st.input, marginBottom: 10 }} type="number" min={1} max={31} placeholder="e.g. 5" value={editDueDay} onChange={(e) => setEditDueDay(e.target.value)} />
            </>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <GhostBtn style={{ flex: 1, padding: "9px 0", fontSize: 12 }} onClick={cancelEdit}>Cancel</GhostBtn>
            <PrimaryBtn style={{ flex: 1, padding: "9px 0", fontSize: 12 }} onClick={() => saveEdit(a)}>Save</PrimaryBtn>
          </div>
        </div>
      )}
    </React.Fragment>
  );

  return (
    <PageOverlay open={open} onBack={onBack} title="Accounts">
      {bankRows.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em", padding: "0 2px 6px" }}>Bank & savings</div>
          <Card style={{ padding: "0 14px", marginBottom: 16 }}>{bankRows.map((a, i) => AccountRow(a, i, bankRows, false))}</Card>
        </>
      )}
      {cardRows.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em", padding: "0 2px 6px" }}>Credit cards</div>
          <Card style={{ padding: "0 14px", marginBottom: 16 }}>{cardRows.map((a, i) => AccountRow(a, i, cardRows, true))}</Card>
        </>
      )}

      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 12 }}>Add account</div>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 5 }}>Account type</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[["bank", "Bank account"], ["card", "Credit card"]].map(([v, label]) => (
            <div key={v} onClick={() => setNewType(v)} style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", fontSize: 10.5, fontWeight: 500, padding: "5px 10px", borderRadius: 999, cursor: "pointer", background: newType === v ? C.accent : "rgba(17,17,17,.06)", color: newType === v ? "#fff" : "#444" }}>{label}</div>
          ))}
        </div>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 5 }}>Account name</div>
        <input style={{ ...st.input, marginBottom: 12 }} placeholder="e.g. HDFC Current Account" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 5 }}>Opening balance</div>
        <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.overlayBorder}`, borderRadius: 10, marginBottom: 6, overflow: "hidden" }}>
          <div style={{ padding: "10px 0 10px 11px", fontSize: 12, fontWeight: 600, color: C.muted }}>₹</div>
          <input style={{ flex: 1, boxSizing: "border-box", border: "none", padding: "10px 11px 10px 4px", fontFamily: F.sans, fontSize: 12, fontVariantNumeric: "tabular-nums", outline: "none" }} inputMode="decimal" placeholder="0" value={newOpening} onChange={(e) => setNewOpening(e.target.value)} />
        </div>
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 14 }}>{newType === "card" ? "Amount currently outstanding on this card -- \"5000\" and \"-5000\" both mean the same 5,000 owed." : "Balance on the day you started tracking this account in Cash Book. A negative number means you were overdrawn."}</div>
        {newType === "card" && (
          <>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 5 }}>Payment due date</div>
            <input style={{ ...st.input, marginBottom: 6 }} type="number" min={1} max={31} placeholder="e.g. 5" value={newDueDay} onChange={(e) => setNewDueDay(e.target.value)} />
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 14 }}>Day of the month your card payment is due (1–31).</div>
          </>
        )}
        <PrimaryBtn onClick={addAccount}>+ Add account</PrimaryBtn>
      </Card>

      <ConfirmModal open={!!confirmDelete} title="Delete account?"
        body={confirmDelete ? `"${confirmDelete.name}" will be removed${confirmDelete.count > 0 ? `, along with its ${confirmDelete.count} transaction${confirmDelete.count === 1 ? "" : "s"}` : ""}. This can't be undone.` : ""}
        onCancel={() => setConfirmDelete(null)} onConfirm={doDelete} />
    </PageOverlay>
  );
}

/* ══════════════════════════ NEW TRANSACTION ══════════════════════════ */
// A searchable, tappable category list -- replaces the plain <select> for
// Add Transaction's Expense/Income/Refund pickers, matching the mockup.
// Selection reads via background+bold+navy text alone, matching the
// mockup exactly -- no checkmark icon (that was our own addition).
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
      <div style={{ maxHeight: maxHeight || 145, overflowY: "auto", marginBottom: 8 }}>
        {filtered.map((it) => (
          <div key={it.value} onClick={() => onChange(it.value)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 8px", borderRadius: 8, cursor: "pointer", marginBottom: 2, background: value === it.value ? C.accentSoft : "transparent" }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: value === it.value ? 600 : 400, color: value === it.value ? C.accent : C.soft }}>{it.label}</span>
            {it.isBS && <span style={{ fontSize: 8.5, fontWeight: 800, padding: "2px 6px", borderRadius: 999, background: "rgba(166,116,28,.14)", color: C.amberText, flexShrink: 0 }}>BS</span>}
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
  const [amount, setAmount] = useState((preset && preset.amount) || "");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());

  const firstAccountId = (book.accounts[0] || {}).id || "";
  const secondAccountId = (book.accounts[1] || book.accounts[0] || {}).id || "";
  // Prefer a real bank/cash account as the default "paid from" side of a
  // transfer -- otherwise a lone credit card sitting first in the account
  // list would default to paying itself, which is never what's meant (and
  // trips the same-account transferInvalid guard for no reason).
  const firstBankAccountId = ((book.accounts.find((a) => a.kind !== "card") || book.accounts[0] || {}).id) || "";

  const [expCategory, setExpCategory] = useState(() => book.categories.expense.find((c) => c !== "Suspense") || book.bsCategories[0] || "");
  const [expAccountId, setExpAccountId] = useState(firstAccountId);

  const [incomeMode, setIncomeMode] = useState("income"); // income | refund
  const [incCategory, setIncCategory] = useState(book.categories.income[0] || "");
  const [refundFor, setRefundFor] = useState(book.categories.expense.find((c) => c !== "Suspense") || "");
  const [incAccountId, setIncAccountId] = useState(firstAccountId);

  // Split applies to both the Expense and Income tabs -- same N-way
  // category-or-person editor CategorizeSheet uses (see SplitEditor), so a
  // brand-new transaction can be split right away instead of only after
  // it's saved and then re-categorized.
  const [splitOn, setSplitOn] = useState(false);
  const [splits, setSplits] = useState([]);
  const toggleSplitOn = () => { if (!splitOn) setSplits(defaultSplitPair(parseAmount(amount) || 0)); setSplitOn((v) => !v); };

  const [fromAccountId, setFromAccountId] = useState(firstBankAccountId || firstAccountId);
  const [toAccountId, setToAccountId] = useState((preset && preset.toAccountId) || secondAccountId);

  const [owedMode, setOwedMode] = useState((preset && preset.owedMode) || "receive"); // receive | pay
  const [owedPartyId, setOwedPartyId] = useState("");
  const [owedAccountId, setOwedAccountId] = useState(firstAccountId);
  const [addingOwedParty, setAddingOwedParty] = useState(false);
  const [newOwedName, setNewOwedName] = useState("");
  // An IOU that never touched any tracked account -- cash handed over
  // off-book, a debt someone mentioned, etc. Recorded with accountId left
  // out entirely: accountsWithBalances' applyLeg already no-ops when the
  // account it's given can't be found, so this naturally never moves any
  // bank/cash balance, only the Owed ledger.
  const [owedNoAccount, setOwedNoAccount] = useState(false);

  const expenseCatItems = [
    ...book.categories.expense.filter((c) => c !== "Suspense").map((c) => ({ value: c, label: c })),
    ...book.bsCategories.map((c) => ({ value: c, label: c, isBS: true })),
  ];
  const incomeCatItems = book.categories.income.map((c) => ({ value: c, label: c }));
  const refundCatItems = book.categories.expense.filter((c) => c !== "Suspense").map((c) => ({ value: c, label: c }));
  // Every party is selectable either direction -- e.g. "You'll pay" someone
  // who currently owes YOU is a perfectly normal partial settlement, not an
  // edge case -- but whoever already has an outstanding balance in the
  // selected direction sorts first (matching the mockup's owedToYou/
  // owedByYou lists) since that's the far more common case.
  const owed = owedAsOf(book, today());
  const owedCandidates = owed.perParty.slice().sort((a, b) => {
    const aMatch = owedMode === "receive" ? a.balance > 0 : a.balance < 0;
    const bMatch = owedMode === "receive" ? b.balance > 0 : b.balance < 0;
    return (bMatch ? 1 : 0) - (aMatch ? 1 : 0);
  });

  const amt = parseAmount(amount) || 0;
  const transferInvalid = tab === "transfer" && fromAccountId === toAccountId;
  const owedInvalid = tab === "owed" && !owedPartyId;
  const splitActive = (tab === "expense" || tab === "income") && splitOn;
  const { valid: splitValid } = splitStatus(splits, amt);

  const save = () => {
    if (!amt || amt <= 0 || transferInvalid || owedInvalid) return;
    if (splitActive) {
      if (!splitValid) return;
      const accountId = tab === "expense" ? expAccountId : incAccountId;
      const type = tab === "expense" ? "out" : "in";
      up((b) => {
        for (const sp of splits) {
          const spAmt = Math.round(parseAmount(sp.amount) || 0);
          if (sp.target.kind === "category") {
            b.entries.push({ id: uid(), date, amount: spAmt, type, category: sp.target.value, accountId, note });
          } else {
            b.entries.push({ id: uid(), date, amount: spAmt, type: "party", partyId: sp.target.value, accountId, dir: type === "in" ? "in" : "out", note: note || "Split expense" });
          }
        }
        return b;
      });
      close();
      return;
    }
    up((b) => {
      if (tab === "expense") {
        b.entries.push({ id: uid(), date, amount: amt, type: "out", category: expCategory, accountId: expAccountId, note });
      } else if (tab === "income") {
        b.entries.push({ id: uid(), date, amount: amt, type: "in", category: incomeMode === "refund" ? refundFor : incCategory, accountId: incAccountId, note });
      } else if (tab === "transfer") {
        b.entries.push({ id: uid(), date, amount: amt, type: "transfer", fromAccountId, toAccountId, note });
      } else if (tab === "owed") {
        // No account at all when owedNoAccount -- accountsWithBalances'
        // applyLeg no-ops for an accountId that doesn't resolve to a real
        // account, so this only ever touches the Owed ledger.
        b.entries.push({ id: uid(), date, amount: amt, type: "party", partyId: owedPartyId, ...(owedNoAccount ? {} : { accountId: owedAccountId }), dir: owedMode === "receive" ? "out" : "in", note });
      }
      return b;
    });
    close();
  };

  const addOwedParty = () => {
    const n = newOwedName.trim();
    if (!n) return;
    const id = uid();
    up((b) => { b.parties.push({ id, name: n }); return b; });
    setOwedPartyId(id);
    setAddingOwedParty(false);
    setNewOwedName("");
  };

  if (book.accounts.length === 0) {
    return <Sheet open title="Add transaction" onClose={close}><div style={{ fontSize: 13, color: C.muted }}>Add an account first, in Setup ▸ Accounts.</div></Sheet>;
  }

  const saveLabel = splitActive ? "Save Split"
    : tab === "expense" ? "Record expense"
    : tab === "income" ? (incomeMode === "refund" ? "Record refund" : "Record income")
    : tab === "transfer" ? "Record transfer"
    : "Settle up";
  const changeTab = (v) => { setTab(v); setSplitOn(false); setSplits([]); };

  // Plain label/value rows with hairline dividers, matching the mockup --
  // no glass-card wrapper (the mockup's account/date fields sit directly
  // on the sheet's own white background).
  const AccountDateRows = ({ accountId, setAccountId, accountLabel }) => (
    <div style={{ marginBottom: 12 }}>
      <SummaryRow label={accountLabel || "Account"}>
        <select style={rowSelectStyle} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {book.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </SummaryRow>
      <SummaryRow label="Date" last>
        <input type="date" style={rowSelectStyle} value={date} onChange={(e) => setDate(e.target.value)} />
      </SummaryRow>
    </div>
  );

  // A fixed-footprint popup instead of the shared Sheet's auto-height
  // behavior -- Sheet grows/shrinks to fit whatever's inside it, so
  // switching tabs here (each with a very different amount of content)
  // made the popup visibly jump in size. The mockup's own Add Transaction
  // popup is the same way: a constant-height container with only its
  // middle content area scrolling, so the popup itself never resizes no
  // matter which tab is open.
  return (
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center", background: C.dimBg, backdropFilter: "blur(4px)", animation: "fadeIn .18s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, height: "72vh", maxHeight: 620, boxSizing: "border-box", background: C.sheetBg, border: C.border, borderTop: `1px solid ${C.overlayStrong}`, borderRadius: "24px 24px 0 0", display: "flex", flexDirection: "column", fontFamily: F.sans, color: C.ink, animation: "sheetUp .22s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ padding: "10px 18px 0", flexShrink: 0 }}>
          <div style={{ width: 40, height: 4, borderRadius: 999, background: C.overlayStrong, margin: "0 auto 12px" }} />
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            <RoundBtn onClick={close}><Ic name="close" size={13} /></RoundBtn>
            <div style={{ flex: 1, textAlign: "center", fontSize: 16, fontWeight: 800 }}>Add transaction</div>
            <div style={{ width: 30, flexShrink: 0 }} />
          </div>
          <Seg value={tab} onChange={changeTab} style={{ marginBottom: 14 }} options={[
            { v: "expense", label: "Expense" }, { v: "income", label: "Income" },
            { v: "transfer", label: "Transfer" }, { v: "owed", label: "Settle owed" },
          ]} />

          {tab !== "owed" && (
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 28, fontWeight: 700 }}>₹<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" style={{ border: "none", outline: "none", fontFamily: F.sans, fontSize: 28, fontWeight: 700, width: 150, textAlign: "center", background: "none", color: C.ink }} /></span>
            </div>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 18px 14px" }}>

      {tab === "expense" && (
        <div>
          {!splitOn && (
            <>
              <div style={st.label}>Category</div>
              <CategoryPickList items={expenseCatItems} value={expCategory} onChange={setExpCategory} />
            </>
          )}
          <AccountDateRows accountId={expAccountId} setAccountId={setExpAccountId} />
          <input style={{ ...st.input, marginBottom: 12 }} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
          <div style={{ border: `1px solid ${C.overlayBorder}`, borderRadius: 12, padding: "12px 14px", marginBottom: splitOn ? 12 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>Split this amount</span>
              <Toggle value={splitOn} onChange={toggleSplitOn} reverse />
            </div>
          </div>
          {splitOn && <SplitEditor book={book} up={up} totalAmount={amt} splits={splits} setSplits={setSplits} signIn={false} refundOn={false} />}
        </div>
      )}

      {tab === "income" && (
        <div>
          <Seg value={incomeMode} onChange={setIncomeMode} style={{ marginBottom: 14 }} options={[{ v: "income", label: "Income" }, { v: "refund", label: "Refund" }]} />
          {!splitOn && (
            incomeMode === "refund" ? (
              <>
                <div style={st.label}>Which expense is this refunding?</div>
                <CategoryPickList items={refundCatItems} value={refundFor} onChange={setRefundFor} />
              </>
            ) : (
              <>
                <div style={st.label}>Category</div>
                <CategoryPickList items={incomeCatItems} value={incCategory} onChange={setIncCategory} />
              </>
            )
          )}
          <AccountDateRows accountId={incAccountId} setAccountId={setIncAccountId} />
          <input style={{ ...st.input, marginBottom: 12 }} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
          <div style={{ border: `1px solid ${C.overlayBorder}`, borderRadius: 12, padding: "12px 14px", marginBottom: splitOn ? 12 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>Split this amount</span>
              <Toggle value={splitOn} onChange={toggleSplitOn} reverse />
            </div>
          </div>
          {splitOn && <SplitEditor book={book} up={up} totalAmount={amt} splits={splits} setSplits={setSplits} signIn={true} refundOn={incomeMode === "refund"} />}
        </div>
      )}

      {tab === "transfer" && (
        <div>
          <div>
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
          </div>
          {transferInvalid && <div style={{ fontSize: 11, color: C.red, fontWeight: 600, margin: "8px 0" }}>From and To accounts must be different.</div>}
          <input style={{ ...st.input, marginTop: 12 }} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}

      {tab === "owed" && (
        <div>
          <Seg value={owedMode} onChange={(v) => { setOwedMode(v); setOwedPartyId(""); setAmount(""); }} style={{ marginBottom: 14 }} options={[{ v: "receive", label: "You'll receive" }, { v: "pay", label: "You'll pay" }]} />
          <div style={st.label}>{owedMode === "receive" ? "Who owes you" : "Who you owe"}</div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
            {owedCandidates.map((p) => {
              const selected = p.id === owedPartyId;
              return (
                <div key={p.id} onClick={() => { setOwedPartyId(p.id); if (p.balance) setAmount(String(Math.abs(p.balance))); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 12px", cursor: "pointer", borderBottom: `1px solid ${C.line}`, background: selected ? C.accentSoft : "transparent" }}>
                  <PartyAvatarCircle id={p.id} name={p.name} size={26} />
                  <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, fontWeight: selected ? 600 : 400, color: selected ? C.ink : C.soft }}>{p.name}</span>
                  {p.balance !== 0 && <span style={{ fontSize: 12, fontWeight: 700, color: p.balance > 0 ? C.accent : C.ink, flexShrink: 0 }}>{inr(Math.abs(p.balance))}</span>}
                </div>
              );
            })}
            {addingOwedParty ? (
              <div style={{ display: "flex", gap: 8, padding: "10px 12px" }}>
                <input style={{ ...st.input, flex: 1, padding: "7px 10px", fontSize: 12 }} placeholder="Person's name" value={newOwedName} autoFocus onChange={(e) => setNewOwedName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOwedParty()} />
                <PrimaryBtn style={{ width: "auto", padding: "0 14px" }} onClick={addOwedParty}>Add</PrimaryBtn>
              </div>
            ) : (
              <div onClick={() => setAddingOwedParty(true)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 12px", cursor: "pointer" }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: `1.5px dashed ${C.overlayBorder}`, color: C.muted, fontSize: 14, lineHeight: 1 }}>+</div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.accentText }}>New person</span>
              </div>
            )}
          </div>
          <div style={{ textAlign: "center", margin: "16px 0" }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", marginBottom: 4 }}>{owedMode === "receive" ? "They'll owe you" : "You'll owe them"}</div>
            <span style={{ fontSize: 24, fontWeight: 700 }}>₹<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" style={{ border: "none", outline: "none", fontFamily: F.sans, fontSize: 24, fontWeight: 700, width: 110, textAlign: "center", background: "none", color: C.ink }} /></span>
          </div>
          {/* An IOU that never went through a real account -- cash handed over
              off-book, or just a debt to remember -- stays purely in the Owed
              ledger with no accountId at all, so it can never move a bank/cash
              balance (see the `owedNoAccount` comment on save()). */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 12px", marginBottom: owedNoAccount ? 12 : 14, borderRadius: 12, background: C.accentSoft }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Not linked to a bank account</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>Tracked here only -- won't touch any bank or cash balance</div>
            </div>
            <Toggle value={owedNoAccount} onChange={setOwedNoAccount} reverse />
          </div>
          {owedNoAccount ? (
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginBottom: 14, display: "flex", gap: 5, alignItems: "flex-start" }}>
              <Ic name="wand" size={11} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>This is not related to any bank -- it'll show up in Owed only.</span>
            </div>
          ) : (
            <SummaryRow label={owedMode === "receive" ? "Deposit into" : "Pay from"} last>
              <select style={rowSelectStyle} value={owedAccountId} onChange={(e) => setOwedAccountId(e.target.value)}>
                {book.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </SummaryRow>
          )}
          <input style={{ ...st.input, marginTop: 12 }} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}

        </div>

        <div style={{ padding: "12px 18px 20px", flexShrink: 0, borderTop: `1px solid ${C.line}` }}>
          <PrimaryBtn onClick={save}>{saveLabel}</PrimaryBtn>
        </div>
      </div>
    </div>
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
  const isCodable = entry.type === "in" || entry.type === "out";
  const isApproval = isCodable && entry.pendingApproval;
  const isUnexplained = isCodable && !isApproval && !isExplained(entry);
  // Party (owed) and transfer entries are always isExplained() (see
  // engine.js) -- unexplaining one of those runs through the same
  // unexplainEntryInPlace a transfer/owed row's swipe action uses, splitting
  // a transfer back into its two original per-account legs rather than
  // being limited to plain category entries.
  const canUnexplain = !isApproval && isExplained(entry);
  const isBS = canUnexplain && book.bsCategories.includes(entry.category);
  const refund = canUnexplain && isRefund(book, entry);
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
    rows.push(["Account", entry.accountId ? accountName(entry.accountId) : "Not linked to a bank account"]);
  } else if (isUnexplained) {
    rows.push(["Category", "Uncategorized"]);
    rows.push(["Account", accountName(entry.accountId)]);
  } else if (isApproval) {
    rows.push(["Suggested Category", entry.category]);
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
            <span style={{ fontSize: 13, fontWeight: 700, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {value}
              {label === "Category" && isBS && <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: "rgba(251,191,36,.18)", border: "1px solid rgba(251,191,36,.4)", color: C.amberText, marginLeft: 6 }}>BS</span>}
            </span>
          </div>
        ))}
      </Card>
      {entry.type === "transfer" && (
        <div style={{ fontSize: 10, color: C.faint, fontWeight: 600, marginTop: 10, lineHeight: 1.5 }}>Unexplaining a transfer splits it back into its two original legs, one in each account, so both sides can be recategorized separately.</div>
      )}
      {canUnexplain && (
        <button onClick={() => {
          up((b) => unexplainEntryInPlace(b, entryId));
          close();
        }} style={{ width: "100%", marginTop: 14, padding: "12px 0", borderRadius: 12, border: "none", background: "rgba(122,46,59,.08)", color: "#7a2e3b", fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: F.sans }}>Mark as unexplained</button>
      )}
    </Sheet>
  );
}

/* ══════════════════════════ CATEGORIZE ══════════════════════════ */
// One flow codes both a single row and a multi-row selection -- the
// mockup treats these as the same modal with just a different subtitle,
// and sharing the logic keeps category/owed/transfer/split defined once.
// Category and Balance Sheet options are always both offered (matching
// CategorySelect elsewhere) since BS categories are codeable either
// direction; Transfer is a real third target mode here (not folded into
// "just another category" the way the mockup's flattened prototype data
// does it) because our accounts carry real balances that need an actual
// double-entry leg to stay correct.
const catChipStyle = { display: "inline-flex", alignItems: "center", fontSize: 11.5, fontWeight: 500, padding: "7px 13px", borderRadius: 999, border: "none", cursor: "pointer", background: "rgba(17,17,17,.06)", color: "#444", fontFamily: F.sans, whiteSpace: "nowrap" };
const owedChipStyle = { ...catChipStyle, background: "rgba(15,106,92,.08)", color: C.green };

function categorizeGroups(book, sign, refundOn, search) {
  const q = search.trim().toLowerCase();
  const groups = [];
  if (sign === "out" || refundOn) groups.push({ label: "Expense", items: book.categories.expense.filter((c) => c !== "Suspense") });
  if (sign === "in" && !refundOn) groups.push({ label: "Income", items: book.categories.income });
  if (book.bsCategories.length > 0) groups.push({ label: "Balance Sheet", items: book.bsCategories });
  return groups.map((g) => ({ ...g, items: g.items.filter((c) => c.toLowerCase().includes(q)) })).filter((g) => g.items.length > 0);
}

// A fresh 2-row 50/50 split, the starting point whenever "Split this
// amount" is switched on -- shared by CategorizeSheet (splitting an
// existing transaction) and NewTransactionSheet (splitting a fresh one).
const defaultSplitPair = (totalAmount) => {
  const half = Math.round(totalAmount / 2);
  return [{ amount: String(half), target: null, open: false }, { amount: String(totalAmount - half), target: null, open: false }];
};
// Pure validity check for a split's rows against the amount they need to
// add up to -- every row needs a target and a positive amount, and the
// rows need to sum back to the total (within half a rupee, for rounding).
function splitStatus(splits, totalAmount) {
  const sum = splits.reduce((s, sp) => s + (parseAmount(sp.amount) || 0), 0);
  const remaining = totalAmount - sum;
  const valid = splits.length >= 2 && splits.every((sp) => sp.target && (parseAmount(sp.amount) || 0) > 0) && Math.abs(remaining) < 0.5;
  return { remaining, valid };
}

// The N-way split editor itself -- any number of rows, each an amount plus
// a category-or-person target, rendered as a controlled list (`splits`/
// `setSplits` owned by the caller) so both CategorizeSheet and
// NewTransactionSheet can drive it with their own save/validate logic
// rather than duplicating this ~60 lines of row/picker JSX between them.
// Deliberately has no Save button of its own -- CategorizeSheet renders one
// inline (it has no other footer), NewTransactionSheet's is the sheet's
// single fixed footer button instead.
function SplitEditor({ book, up, totalAmount, splits, setSplits, signIn, refundOn }) {
  const [splitAddPartyIdx, setSplitAddPartyIdx] = useState(null);
  const [splitNewPartyName, setSplitNewPartyName] = useState("");
  const splitGroups = categorizeGroups(book, signIn ? "in" : "out", refundOn, "");
  const { remaining } = splitStatus(splits, totalAmount);

  const addSplitRow = () => setSplits((s) => [...s, { amount: "", target: null, open: false }]);
  const removeSplitRow = (i) => setSplits((s) => s.filter((_, idx) => idx !== i));
  const updateSplitAmount = (i, v) => setSplits((s) => s.map((sp, idx) => (idx === i ? { ...sp, amount: v } : sp)));
  const toggleSplitTargetOpen = (i) => { setSplitAddPartyIdx(null); setSplits((s) => s.map((sp, idx) => (idx === i ? { ...sp, open: !sp.open } : { ...sp, open: false }))); };
  const setSplitTarget = (i, target) => setSplits((s) => s.map((sp, idx) => (idx === i ? { ...sp, target, open: false } : sp)));
  const addSplitPartyAndSet = () => {
    const n = splitNewPartyName.trim();
    if (!n || splitAddPartyIdx === null) return;
    const id = uid();
    up((b) => { b.parties.push({ id, name: n }); return b; });
    setSplitTarget(splitAddPartyIdx, { kind: "owed", value: id, label: n });
    setSplitAddPartyIdx(null);
    setSplitNewPartyName("");
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
        {splits.map((sp, i) => (
          <div key={i} style={{ border: `1px solid ${C.overlayBorder}`, borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>₹</span>
              <input value={sp.amount} onChange={(e) => updateSplitAmount(i, e.target.value)} placeholder="0" style={{ border: "none", background: "none", fontFamily: F.sans, fontSize: 13, fontWeight: 700, width: 90, outline: "none", color: C.ink }} />
              <div style={{ flex: 1 }} />
              {splits.length > 1 && <div onClick={() => removeSplitRow(i)} style={{ cursor: "pointer", flexShrink: 0, display: "flex" }}><Ic name="close" size={13} color={C.faint} /></div>}
            </div>
            <div onClick={() => toggleSplitTargetOpen(i)} style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 500, padding: "4px 10px", borderRadius: 999, cursor: "pointer", marginTop: 6, whiteSpace: "nowrap", background: sp.target ? C.accentSoft : C.overlayWash, color: sp.target ? C.accentText : C.muted }}>
              {sp.target ? sp.target.label : "Choose category or person"} ▾
            </div>
            {sp.open && (
              <div style={{ marginTop: 9, paddingTop: 9, borderTop: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                  {splitGroups.map((g) => g.items.map((c) => (
                    <button key={c} onClick={() => setSplitTarget(i, { kind: "category", value: c, label: c })} style={{ ...catChipStyle, fontSize: 10.5, padding: "5px 10px" }}>{c}</button>
                  )))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {book.parties.map((p) => (
                    <button key={p.id} onClick={() => setSplitTarget(i, { kind: "owed", value: p.id, label: p.name })} style={{ ...owedChipStyle, fontSize: 10.5, padding: "5px 10px" }}>{p.name}</button>
                  ))}
                  {splitAddPartyIdx === i ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input value={splitNewPartyName} autoFocus onChange={(e) => setSplitNewPartyName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSplitPartyAndSet()} placeholder="Person's name" style={{ ...st.input, padding: "5px 9px", fontSize: 10.5, width: 120 }} />
                      <button onClick={addSplitPartyAndSet} style={{ ...owedChipStyle, fontSize: 10.5, padding: "5px 10px", border: "none" }}>Add</button>
                    </div>
                  ) : (
                    <button onClick={() => setSplitAddPartyIdx(i)} style={{ ...owedChipStyle, fontSize: 10.5, padding: "5px 10px" }}>+ New person</button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div onClick={addSplitRow} style={{ fontSize: 11, fontWeight: 600, color: C.accentText, cursor: "pointer" }}>+ Add another split</div>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: Math.abs(remaining) < 0.5 ? C.green : C.red }}>{Math.abs(remaining) < 0.5 ? "Fully allocated" : `${inr(Math.abs(remaining))} ${remaining > 0 ? "remaining" : "over"}`}</div>
      </div>
    </>
  );
}

// Converts entry `id` in draft `b` into a real "party" (owed) entry,
// preserving its original in/out direction -- shared by CategorizeSheet's
// manual recode and TransactionsScreen's approval of a rule's party
// suggestion, since both need the exact same entry-shape conversion.
function recodeEntryAsParty(b, id, partyId) {
  const idx = b.entries.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const base = b.entries[idx];
  const dir = base.type === "in" ? "in" : "out";
  b.entries.splice(idx, 1);
  b.entries.push({ id: base.id, date: base.date, amount: base.amount, type: "party", partyId, accountId: base.accountId, dir, note: base.note || "", merchant: base.merchant || "" });
}

// Searches account `toAccountId` for the probable other leg of a bank
// transfer -- opposite direction, same amount, still unexplained (never
// touches something the user already categorized or rejected), within a
// few days of `base`'s date. A "transfer" entry already applies to both
// accounts' balances on its own (engine.js), so if the other leg's own
// bank statement also got imported, leaving both rows in place would
// double-count the same money.
function findTransferMatch(b, base, toAccountId) {
  const wantType = base.type === "in" ? "out" : "in";
  const baseTime = new Date(base.date).getTime();
  const DAY = 86400000;
  let best = null, bestDiff = Infinity;
  for (const e of b.entries) {
    if (e.id === base.id || e.accountId !== toAccountId || e.type !== wantType) continue;
    if (e.category !== "Suspense" || e.pendingApproval || e.codingRejected) continue;
    if (e.amount !== base.amount) continue;
    const diff = Math.abs(new Date(e.date).getTime() - baseTime);
    if (diff > 3 * DAY) continue;
    if (diff < bestDiff) { bestDiff = diff; best = e; }
  }
  return best;
}

// Converts entry `id` into a single "transfer" entry between its own
// account and `toAccountId`, merging away a matching opposite leg in
// `toAccountId` if one is found (see findTransferMatch) so the transfer
// isn't counted twice. Returns the id of whatever got merged away, or
// null if no match existed -- callers use that to tell the user which
// happened.
function recodeEntryAsTransfer(b, id, toAccountId) {
  const idx = b.entries.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  const base = b.entries[idx];
  if (toAccountId === base.accountId) return null; // no-op self-transfer
  const match = findTransferMatch(b, base, toAccountId);
  b.entries.splice(idx, 1);
  if (match) {
    const midx = b.entries.findIndex((e) => e.id === match.id);
    if (midx >= 0) b.entries.splice(midx, 1);
  }
  const signIn = base.type === "in";
  b.entries.push({
    id: base.id, date: base.date, amount: base.amount, type: "transfer",
    fromAccountId: signIn ? toAccountId : base.accountId,
    toAccountId: signIn ? base.accountId : toAccountId,
    note: base.note || "", merchant: base.merchant || "",
  });
  return match ? match.id : null;
}

// Reverses whatever recode turned this entry into an explained one, putting
// it back in Unexplained instead of deleting it -- deleting a raw imported
// bank row loses real money from the ledger permanently, while unexplaining
// just asks for it to be recategorized. A party entry (owed) becomes a
// plain Suspense in/out entry again, using its own dir; a transfer entry
// (which represents both legs of the money movement in one row -- see
// recodeEntryAsTransfer) splits back into the two separate Suspense legs it
// was merged from, one per account, so both sides can be recategorized
// independently and nothing about either account's ledger goes missing.
// The second leg reuses a deterministic id (base id + ":leg2") rather than
// a fresh uid() so a caller can undo this without having to track a
// randomly generated id through a closure.
function unexplainEntryInPlace(b, id) {
  const idx = b.entries.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const base = b.entries[idx];
  if (base.type === "party") {
    b.entries.splice(idx, 1);
    b.entries.push({ id: base.id, date: base.date, amount: base.amount, type: base.dir, category: "Suspense", accountId: base.accountId, note: base.note || "", merchant: base.merchant || "" });
  } else if (base.type === "transfer") {
    b.entries.splice(idx, 1);
    b.entries.push({ id: base.id, date: base.date, amount: base.amount, type: "out", category: "Suspense", accountId: base.fromAccountId, note: base.note || "", merchant: base.merchant || "" });
    b.entries.push({ id: base.id + ":leg2", date: base.date, amount: base.amount, type: "in", category: "Suspense", accountId: base.toAccountId, note: base.note || "", merchant: base.merchant || "" });
  } else {
    b.entries[idx] = { ...base, category: "Suspense", pendingApproval: false };
  }
}
// Pairs with unexplainEntryInPlace for a toast's Undo action -- removes
// whatever it produced for `original.id` (one row, or the two split
// transfer legs) and puts the original entry back exactly as it was.
function undoUnexplain(b, original) {
  b.entries = b.entries.filter((e) => e.id !== original.id && e.id !== original.id + ":leg2");
  b.entries.push(original);
}

function CategorizeSheet({ book, up, close, entryIds, showToast, onApplied }) {
  const entries = book.entries.filter((e) => entryIds.includes(e.id) && (e.type === "in" || e.type === "out"));
  if (entries.length === 0) return null;
  const isBulk = entries.length > 1;
  const signIn = entries[0].type === "in";
  const totalAmount = entries.reduce((s, e) => s + e.amount, 0);
  const matched = !isBulk ? suggestHead(book, entries[0].merchant || "") : null;

  const [targetMode, setTargetMode] = useState("category"); // category | owed | transfer
  const [search, setSearch] = useState("");
  const [refundOn, setRefundOn] = useState(false);
  const [splitOn, setSplitOn] = useState(false);
  const [splits, setSplits] = useState([]);
  const [toAccountId, setToAccountId] = useState(() => (book.accounts.find((a) => a.id !== entries[0].accountId) || {}).id || "");
  const [addingParty, setAddingParty] = useState(false);
  const [newPartyName, setNewPartyName] = useState("");

  const setMode = (v) => { setTargetMode(v); setSplitOn(false); };
  const groups = categorizeGroups(book, signIn ? "in" : "out", refundOn, search);

  const applyCategory = (cat) => {
    up((b) => {
      for (const id of entryIds) {
        const idx = b.entries.findIndex((e) => e.id === id);
        if (idx >= 0) b.entries[idx] = { ...b.entries[idx], category: cat, pendingApproval: false };
      }
      return b;
    });
    close();
    if (onApplied) onApplied();
  };
  const applyParty = (partyId) => {
    up((b) => { for (const id of entryIds) recodeEntryAsParty(b, id, partyId); return b; });
    close();
    if (onApplied) onApplied();
  };
  const addPartyAndApply = () => {
    const n = newPartyName.trim();
    if (!n) return;
    const id = uid();
    up((b) => { b.parties.push({ id, name: n }); for (const eid of entryIds) recodeEntryAsParty(b, eid, id); return b; });
    close();
    if (onApplied) onApplied();
  };
  const applyTransfer = () => {
    if (!toAccountId) return;
    let total = 0, merged = 0;
    up((b) => {
      for (const id of entryIds) {
        const e = b.entries.find((x) => x.id === id);
        if (!e || toAccountId === e.accountId) continue;
        total++;
        if (recodeEntryAsTransfer(b, id, toAccountId)) merged++;
      }
      return b;
    });
    close();
    if (onApplied) onApplied();
    if (showToast && total > 0) {
      showToast(
        merged === 0
          ? "Saved as transfer — will link automatically once the other side is imported"
          : merged === total
          ? `Matched with existing transaction${merged > 1 ? "s" : ""} in the other account`
          : `${merged} of ${total} matched with existing transactions there`
      );
    }
  };

  // Split -- single row only, real N-way splitting: any number of rows,
  // each targeting its own category or party, validated to add back up to
  // the original amount before Save is enabled. Row/picker UI and the
  // validity math both live in the shared SplitEditor/splitStatus (also
  // used by NewTransactionSheet), so this only owns the toggle and the
  // apply-to-the-book step.
  const splitRow = entries[0];
  const splitTotal = isBulk ? 0 : Math.abs(splitRow.amount);
  const { valid: splitValid } = splitStatus(splits, splitTotal);

  const toggleSplit = () => {
    if (splitOn) { setSplitOn(false); return; }
    setSplits(defaultSplitPair(splitTotal));
    setSplitOn(true);
  };
  const saveSplit = () => {
    if (!splitValid) return;
    up((b) => {
      const idx = b.entries.findIndex((e) => e.id === splitRow.id);
      if (idx < 0) return b;
      const base = b.entries[idx];
      b.entries.splice(idx, 1);
      for (const sp of splits) {
        const amt = Math.round(parseAmount(sp.amount) || 0);
        if (sp.target.kind === "category") {
          b.entries.push({ id: uid(), date: base.date, amount: amt, type: base.type, category: sp.target.value, accountId: base.accountId, note: base.note || "", merchant: base.merchant || "" });
        } else {
          b.entries.push({ id: uid(), date: base.date, amount: amt, type: "party", partyId: sp.target.value, accountId: base.accountId, dir: signIn ? "in" : "out", note: base.note || "", merchant: base.merchant || "" });
        }
      }
      return b;
    });
    close();
    if (onApplied) onApplied();
  };

  return (
    <Sheet open title={isBulk ? `Categorize ${entries.length} Transactions` : "Categorize Transaction"} onClose={close}>
      <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 12 }}>
        {isBulk ? `${entries.length} selected · ${signIn ? "+" : "−"}${inr(totalAmount)} total` : `${entries[0].merchant || "Unrecognized transaction"} · ${signIn ? "+" : "−"}${inr(entries[0].amount)}`}
      </div>

      <Seg value={targetMode} onChange={setMode} style={{ marginBottom: 12 }} options={[{ v: "category", label: "Category" }, { v: "owed", label: "Owed person" }, { v: "transfer", label: "Transfer" }]} />

      {targetMode === "category" && signIn && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 12px", marginBottom: 10, borderRadius: 12, background: C.accentSoft }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>This is a refund</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{refundOn ? "Showing expense categories" : "Showing income categories"}</div>
          </div>
          <Toggle value={refundOn} onChange={setRefundOn} reverse />
        </div>
      )}

      {/* Split lives at this level, shared between Category and Owed, rather
          than nested only under Category -- a split row can target either a
          category or a person either way (see the picker inside each split
          row below), so there's no reason "Split this amount" should only be
          reachable from the Category tab. */}
      {(targetMode === "category" || targetMode === "owed") && !isBulk && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 12px", marginBottom: 10, borderRadius: 12, background: C.accentSoft }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Split this amount</span>
          <Toggle value={splitOn} onChange={toggleSplit} reverse />
        </div>
      )}

      {splitOn ? (
        <>
          <SplitEditor book={book} up={up} totalAmount={splitTotal} splits={splits} setSplits={setSplits} signIn={signIn} refundOn={refundOn} />
          <PrimaryBtn onClick={saveSplit} style={{ opacity: splitValid ? 1 : 0.5, cursor: splitValid ? "pointer" : "default" }}>Save Split</PrimaryBtn>
        </>
      ) : (
        <>
          {targetMode === "category" && (
            <>
              <div style={{ ...glass(12), display: "flex", alignItems: "center", gap: 7, padding: "9px 11px", marginBottom: 4 }}>
                <Ic name="search" size={12} color={C.muted} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search categories" style={{ flex: 1, minWidth: 0, border: "none", background: "none", fontFamily: F.sans, fontSize: 12, color: C.ink }} />
              </div>
              {groups.length === 0 && <div style={{ padding: "14px 0", fontSize: 12, color: C.muted }}>No categories match.</div>}
              {groups.map((g) => (
                <div key={g.label}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", margin: "10px 0 6px" }}>{g.label}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {g.items.map((c) => <button key={c} onClick={() => applyCategory(c)} style={catChipStyle}>{c}</button>)}
                  </div>
                </div>
              ))}
              {matched && matched !== "Suspense" && (
                <div style={{ fontSize: 10, color: C.accentText, fontWeight: 600, marginTop: 10, display: "flex", gap: 4, alignItems: "flex-start" }}>
                  <Ic name="wand" size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>Your auto-coding rule "{keywordOf(entries[0].merchant || "")} → {matched}" suggested this — tap it above to confirm, or pick a different category.</span>
                </div>
              )}
            </>
          )}

          {targetMode === "owed" && (
            addingParty ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...st.input, flex: 1 }} placeholder="Person's name" value={newPartyName} autoFocus onChange={(e) => setNewPartyName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPartyAndApply()} />
                <PrimaryBtn style={{ width: "auto", padding: "0 16px" }} onClick={addPartyAndApply}>Add</PrimaryBtn>
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {book.parties.map((p) => <button key={p.id} onClick={() => applyParty(p.id)} style={owedChipStyle}>{p.name}</button>)}
                <button onClick={() => setAddingParty(true)} style={owedChipStyle}>+ New person</button>
              </div>
            )
          )}
        </>
      )}

      {targetMode === "transfer" && (
        <>
          <div style={st.label}>{signIn ? "From Account" : "To Account"}</div>
          <AccountSelect book={book} value={toAccountId} onChange={setToAccountId} />
          <PrimaryBtn style={{ marginTop: 16 }} onClick={applyTransfer}>Save as Transfer</PrimaryBtn>
        </>
      )}
    </Sheet>
  );
}

/* ══════════════════════════ RECORD PAYMENT / IMPORT ══════════════════════════ */
function RecordPaymentSheet({ book, up, close, presetPartyId }) {
  const owed = owedAsOf(book, today());
  // Opened as "Settle up" from a party's balance, so the amount/direction
  // that would zero them out are pre-filled -- still editable, since a
  // partial payment is a perfectly normal thing to record here too.
  const presetBalance = presetPartyId ? ((owed.perParty.find((p) => p.id === presetPartyId) || {}).balance || 0) : 0;
  const [partyId, setPartyId] = useState(presetPartyId || (book.parties[0] ? book.parties[0].id : ""));
  const [amount, setAmount] = useState(presetBalance ? String(Math.abs(presetBalance)) : "");
  const [dir, setDir] = useState(presetBalance < 0 ? "out" : "in");
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
  // A locked bank/card statement PDF pauses here instead of failing outright
  // -- the file itself is kept (not re-picked from the input, which clears
  // once used) so submitting a password just re-runs the same import.
  const [lockedFile, setLockedFile] = useState(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [passwordWrong, setPasswordWrong] = useState(false);
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
        b.entries.push({ id: uid(), date: r.date, amount: r.amount, type: r.type, category: "Suspense", accountId, merchant: r.note || "", note: "" });
      }
      // Reuses the exact same rule-matching applyCodingRules already does on
      // every app load, rather than duplicating it here with only the
      // category-only suggestHead -- so a party-target rule provisionally
      // matches at import time too, not just on the next load's sweep.
      applyCodingRules(b);
      return b;
    });
  };

  const handleFile = async (file, password) => {
    if (!accountId) { setStatus("Add an account first."); return; }
    setError(false);
    setStatus(password ? "Unlocking…" : "Reading…");
    try {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const pages = await extractPdfPages(file, password);
        setLockedFile(null);
        setPdfPassword("");
        setPasswordWrong(false);
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
      if (err && err.code === "PDF_PASSWORD_REQUIRED") {
        setLockedFile(file);
        setPasswordWrong(!!password);
        setStatus("");
        return;
      }
      setError(true);
      setStatus(err && err.message ? err.message : "Make sure it's a CSV, PDF, or clear photo of a statement.");
    }
  };
  const submitPassword = () => { if (lockedFile) handleFile(lockedFile, pdfPassword); };
  const cancelPassword = () => { setLockedFile(null); setPdfPassword(""); setPasswordWrong(false); };

  if (book.accounts.length === 0) {
    return <Modal open title="Import statement" onClose={close}><div style={{ fontSize: 13, color: C.muted, textAlign: "center" }}>Add an account first, in Setup ▸ Accounts.</div></Modal>;
  }

  return (
    <Modal open title="Import statement" onClose={close}>
      {lockedFile ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Password protected</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>"{lockedFile.name}" is locked. Enter its password to import it.</div>
          <input type="password" style={st.input} placeholder="PDF password" value={pdfPassword} autoFocus onChange={(e) => setPdfPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitPassword()} />
          {passwordWrong && <div style={{ fontSize: 11, color: C.red, fontWeight: 600, marginTop: 8 }}>Incorrect password, try again.</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <GhostBtn style={{ flex: 1, padding: "10px 0", fontSize: 12 }} onClick={cancelPassword}>Cancel</GhostBtn>
            <PrimaryBtn style={{ flex: 1, padding: "10px 0", fontSize: 12 }} onClick={submitPassword}>Unlock & Import</PrimaryBtn>
          </div>
          {status && <div style={{ fontSize: 11, color: C.accentText, fontWeight: 600, marginTop: 8, textAlign: "center" }}>{status}</div>}
        </div>
      ) : !error ? (
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
    <div className="no-print" style={{ position: "fixed", left: 14, right: 14, bottom: 14, zIndex: 30, ...glass(20), display: "flex", alignItems: "center", justifyContent: "space-around", padding: "10px 4px" }}>
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
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: C.bg, color: C.ink, fontFamily: F.sans, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, animation: "fadeIn .25s ease" }}>
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
html, body { margin: 0; padding: 0; overflow-x: hidden; touch-action: manipulation; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
::-webkit-scrollbar { display: none; }
input, select, textarea { -webkit-user-select: text; user-select: text; }
@keyframes cbShake { 0%,100% { transform: translateX(0); } 20%,60% { transform: translateX(-8px); } 40%,80% { transform: translateX(8px); } }

/* Tap-scale + entrance animations, matching the approved handoff's own
   motion vocabulary exactly (its style-active="transform: scale(0.98)" on
   nearly every tappable row/button, and its fadeIn/popIn/sheetUp/toastIn
   keyframes for screens, modals, sheets, and toasts). button covers every
   plain <button> in the app for free; .tap is applied individually to the
   handful of div-based "fake button" primitives (RoundBtn, Card, RowLine,
   SettingsRow, nav tabs) that can't be reached by a tag selector alone. */
button { transition: transform .12s ease; }
button:active { transform: scale(.96); }
.tap { transition: transform .12s ease; }
.tap:active { transform: scale(.97); }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes popIn { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: scale(1); } }
@keyframes sheetUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
@keyframes toastIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}

/* Export PDF: the app's own phone-width chrome (nav, header, period picker,
   export pills) is irrelevant on paper, so it's hidden entirely in favor of
   a dedicated print-only report layout built for A4/Letter -- see
   PrintReport below. */
.print-only { display: none; }
@media print {
  html, body, .app-root { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  .print-table { width: 100%; border-collapse: collapse; }
  .print-table th, .print-table td { border: 1px solid #ccc; padding: 5px 8px; font-size: 10.5px; text-align: right; }
  .print-table th:first-child, .print-table td:first-child { text-align: left; }
  .print-table thead { display: table-header-group; }
  .print-table tr { page-break-inside: avoid; }
  .print-section-row td { background: #f2f2f2; font-weight: 700; text-transform: uppercase; font-size: 9.5px; letter-spacing: .04em; }
  .print-total-row td { font-weight: 700; border-top: 2px solid #999; }
  .print-net-row td { font-weight: 700; font-size: 12px; border-top: 2px solid #333; }
}
`;

export default function App() {
  const [book, setBook] = useState(null);
  const [tab, setTab] = useState("home");
  const [sheet, setSheet] = useState(null); // { name, ctx }
  const [txSelectMode, setTxSelectMode] = useState(false);
  const [txJumpTab, setTxJumpTab] = useState(null);
  const [toast, setToast] = useState(null); // { message, undo }
  const toastTimerRef = useRef(null);
  // Per-session only, deliberately not persisted -- "Hide balances until
  // unlocked" (Setup ▸ Security) should mask Home's numbers again the next
  // time the app is opened, not stay revealed forever once tapped once.
  const [balancesRevealed, setBalancesRevealed] = useState(false);
  const hiddenAtRef = useRef(null);
  // Whether THIS session still needs a PIN. Only decided once, right after
  // the book loads, from whatever book.prefs.lock.on was at that moment —
  // turning the lock on later in the same session (Setup) must NOT
  // retroactively lock the session that's already open; it only takes
  // effect on the next boot, once a real PIN has actually been saved.
  const [unlocked, setUnlocked] = useState(null); // null = not yet decided

  useEffect(() => {
    loadBook().then((b) => {
      const loaded = b || defaultBook();
      // Backfills prefs fields added after this book was first saved --
      // defaultBook() already seeds these for brand-new installs, but an
      // existing saved book predating them needs the same defaults applied
      // once here rather than crashing on a missing field everywhere it's read.
      loaded.prefs.hideBalances = loaded.prefs.hideBalances ?? false;
      loaded.prefs.autoLockOption = loaded.prefs.autoLockOption || "1min";
      loaded.prefs.lastBackup = loaded.prefs.lastBackup ?? null;
      loaded.prefs.notifPrefs = loaded.prefs.notifPrefs || { paymentDue: true, unexplained: true, approval: true };
      // Catches up any row that was already sitting Unexplained before a
      // matching coding rule existed (or before this sweep existed at all)
      // -- without this, only a rule added from this point forward would
      // ever get applied retroactively.
      applyCodingRules(loaded);
      saveBook(loaded);
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
  // Home's "Needs attention" cards jump straight into the matching
  // Transactions sub-tab (Unexplained vs Approval) instead of always landing
  // on Explained -- txJumpTab is a one-shot hint consumed by
  // TransactionsScreen's initial tab, not synced back on every switch.
  const go = (t, txTab) => { setTab(t); if (txTab) setTxJumpTab(txTab); };
  const dismissToast = () => { if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); toastTimerRef.current = null; } setToast(null); };
  const showToast = (message, undoFn) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, undo: undoFn ? () => { undoFn(); dismissToast(); } : null });
    toastTimerRef.current = setTimeout(dismissToast, 5000);
  };

  useEffect(() => { if (tab !== "tx") setTxSelectMode(false); }, [tab]);

  // Blocks pull-to-refresh without touching normal scroll at all -- an
  // earlier attempt used the CSS overscroll-behavior property, but that
  // turned out to suppress real touch-scroll delegation on some Android
  // WebView/PWA builds (broke scrolling the Transactions list entirely).
  // This only calls preventDefault for the one specific gesture that's
  // actually the browser's pull-to-refresh trigger: dragging down while
  // already at the very top of the page. Every other touchmove -- which
  // covers all in-page scrolling, at any scroll position -- is left alone.
  useEffect(() => {
    let startY = null;
    const onTouchStart = (e) => { startY = e.touches[0] ? e.touches[0].clientY : null; };
    const onTouchMove = (e) => {
      if (startY == null || !e.touches[0]) return;
      const dy = e.touches[0].clientY - startY;
      if (window.scrollY <= 0 && dy > 0) e.preventDefault();
    };
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  // Auto-lock (Setup ▸ Security): re-locking on a timer only makes sense
  // relative to the app actually leaving the foreground -- there's no other
  // signal for "idle" in a tab-based PWA -- so this tracks how long the tab
  // was hidden and re-locks on return if that exceeds the configured option.
  useEffect(() => {
    if (!book || !book.prefs.lock.on) return;
    const THRESHOLDS = { immediate: 0, "1min": 60000, "5min": 300000 };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === "visible" && hiddenAtRef.current != null) {
        const elapsed = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        const threshold = THRESHOLDS[book.prefs.autoLockOption] ?? THRESHOLDS["1min"];
        if (elapsed >= threshold) { setUnlocked(false); setBalancesRevealed(false); }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [book && book.prefs.lock.on, book && book.prefs.autoLockOption]);

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

  return (
    <div className="app-root" style={{ position: "relative", minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: F.sans, overflowX: "hidden" }}>
      <style>{GLOBAL_CSS}</style>
      <div className="no-print" style={{ position: "fixed", inset: 0, background: C.bgGradient, zIndex: 0 }} />
      <div key={tab} style={{ position: "relative", zIndex: 2, minHeight: "100vh", paddingBottom: 70, animation: "fadeIn .2s ease" }}>
        {tab !== "home" && tab !== "reports" && tab !== "owed" && tab !== "tx" && <Header title={TABS.find((x) => x.id === tab).label} />}
        {tab === "home" && <HomeScreen book={book} go={go} openSheet={openSheet} notifCount={notifCount} balancesRevealed={balancesRevealed} setBalancesRevealed={setBalancesRevealed} />}
        {tab === "owed" && <OwedScreen book={book} up={up} openSheet={openSheet} showToast={showToast} />}
        {tab === "tx" && <TransactionsScreen book={book} up={up} openSheet={openSheet} selectMode={txSelectMode} setSelectMode={setTxSelectMode} showToast={showToast} initialTab={txJumpTab} clearInitialTab={() => setTxJumpTab(null)} />}
        {tab === "reports" && <ReportsScreen book={book} openSheet={openSheet} />}
        {tab === "setup" && <SetupScreen book={book} up={up} onLockNow={() => { setUnlocked(false); setBalancesRevealed(false); }} openSheet={openSheet} />}
      </div>

      {tab === "tx" && !txSelectMode && (
        <button onClick={() => openSheet("newTx")} className="no-print" style={{ position: "fixed", zIndex: 25, right: 18, bottom: 92, width: 50, height: 50, borderRadius: "50%", background: C.grad, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: `0 14px 28px -8px ${C.accentDeep}`, border: "none", cursor: "pointer" }}>
          <Ic name="plus" size={19} />
        </button>
      )}

      <NavBar tab={tab} setTab={setTab} />
      <Toast toast={toast} />

      {sheet && sheet.name === "newTx" && <NewTransactionSheet book={book} up={up} close={closeSheet} preset={sheet.ctx} />}
      {sheet && sheet.name === "categorize" && <CategorizeSheet book={book} up={up} close={closeSheet} entryIds={sheet.ctx.entryIds} showToast={showToast} onApplied={sheet.ctx.onApplied} />}
      {sheet && sheet.name === "viewTx" && <ViewTransactionSheet book={book} up={up} close={closeSheet} entryId={sheet.ctx.entryId} />}
      {sheet && sheet.name === "categoryDetail" && <CategoryDetailSheet book={book} close={closeSheet} title={sheet.ctx.title} entries={sheet.ctx.entries} />}
      {sheet && sheet.name === "recordPayment" && <RecordPaymentSheet book={book} up={up} close={closeSheet} presetPartyId={sheet.ctx.partyId} />}
      {sheet && sheet.name === "notifications" && <NotificationsSheet book={book} go={go} close={closeSheet} />}
      {sheet && sheet.name === "breakdown" && <BreakdownSheet book={book} close={closeSheet} />}
      {sheet && sheet.name === "import" && <ImportSheet book={book} up={up} close={closeSheet} />}
    </div>
  );
}
