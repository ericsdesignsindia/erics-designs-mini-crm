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
- Quantities follow `totals()` exactly (`num(i.qty)`): a missing or blank qty is 0.
- A blank or invalid provider cost (not a finite number ≥ 0, e.g. "1,500" in a number field) is
  stored as `{ provider, cost: null }`. Such a line is not outsourced: no commission, no bill, and its
  editor row says "Enter the provider cost".

## Rules

- Outsourcing data may be set on Quotations, Proformas and Invoices so it carries through
  conversion, but **provider bills are created only from Invoices** whose status is not
  `Draft` or `Cancelled`.
- **Paid share**: `paidRatio = min(1, invoice paid ÷ invoice total)` (0 when total is 0).
  Provider amount due for a provider on an invoice = `round2(sum of that provider's line costs × paidRatio)`.
- Bills are grouped **per invoice per provider**. Provider names compare case-insensitively after trimming.
- Auto-created bills are normal `db.vendorBills` records with these fields:
  `{ id, vendor, category: 'Outsourced services', amount, currency (invoice currency or 'INR'),
  due, status: 'Pending', note, autoOutsourced: true,
  sourceInvoiceId, sourceInvoiceNumber, providerKey }`.
  `note` = `Outsourced services for <client name> · <invoice number>`.
  `due` = latest client payment date on the invoice + 7 days (YYYY-MM-DD, UTC date math); today + 7
  when no payment has a date. An open bill's `due` changes only when its amount changes.
- **Detached bills**: editing an unpaid auto bill from the vendor-bill form first asks
  "This bill follows invoice <number>. Editing it here stops automatic updates for this bill. Continue?".
  Cancel does nothing; Continue removes `autoOutsourced` (keeping `sourceInvoiceId`,
  `sourceInvoiceNumber`, `providerKey`) and opens the normal edit form. A bill with `sourceInvoiceId` +
  `providerKey` and no `autoOutsourced: true` is detached: the sync never edits or removes it.
- **Deterministic ids** so two devices never create duplicates:
  `ob-<invoiceId>-<providerKey>-<n>` where `providerKey` = provider lowercased with every run
  of non `[a-z0-9]` characters replaced by `-`, trimmed of `-`, and `n` starts at 1.
- **Sync algorithm** (idempotent; running it twice changes nothing the second time):
  - `covered` = this invoice+provider's Paid auto bills plus its detached bills (Paid or not),
    counting only bills in the invoice's **current currency**. Bills in another currency are never
    netted; the report row then says "Provider bill paid in another currency — check".
  - **Orphaned credit**: Paid auto bills and detached bills of the invoice whose `providerKey` no
    longer has a target (provider renamed or removed) are orphaned. Their amounts (invoice currency
    only) are credited to the invoice's current provider targets in line order, before any bill is
    created or topped up. The report row and the editor panel (when that invoice is open) say
    "Provider changed after payment — check bills".
  - `open` = the first unpaid auto bill for this invoice+provider. Any further unpaid auto bills for
    the same pair (duplicates) are removed; Paid and detached bills are never removed.
  - `remaining = round2(target − covered)`.
  - If `remaining > 0.009`: if `open` exists, set its amount to `remaining`, its `currency` to the
    invoice currency, its `vendor` to the current provider display name (and `due` per above when
    the amount changes); else create a new bill with the next free `n`.
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
   provider and amount when a bill is created or its amount or currency changes. The toast is
   queued and shown 1500 ms after the save, and only when the save succeeded (so the caller's own
   "saved" toast does not overwrite it).
3. **Accounts panel "Outsourced services & commission"**: one row per invoice with outsourced
   lines: client, invoice number, client price, provider cost, commission, client paid %, provider
   bill status (Not due / Pending ₹x / Paid ₹x, auto and detached bills, each amount in its own bill
   currency) plus the check notes above. Totals per currency: client price, provider cost,
   commission, and "Commission earned so far" = sum over invoices of commission × paidRatio.

## Out of scope

Provider directory/contacts, provider-facing documents, GST/tax treatment advice, editing the
PDF engine, server changes.
