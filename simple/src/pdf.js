/* ────────────────────────── statement import ──────────────────────────
   Ported verbatim from src/CashBook.jsx — this whole pipeline has zero
   book-shape coupling (every function returns/consumes plain {date,
   amount, type, note} rows), so nothing here needed adapting for this
   app's simpler data model. Only the two lazy-loader functions' asset
   paths changed (pdf.worker.min.mjs / ocr/ are copied into dist-simple/
   by scripts/build-simple.mjs, same as the main app's build.mjs does for
   dist/). */
import { pad2 } from "./engine.js";

// pdf.js touches browser-only APIs (DOMMatrix) the moment its module runs,
// so it's loaded lazily on first PDF import — esbuild defers evaluation of
// the bundled module until this call.
async function getPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.mjs";
  return pdfjsLib;
}

// Tesseract OCR, also lazy. Assets are self-hosted under ocr/ and
// runtime-cached by the service worker, so after the first ~9MB download
// recognition is free and offline.
export async function getOcrWorker(onProgress) {
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

// Heuristic statement-line parser — the fallback used for CSV/OCR text and
// any PDF whose table shape parsePdfTable() below doesn't recognise. A
// transaction line = a date + at least one amount; when a trailing running
// balance is present the amount is the second-last number. Direction comes
// from Dr/Cr-style markers, defaulting to "out" (the coding screen lets the
// user flip anything).
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

// Per-page positioned text items — x/y kept so a table's column layout can
// be read directly, instead of only the flattened, order-guessed text.
export async function extractPdfPages(file) {
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
 * Debit · Credit · Balance, etc). This reads column position instead of
 * guessing from text order: it locates the header row's column
 * x-positions, anchors each transaction on its date, and pulls the
 * amount/direction from whichever amount column is physically closest,
 * and the note from every narration line nearest that same row (by
 * y-distance), however many lines it wraps to. Returns [] if a page's
 * layout doesn't look like a table it can read confidently — callers
 * should fall back to parseStatementText() then. */
const PDF_NOISE_RE = /^\d+\s+of\s+\d+$/i;
const PDF_STOP_RE = /closing balance|total (debit|credit)s?|other account details|^summary\s*:?$|^[a-z][a-z .]*bank limited$/i;
const PDF_LABEL_RE =
  /^(si|date|particulars|narration|description|transaction remarks|remarks|details|chq num|withdrawal|deposit|balance|debit|credit|amount|type|dr\/cr|cr\/dr)\.?$/i;

function pdfFindHeader(lines) {
  const DATE_LBL = /^(date|txn date|value date)$/i;
  const NARR_LBL = /^(particulars|narration|description|transaction remarks|remarks|details)$/i;
  const WITHDRAWAL_LBL = /^(withdrawal|debit)(\s*amt\.?)?$/i;
  const DEPOSIT_LBL = /^(deposit|credit)(\s*amt\.?)?$/i;
  const AMOUNT_LBL = /^amount$/i;
  const TYPE_LBL = /^(dr\/cr|cr\/dr|type)$/i;
  const BALANCE_LBL = /(^|\s)balance$/i;

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
    if (wX != null && dX != null) {
      const ranges = pdfColumnRanges([[wX, "out"], [dX, "in"], [balX, null]]);
      return { headerIndex: li, headerY: lines[li].y, dateX, mode: "split", withdrawalX: wX, depositX: dX, balanceX: balX, ranges };
    }
    if (amtX != null && typeX != null) {
      const ranges = pdfColumnRanges([[amtX, "amt"], [balX, null]]);
      return { headerIndex: li, headerY: lines[li].y, dateX, mode: "typed", amountX: amtX, typeX, balanceX: balX, ranges };
    }
  }
  return null;
}

function pdfColumnRanges(bounds) {
  return bounds.filter(([x]) => x != null).sort((a, b) => a[0] - b[0]);
}

function pdfColumnAt(x, ranges) {
  let label;
  for (const [boundX, lbl] of ranges) {
    if (x >= boundX - 5) label = lbl;
    else break;
  }
  return label;
}

function pdfLeadingNumber(s) {
  const m = s.trim().match(/^\d[\d,]*(?:\.\d{1,2})?/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : null;
}

function pdfExtractRows(lines, hdr, startIndex) {
  const anchors = [];
  const fragments = [];
  for (let li = startIndex; li < lines.length; li++) {
    const line = lines[li];
    const trimmed = line.text.trim();
    if (PDF_STOP_RE.test(trimmed)) break;
    if (!trimmed || PDF_NOISE_RE.test(trimmed)) continue;

    const dm = line.text.match(DATE_RE);
    const dateItem = dm && line.items.find((it) => it.s.includes(dm[0].trim()) || dm[0].trim().includes(it.s.trim()));
    const date = dm && ymdFromDateMatch(dm);

    if (date && dateItem) {
      const candidates = line.items
        .filter((it) => it.x > hdr.dateX + 5 && /^\d/.test(it.s.trim()))
        .map((it) => ({ it, v: pdfLeadingNumber(it.s) }))
        .filter((c) => Number.isFinite(c.v) && c.v >= 0);

      let amount, type;
      if (hdr.mode === "split") {
        for (const c of candidates) {
          const col = pdfColumnAt(c.it.x, hdr.ranges);
          if (col !== "out" && col !== "in") continue;
          amount = Math.round(c.v); type = col;
          break;
        }
      } else {
        const amtCandidate = candidates.find((c) => pdfColumnAt(c.it.x, hdr.ranges) === "amt");
        if (amtCandidate) {
          amount = Math.round(amtCandidate.v);
          const typeTok = line.items.find((it) => Math.abs(it.x - hdr.typeX) < 40);
          type = typeTok && /^cr/i.test(typeTok.s.trim()) ? "in" : "out";
        }
      }

      if (amount != null) {
        const inline = line.items
          .filter((it) => it.x > hdr.dateX + 5 && it !== dateItem && !/^\d/.test(it.s.trim()))
          .map((it) => it.s)
          .join(" ")
          .trim();
        anchors.push({ y: line.y, date, amount, type, pieces: inline ? [{ y: line.y, text: inline }] : [] });
        continue;
      }
    }

    const looksNumeric = line.items.some((it) => /^\d/.test(it.s.trim()));
    if (!dm && !looksNumeric && !PDF_LABEL_RE.test(trimmed)) fragments.push({ y: line.y, text: trimmed });
  }

  for (const f of fragments) {
    let before = null, after = null;
    for (const a of anchors) {
      if (a.y >= f.y) { if (!before || a.y < before.y) before = a; }
      else if (!after || a.y > after.y) after = a;
    }
    const distBefore = before ? before.y - f.y : Infinity;
    const distAfter = after ? f.y - after.y : Infinity;
    const chosen = distBefore <= distAfter ? before : after;
    const dist = Math.min(distBefore, distAfter);
    if (chosen && dist <= 120) chosen.pieces.push({ y: f.y, text: f.text });
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

// Exposed so tests can drive it directly with a synthetic item list.
export function parsePdfTablePage(items) {
  const lines = pdfGroupLines(items);
  const hdr = pdfFindHeader(lines);
  if (!hdr) return [];
  return pdfExtractRows(lines, hdr, hdr.headerIndex + 1);
}

// The real multi-page entry point. Many multi-page statements only print
// the column header once, on the first page — a page that doesn't repeat
// it reuses the most recently found header instead of being skipped
// outright, and skips the repeated letterhead block by Y-position match
// rather than by guessing a cutoff line.
export function parsePdfTable(pages) {
  let carried = null;
  let letterheadYs = null;
  const rows = [];
  for (const items of pages) {
    const lines = pdfGroupLines(items);
    const found = pdfFindHeader(lines);
    const hdr = found || carried;
    if (!hdr) continue;
    if (found) {
      carried = found;
      letterheadYs = new Set(lines.slice(0, found.headerIndex).map((l) => l.y));
    }
    const startIndex = found ? hdr.headerIndex + 1 : lines.findIndex((l) => !letterheadYs.has(l.y));
    if (startIndex === -1) continue;
    rows.push(...pdfExtractRows(lines, hdr, startIndex));
  }
  return rows;
}
