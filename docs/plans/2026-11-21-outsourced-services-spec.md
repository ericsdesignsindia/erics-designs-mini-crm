# Spec — Outsourced services with commission

Date: 2026-11-21. Owner: Eric Rodgers (Eric's Designs).

## Business model (decided by the owner)

1. **Eric's Designs bills the client.** The client receives one normal invoice from
   Eric's Designs at the full client price. The client never deals with the provider.
2. **Both prices are entered per service.** For each outsourced line the owner enters
   the outside provider's name and the provider's cost. Commission = client price − provider cost.
3. **The provider is paid after the client pays.** The CRM creates (or tops up) a bill
   to pay the provider only when client payments are recorded on the invoice.

## Definitions

- A document line is **outsourced** when `item.outsourced` is an object
  `{ provider: string (non-empty, trimmed), cost: number >= 0 }`.
  `cost` is the provider's total cost for that line (quantity already included), in the
  document's currency.
- **Line client revenue** = `qty × rate × (1 − discount% / 100)` using the document's
  discount. Tax is excluded (tax collected is not commission).
- **Line commission** = line client revenue − line cost. It can be negative (a loss); show it, never hide it.
- Quantities default to 1 when missing, as `totals()` does (`num(i.qty)`; missing qty → treat as 1).

## Rules

- Outsourcing data may be set on Quotations, Proformas and Invoices so it carries through
  conversion, but **provider bills are created only from Invoices** whose status is not
  `Draft` or `Cancelled`.
- **Paid share**: `paidRatio = min(1, invoice paid ÷ invoice total)` (0 when total is 0).
  Provider amount due for a provider on an invoice = `round2(sum of that provider's line costs × paidRatio)`.
- Bills are grouped **per invoice per provider**. Provider names compare case-insensitively after trimming.
- Auto-created bills are normal `db.vendorBills` records with these fields:
  `{ id, vendor, category: 'Outsourced services', amount, currency (invoice currency or 'INR'),
  due (today + 7 days, YYYY-MM-DD), status: 'Pending', note, autoOutsourced: true,
  sourceInvoiceId, sourceInvoiceNumber, providerKey }`.
  `note` = `Outsourced services for <client name> · <invoice number>`.
- **Deterministic ids** so two devices never create duplicates:
  `ob-<invoiceId>-<providerKey>-<n>` where `providerKey` = provider lowercased with every run
  of non `[a-z0-9]` characters replaced by `-`, trimmed of `-`, and `n` starts at 1.
- **Sync algorithm** (idempotent; running it twice changes nothing the second time):
  - `paidBills` = this invoice+provider's auto bills with `status === 'Paid'`; `paidSum` = their amounts.
  - `open` = the one auto bill for this invoice+provider whose status is not `Paid` (at most one).
  - `remaining = round2(target − paidSum)`.
  - If `remaining > 0.009`: update `open.amount` to `remaining` if `open` exists, else create a new
    bill with the next free `n`.
  - If `remaining <= 0.009` and `open` exists: remove `open` (it is auto-created and unpaid).
  - **Never edit or delete a Paid bill or any bill without `autoOutsourced: true`.**
  - Invoices that are Draft/Cancelled, or that no longer have outsourced lines for a provider,
    have target 0 (so unpaid auto bills for them are removed).
- Add `'Outsourced services'` to the existing `financeCategories` list so the bill form and
  Accounts show it. Paying the bill uses the existing "Mark paid" flow, which records the expense.
- The client PDF must never show provider names or costs (the PDF already prints only
  name/description/rate — do not change pdf-engine.js).
- Currency: never add INR and AED together. Summaries are per currency.

## User-facing pieces

1. **Document editor panel "Outsourced services"** (shown under the document editor whenever a
   document draft is open): one row per line item with a checkbox "Outsourced", provider name,
   provider cost, and the line's commission. A summary shows client price, provider cost and
   commission for outsourced lines (per the document currency). Edits write to
   `draft.items[i].outsourced` (or delete it when unticked) and take effect when the document is saved.
2. **Automatic provider bills** whenever the CRM saves (`persist`), plus a toast naming the
   provider and amount when a bill is created or its amount changes.
3. **Accounts panel "Outsourced services & commission"**: one row per invoice with outsourced
   lines: client, invoice number, client price, provider cost, commission, client paid %, provider
   bill status (Not due / Pending ₹x / Paid ₹x). Totals per currency: client price, provider cost,
   commission, and "Commission earned so far" = sum over invoices of commission × paidRatio.

## Out of scope

Provider directory/contacts, provider-facing documents, GST/tax treatment advice, editing the
PDF engine, server changes.
