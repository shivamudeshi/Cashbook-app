# Cash Book

A personal cash book PWA — React + esbuild, no framework, no backend. Runs
installed on an Android phone; all data lives on-device in IndexedDB.

Olive-green classic ledger, mobile-first, used one-handed.

## Commands

```bash
npm install
npm run build     # bundles src/ -> dist/
npm test          # mounts the REAL dist/app.js in jsdom and asserts it renders
```

Always run `npm run build && npm test` before shipping. The test also checks
the accounting engine on a worked example — the balance sheet must foot to
the rupee.

## Install on your phone

The app deploys to **https://shivamudeshi.github.io/Cashbook-app/** via
GitHub Actions on every push to `main` (`.github/workflows/pages.yml`).

1. Open that URL in Chrome on the phone.
2. Chrome menu (⋮) → **Add to Home screen** → **Install**.
3. First run: **Setup** → enter opening balances, rename the placeholder
   parties to real names, and (optionally) paste an Anthropic API key for
   the Plan tab.
4. Export a JSON backup from Setup regularly — the data lives only on the
   phone, and it is keyed to this URL, so keep the origin stable.

## How it works

- **Cash basis, Indian FY (Apr–Mar).** Every entry has Bank on one side; the
  other side is a P&L head, a balance-sheet account (transfers, or classed
  heads like SIP → Investments), or a **party**.
- **Owed fills itself**: bank entries tagged to a party (lend / borrow /
  repay) drive each party's debtor/creditor balance automatically. Manual
  memos cover amounts that never touched the bank; they're balanced by an
  Accruals reserve in equity so they stay off the P&L.
- **Assets = Liabilities + Equity, always.** Opening capital is derived, so
  the sheet balances by construction.
- Amounts are integer ₹; the amount box understands `500`, `2k`, `1.2L`.
- Entries are never deleted — re-code them, or park them in Suspense.

## Deploying an update

1. `npm run build && npm test`
2. **Bump `CACHE` in `public/sw.js`** (`cashbook-v1` → `v2`), or installed
   phones keep serving the stale cached bundle.
3. Serve `dist/` from any static host (data is keyed to the origin — keep it
   stable).

## Statement import (free, on-device)

Book → ⤓ Import reads statements entirely on the phone — no accounts, no
API, no cost:

- **PDF / Excel / CSV**: pdf.js + SheetJS + a heuristic parser
- **Photos & scanned PDFs**: built-in Tesseract OCR (one-time ~9MB reader
  download, cached by the service worker, offline after that)

Keyword rules code the rows to heads and learn from your corrections
(Setup → Import rules). Everything lands on a review screen before entering
the book.

## Share a bank SMS

The app is an Android share target: long-press a bank SMS → Share →
Cash Book, and a pre-filled entry opens (amount, direction, merchant,
suggested head). No permissions involved.

## Zero network

The app makes no network calls at all — after install it is fully offline.
Reports export as CSV or via Print → Save as PDF.

## Backups

Setup → Export JSON downloads `cashbook-backup-<date>.json`. That file is
real financial data: `.gitignore` blocks it — keep it that way.
