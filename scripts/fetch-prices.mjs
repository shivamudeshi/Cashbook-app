// Fetches free, official, no-auth daily price data and writes two static
// files the app ships alongside itself: public/instruments.json (a
// name->code search index for mutual funds + stocks) and public/prices.json
// (a slim {instrumentId: {price, asOf}} snapshot). Run by
// .github/workflows/prices.yml on a daily cron, server-side — never called
// from the app itself, so none of this is subject to the browser CORS/bot
// restrictions these sources enforce against arbitrary websites.
//
// Gold is deliberately not fetched here: the app values gold holdings at
// cost basis only (see holdingsValue() in src/CashBook.jsx) — there's
// nothing to fetch for it.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchText(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, ...extraHeaders } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

// AMFI NAVAll.txt: mostly "code;isinPayout;isinReinvest;name;nav;date" rows,
// interleaved with blank lines and category/AMC header lines with no
// semicolons — only lines starting with a numeric scheme code are data.
function parseAmfiNav(text) {
  const mf = [];
  const prices = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^\d+;/.test(line)) continue;
    const parts = line.split(";");
    if (parts.length < 6) continue;
    const [code, , , name, navStr, date] = parts;
    const nav = parseFloat(navStr);
    if (!code || !name || !Number.isFinite(nav) || nav <= 0) continue;
    mf.push({ code, name: name.trim() });
    prices[code] = { price: nav, asOf: amfiDateToIso(date.trim()) };
  }
  return { mf, prices };
}

function amfiDateToIso(d) {
  // "01-Jul-2026" -> "2026-07-01"
  const m = d.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return d;
  const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
                    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const mon = MONTHS[m[2]];
  if (!mon) return d;
  return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
}

// NSE's symbol master (name/CSV column layout is stable and has been for
// years: SYMBOL, NAME OF COMPANY, ...).
function parseNseEquityList(text) {
  const stock = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const symbol = (cols[0] || "").trim();
    const name = (cols[1] || "").trim();
    if (!symbol || !name) continue;
    stock.push({ symbol, name });
  }
  return stock;
}

// NSE's daily Bhavcopy CSV (UDIFF full-market EOD settlement prices).
// Column layout: TckrSymb, ..., ClsPric, ... (varies by exact report; keyed
// by header name below rather than a fixed index so a column reorder
// doesn't silently produce wrong prices).
function parseBhavcopy(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return {};
  const header = lines[0].split(",").map((h) => h.trim());
  const symbolIdx = header.indexOf("TckrSymb");
  const closeIdx = header.indexOf("ClsPric");
  const dateIdx = header.indexOf("TradDt");
  if (symbolIdx === -1 || closeIdx === -1) return {};
  const prices = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const symbol = (cols[symbolIdx] || "").trim();
    const close = parseFloat(cols[closeIdx]);
    if (!symbol || !Number.isFinite(close) || close <= 0) continue;
    prices[symbol] = { price: close, asOf: dateIdx >= 0 ? (cols[dateIdx] || "").trim() : undefined };
  }
  return prices;
}

async function main() {
  const instruments = { mf: [], stock: [] };
  const prices = {};
  const errors = [];

  try {
    const navText = await fetchText("https://www.amfiindia.com/spider/NAVAll.txt");
    const { mf, prices: mfPrices } = parseAmfiNav(navText);
    instruments.mf = mf;
    Object.assign(prices, mfPrices);
    console.log(`AMFI: ${mf.length} schemes`);
  } catch (e) {
    errors.push(`AMFI NAV fetch failed: ${e.message}`);
  }

  try {
    const listText = await fetchText("https://archives.nseindia.com/content/equity/EQUITY_L.csv");
    instruments.stock = parseNseEquityList(listText);
    console.log(`NSE symbol list: ${instruments.stock.length} equities`);
  } catch (e) {
    errors.push(`NSE symbol list fetch failed: ${e.message}`);
  }

  try {
    const today = new Date();
    const dd = String(today.getUTCDate()).padStart(2, "0");
    const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = today.getUTCFullYear();
    const bhavUrl = `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${yyyy}${mm}${dd}_F_0000.csv`;
    const bhavText = await fetchText(bhavUrl, { Referer: "https://www.nseindia.com/" });
    const stockPrices = parseBhavcopy(bhavText);
    Object.assign(prices, stockPrices);
    console.log(`NSE Bhavcopy: ${Object.keys(stockPrices).length} prices`);
  } catch (e) {
    // Non-fatal: the Bhavcopy URL/format is the least stable piece of this
    // pipeline (NSE has changed it before) and today might not be a trading
    // day — keep going with whatever MF data succeeded rather than failing
    // the whole run.
    errors.push(`NSE Bhavcopy fetch failed (stock prices skipped today): ${e.message}`);
  }

  if (!instruments.mf.length && !instruments.stock.length) {
    console.error("Every source failed — refusing to overwrite the last good snapshot.");
    console.error(errors.join("\n"));
    process.exit(1);
  }
  if (errors.length) console.warn(errors.join("\n"));

  await writeFile(path.join(ROOT, "public", "instruments.json"), JSON.stringify(instruments));
  await writeFile(path.join(ROOT, "public", "prices.json"), JSON.stringify(prices));
  console.log(`Wrote ${instruments.mf.length} MF + ${instruments.stock.length} stock instruments, ${Object.keys(prices).length} prices.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
