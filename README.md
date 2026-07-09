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

## Plan tab (optional)

Setup → paste an Anthropic API key (stored only on-device, sent only to
`api.anthropic.com`). The Plan tab sends this FY's totals — no notes, no
names — and returns spending insights.

## Backups

Setup → Export JSON downloads `cashbook-backup-<date>.json`. That file is
real financial data: `.gitignore` blocks it — keep it that way.
