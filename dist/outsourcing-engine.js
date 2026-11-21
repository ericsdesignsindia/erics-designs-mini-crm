'use strict';

/*
 * Outsourced services with commission: pure, side-effect-free engine.
 *
 * A document line is outsourced when item.outsourced = { provider, cost }.
 * Commission = client revenue (qty x rate less document discount) - provider cost.
 * Provider bills are created from Invoices only, and only for the share the
 * client has paid (see syncProviderBills).
 *
 * Bill kinds for one invoice + provider (sourceInvoiceId + providerKey):
 * - auto: autoOutsourced === true. The sync owns unpaid auto bills (edits/removes them).
 * - detached: an auto bill the owner edited by hand (autoOutsourced removed). Never
 *   edited or removed; its amount counts as already covered.
 * Paid auto bills and detached bills count as covered only in the invoice currency.
 */
(function (root) {
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const num = v => Number(v) || 0;
  const EPSILON = 0.009;
  const CATEGORY = 'Outsourced services';

  function providerKey(name) {
    return String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function isOutsourced(item) {
    const o = item && item.outsourced;
    if (!o || typeof o !== 'object') return false;
    if (typeof o.provider !== 'string' || !o.provider.trim()) return false;
    return typeof o.cost === 'number' && Number.isFinite(o.cost) && o.cost >= 0;
  }

  // Same as totals(): num(qty), so a missing quantity is 0.
  const lineQty = item => num(item.qty);

  function documentCommission(doc) {
    const discount = num(doc && doc.discount);
    const lines = [];
    ((doc && doc.items) || []).forEach((item, index) => {
      if (!isOutsourced(item)) return;
      const revenue = round2(lineQty(item) * num(item.rate) * (1 - discount / 100));
      const cost = round2(item.outsourced.cost);
      lines.push({ index, name: item.name || '', provider: item.outsourced.provider.trim(), revenue, cost, commission: round2(revenue - cost) });
    });
    const sum = key => round2(lines.reduce((s, l) => s + l[key], 0));
    return { currency: (doc && doc.currency) || 'INR', lines, revenue: sum('revenue'), cost: sum('cost'), commission: sum('commission') };
  }

  function paidRatio(doc, totalsFn) {
    const { total, paid } = totalsFn(doc);
    if (!(num(total) > 0)) return 0;
    return Math.min(1, num(paid) / num(total));
  }

  function addDays(isoDate, days) {
    const [y, m, d] = String(isoDate).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }

  // Due = latest client payment date on the invoice + 7 days; today + 7 when no payment has a date.
  function dueDate(doc, today) {
    let latest = '';
    ((doc && doc.payments) || []).forEach(p => {
      const date = String((p && p.date) || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date > latest) latest = date;
    });
    return addDays(latest || today, 7);
  }

  // Provider keys of the outsourced lines, in line order: [{ key, vendor, cost }].
  function lineProviders(doc) {
    const out = [];
    const byKey = new Map();
    documentCommission(doc).lines.forEach(line => {
      const key = providerKey(line.provider);
      if (!key) return;
      let entry = byKey.get(key);
      if (!entry) { entry = { key, vendor: line.provider, cost: 0 }; byKey.set(key, entry); out.push(entry); }
      entry.cost += line.cost;
    });
    return out;
  }

  // Target amount per provider for one invoice, in line order: [{ key, vendor, target }].
  function providerTargets(doc, totalsFn) {
    if (!doc || doc.type !== 'Invoice' || doc.status === 'Draft' || doc.status === 'Cancelled') return [];
    const ratio = paidRatio(doc, totalsFn);
    return lineProviders(doc).map(p => ({ key: p.key, vendor: p.vendor, target: round2(p.cost * ratio) }));
  }

  const billCurrency = b => b.currency || 'INR';
  const isLinked = b => !!(b && b.sourceInvoiceId && b.providerKey);
  const isAuto = b => isLinked(b) && b.autoOutsourced === true;
  // A bill whose amount is settled from the sync's point of view: Paid auto, or detached.
  const isSettled = b => isLinked(b) && (b.autoOutsourced !== true || b.status === 'Paid');

  // Review flags for one invoice's provider bills (for the report and the editor).
  function reviewInvoiceBills(state, doc) {
    const result = { otherCurrency: false, providerChanged: false };
    if (!doc) return result;
    const currency = doc.currency || 'INR';
    const keys = new Set(lineProviders(doc).map(p => p.key));
    ((state && state.vendorBills) || []).forEach(b => {
      if (!isSettled(b) || b.sourceInvoiceId !== doc.id) return;
      if (billCurrency(b) !== currency) result.otherCurrency = true;
      if (!keys.has(b.providerKey)) result.providerChanged = true;
    });
    return result;
  }

  function syncProviderBills(state, { today, totalsFn }) {
    if (!Array.isArray(state.vendorBills)) state.vendorBills = [];
    const bills = state.vendorBills;
    const result = { created: [], updated: [], removed: [] };
    const docs = state.documents || [];
    const remove = bill => {
      const index = bills.indexOf(bill);
      if (index >= 0) bills.splice(index, 1);
      result.removed.push(bill);
    };

    // Every invoice that has a target or a linked bill, with the document that produced its targets.
    const invoices = new Map();
    docs.forEach(doc => {
      const targets = providerTargets(doc, totalsFn);
      if (targets.length && !invoices.has(doc.id)) invoices.set(doc.id, { doc, targets });
    });
    bills.filter(isAuto).forEach(b => {
      if (!invoices.has(b.sourceInvoiceId)) invoices.set(b.sourceInvoiceId, { doc: null, targets: [] });
    });

    invoices.forEach(({ doc, targets }, invoiceId) => {
      const currency = (doc && doc.currency) || 'INR';
      const mine = bills.filter(b => isLinked(b) && b.sourceInvoiceId === invoiceId);
      const targetKeys = new Set(targets.map(t => t.key));

      // Covered = Paid auto + detached bills in the invoice currency. Bills under provider keys
      // that no longer have a target are orphaned: their credit goes to current providers in line order.
      const covered = new Map();
      let orphanCredit = 0;
      mine.filter(b => isSettled(b) && billCurrency(b) === currency).forEach(b => {
        if (targetKeys.has(b.providerKey)) covered.set(b.providerKey, round2((covered.get(b.providerKey) || 0) + num(b.amount)));
        else orphanCredit = round2(orphanCredit + num(b.amount));
      });
      targets.forEach(t => {
        const need = round2(t.target - (covered.get(t.key) || 0));
        if (need <= 0 || orphanCredit <= 0) return;
        const applied = Math.min(need, orphanCredit);
        covered.set(t.key, round2((covered.get(t.key) || 0) + applied));
        orphanCredit = round2(orphanCredit - applied);
      });

      const keys = targets.map(t => t.key);
      mine.filter(b => isAuto(b) && b.status !== 'Paid' && !targetKeys.has(b.providerKey)).forEach(b => {
        if (!keys.includes(b.providerKey)) keys.push(b.providerKey);
      });

      keys.forEach(key => {
        const target = targets.find(t => t.key === key);
        const opens = mine.filter(b => isAuto(b) && b.status !== 'Paid' && b.providerKey === key);
        opens.slice(1).forEach(remove); // duplicates: keep the first open bill only
        const open = opens[0];
        const remaining = round2((target ? target.target : 0) - (covered.get(key) || 0));
        if (remaining > EPSILON) {
          if (open) {
            const amountChanged = round2(open.amount) !== remaining;
            const currencyChanged = billCurrency(open) !== currency;
            if (target.vendor && open.vendor !== target.vendor) open.vendor = target.vendor;
            if (amountChanged || currencyChanged) {
              const from = open.amount;
              const fromCurrency = billCurrency(open);
              open.amount = remaining;
              open.currency = currency;
              if (amountChanged) open.due = dueDate(doc, today);
              result.updated.push({ bill: open, from, fromCurrency, to: remaining });
            }
          } else if (doc) {
            let n = 1;
            while (bills.some(b => b.id === `ob-${invoiceId}-${key}-${n}`)) n++;
            const bill = {
              id: `ob-${invoiceId}-${key}-${n}`,
              vendor: target.vendor,
              category: CATEGORY,
              amount: remaining,
              currency,
              due: dueDate(doc, today),
              status: 'Pending',
              note: `Outsourced services for ${(doc.client && doc.client.name) || ''} · ${doc.number || ''}`,
              autoOutsourced: true,
              sourceInvoiceId: invoiceId,
              sourceInvoiceNumber: doc.number || '',
              providerKey: key
            };
            bills.push(bill);
            result.created.push(bill);
          }
        } else if (open) {
          remove(open);
        }
      });
    });
    return result;
  }

  const api = { providerKey, isOutsourced, documentCommission, paidRatio, syncProviderBills, reviewInvoiceBills };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.crmOutsourcing = api;
})(typeof window !== 'undefined' ? window : globalThis);
