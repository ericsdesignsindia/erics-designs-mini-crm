# Plan — Outsourced services with commission

Spec: docs/plans/2026-11-21-outsourced-services-spec.md (binding authority).

## Context

Classic HTML/JS CRM. `classic.html` and `index.html` load scripts in order; later scripts wrap
global functions (`render`, `persist`, `newDoc`, …). Globals used here: `db` (workspace),
`draft` (document being edited, or null), `view`, `render()`, `persist()`, `toast(msg)`,
`today()` (YYYY-MM-DD), `addDays(n)`, `uid()`, `esc()`, `totals(doc)` (returns
`{subtotal, discount, tax, total, paid, balance}`), `financeCategories` (array),
`markVendorBillPaid(id)`. Vendor bills live in `db.vendorBills`.
Pure modules follow the UMD pattern of `sync-merge.js` (exports via `module.exports` in Node,
`window.<name>` in the browser) and have `node:test` tests in `tests/*.test.cjs`
(see `tests/sync-merge.test.cjs` and `tests/api-sync-conflict.test.cjs` for style).
New scripts must be added to `scripts/sync-dist.cjs` and to both `classic.html` and
`index.html` (with a `?v=20261121-outsourcing-r1` cache tag), after `additional-services.js`.
Run `npm run build:dist` after changing any app file. Existing test
`tests/client-process-service-billing.test.cjs` already fails before this work; ignore it.

## Global Constraints

- Provider bills only from Invoices not in Draft/Cancelled; never touch a Paid bill or a bill without `autoOutsourced: true`.
- Bill id format `ob-<invoiceId>-<providerKey>-<n>`; category `'Outsourced services'`; due = today + 7 days; status `'Pending'`.
- Line client revenue = qty × rate × (1 − discount/100), tax excluded; commission = revenue − cost; round to 2 decimals.
- paidRatio = min(1, paid ÷ total), 0 when total is 0.
- Never sum different currencies together.
- Client PDF unchanged (do not edit pdf-engine.js).
- No new dependencies. Plain browser JS, no build step beyond `npm run build:dist`.

## Task 1 — Pure engine `outsourcing-engine.js` + tests

Create `outsourcing-engine.js` (UMD; browser global `window.crmOutsourcing`) exporting:

- `providerKey(name)` → lowercase, runs of non `[a-z0-9]` → `-`, trim `-`. `'Pixel Studio & Co.'` → `'pixel-studio-co'`.
- `isOutsourced(item)` → true when `item.outsourced` has a non-empty trimmed `provider` and a finite `cost >= 0`.
- `documentCommission(doc)` → `{ currency, lines: [{ index, name, provider, revenue, cost, commission }], revenue, cost, commission }` for outsourced lines only, using the spec formulas (qty missing → 1, discount from `doc.discount`, round2 each line and the sums).
- `paidRatio(doc, totalsFn)` → spec formula; `totalsFn(doc)` returns `{ total, paid }`.
- `syncProviderBills(state, { today, totalsFn })` → mutates `state.vendorBills` (create the array if missing) per the spec sync algorithm and returns `{ created: [bill], updated: [{ bill, from, to }], removed: [bill] }`. `today` is `YYYY-MM-DD`; due = today + 7 days computed with UTC date math. Bill fields exactly as the spec lists.

Tests `tests/outsourcing-engine.test.cjs` must cover at least: providerKey example above; commission with discount 10% (qty 2 × rate 5000, cost 6000 → revenue 9000, commission 3000); negative commission is reported; no bill for Draft and Cancelled invoices; 50% paid → bill 3000 for cost 6000; second sync is a no-op; paying more tops up the open bill; after the bill is marked Paid, further payment creates bill `n=2` for the remainder only; two providers on one invoice get separate bills; cancelling an invoice removes its unpaid auto bill but keeps a Paid one; manual (non-auto) bills are never touched; AED invoice creates an AED bill.

## Task 2 — Editor panel in `outsourcing.js`

Create `outsourcing.js` (browser only, loaded after `outsourcing-engine.js`). It renders a panel
`<section class="panel outsourcing-panel" id="outsourcingPanel">` titled "Outsourced services"
appended to the end of `#app` whenever `draft` is non-null after each `render()` (wrap
`window.render` like `additional-services.js` does; do not duplicate the panel). One row per
`draft.items[i]` with: line name (or "Line N"), checkbox "Outsourced", provider name input,
provider cost input (number, min 0, step 0.01), and the line's commission text. Changing a field
writes `draft.items[i].outsourced = { provider, cost }` (delete the key when unticked) and
updates the row commission and the summary in place without calling `render()` (so typing focus
is kept). Summary line: "Client price ₹x · Provider cost ₹y · Commission ₹z" using the document
currency symbol (₹ for INR, AED otherwise). A short hint: "Provider names and costs are internal.
They never appear on the client's PDF." Inputs need labels/aria-labels. Also add
`'Outsourced services'` to `financeCategories` once at load. Add styles in `cirrel-ui.css`
under a comment `/* Outsourced services (2026-11-21) */` (rows readable on 375px phones, 44px tap
targets). Wire the new scripts into `classic.html`, `index.html`, `scripts/sync-dist.cjs`.

## Task 3 — Automatic provider bills on save

In `outsourcing.js`, wrap the global `persist` once: before calling the previous `persist`, run
`crmOutsourcing.syncProviderBills(db, { today: today(), totalsFn: totals })` inside try/catch
(log errors, never block the save). For each created bill toast
"Provider bill created: <vendor> ₹<amount> (<invoice number>)"; for each updated bill toast
"Provider bill updated: <vendor> ₹<from> → ₹<to>". Add `tests/outsourcing-persist.test.cjs`
that loads `outsourcing-engine.js` and `outsourcing.js` in a `node:vm` context with stubbed
globals (`db`, `persist`, `toast`, `today`, `totals`, `render`, `financeCategories`, minimal
`document`/`window`) and proves: a save after recording a client payment creates the bill;
a second save does not duplicate it; the original persist is still called and its return value
is passed through; an exception in sync does not block the save.

## Task 4 — Accounts report panel

In `outsourcing.js`, when `view === 'Accounts'` and no draft is open, insert a panel
`<section class="panel outsourcing-report" id="outsourcingReport">` titled
"Outsourced services & commission" immediately before `#accounts-vendor-bills` (fallback: end of
`#app`), after each render. Rows: one per Invoice (not Cancelled) with outsourced lines: client,
invoice number (button that calls `openDoc(id)`), client price, provider cost, commission,
"Client paid N%", provider bill status (Not due / Pending ₹x / Paid ₹x, summing auto bills for
that invoice). Totals per currency: client price, provider cost, commission, and
"Commission earned so far" = Σ commission × paidRatio. Empty state: "No outsourced services yet.
Tick “Outsourced” on a document line to track provider costs and your commission." Escape all
text with `esc()`. Extend the vm test or add assertions in `tests/outsourcing-persist.test.cjs`
for the report numbers (export the report-row builder as a testable function on
`window.crmOutsourcingReport`).
