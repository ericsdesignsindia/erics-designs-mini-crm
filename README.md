# Eric's Designs Mini CRM

A browser-based CRM for quotations, proforma invoices, final invoices, clients, leads, projects, follow-ups, and payment tracking.

## Included
- Separate document numbering: ED-Q-0001, ED-P-0001, and ED-0001 for final invoices.
- Quotation → proforma → final invoice conversion, retaining the original records.
- Client profiles with notes, lead source, pipeline stage, potential value, and linked documents.
- Lead pipeline: New lead, Contacted, Proposal sent, Won, Lost.
- Project budgets, delivery dates, and statuses.
- Follow-up tasks with due/overdue indicators and completion tracking.
- Partial/full payments, outstanding balances, and overdue final invoices.
- INR and AED documents, with currency-specific totals and payment tracking.
- Rate-card quotations with per-month, per-campaign, per-unit, and on-request prices without a misleading grand total.
- A4 printing / Save as PDF, CSV exports, and JSON backup/restore.
- Manual ChatGPT drafting prompts for quotations, scope, follow-ups, and payment reminders.

## Start
Open index.html (with its companion files in the same folder) or the supplied single-file HTML version in Chrome or Edge. No build or installation is needed.

Review Settings before the first invoice. Enter bank/UPI details, confirm contact details, and review default tax and service prices. The defaults come from the supplied business templates. Unpriced services require a price before saving.

## Storage
Records stay in localStorage on the current browser and origin. GitHub does not store clients, invoices, tasks, or entered bank details. Different browsers, devices, and website addresses have separate records. Clearing browser data can remove them.

Export a backup regularly. To move from the original Billing Studio to GitHub Pages, export a backup from the original site and restore it on GitHub Pages. Restore replaces the destination records after confirmation. Version 1 billing backups are supported and upgraded; retain the backup because the previous app does not understand CRM version 2 backups.

Use one browser tab for editing. The app detects changes from another tab and blocks conflicting saves. This is a single-user browser edition, without authentication, cloud synchronization, background notifications, automatic email, or live API integration.

## ChatGPT workflow
1. Open AI drafts, select a draft type and optionally a client.
2. Add a brief and choose Prepare ChatGPT prompt.
3. Review and copy the prompt, then paste it into ChatGPT yourself.
4. Review the result. Paste useful wording into the reviewed-answer box and choose Use as quotation notes.
5. Add services and verify prices before saving the quotation.

Prompt preparation is local and does not call an AI model. Client contact details, bank details, and private notes are excluded from generated prompts. The selected client's name and document summaries are included for review. No API key is requested or stored.

## GitHub Pages
Publish these files at the repository root: index.html, style.css, crm.css, billing.js, crm.js. In repository Settings → Pages, select Deploy from a branch, main, /(root), then Save. Keep the relative paths intact so project Pages URLs work.

Only publish application source and this README. Do not commit JSON backups, client exports, or real generated invoices. The repository's defaults contain the business contact details and reference service rates, not live client records.

## Suggested next upgrades
1. Cloud database and sign-in for safe access across devices.
2. Secure server-side OpenAI API integration for one-click drafting; never put a secret API key in browser code or GitHub Pages.
3. Client approval links and document acceptance history.
4. Recurring retainers and scheduled invoice generation.
5. Payment gateway links and receipt reconciliation.

## Verification
Tested client creation, project/follow-up storage, pipeline updates, linked Q→P→final conversion, duplicate conversion prevention, INR/AED totals, rate-card quotations, payment balances, backup restoration, AI prompt contents, mobile layout, and PDF generation. This is an operational studio tool, not a certified accounting or tax-compliance system.
