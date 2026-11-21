'use strict';

/*
 * Outsourced services with commission: pure, side-effect-free engine.
 *
 * A document line is outsourced when item.outsourced = { provider, cost }.
 * Commission = client revenue (qty x rate less document discount) - provider cost.
 * Provider bills are created from Invoices only, and only for the share the
 * client has paid (see syncProviderBills).
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

  const lineQty = item => (item.qty === undefined || item.qty === null || item.qty === '') ? 1 : num(item.qty);

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

  // Target amount per provider key for one invoice: { key: { vendor, target } }.
  function providerTargets(doc, totalsFn) {
    const out = {};
    if (!doc || doc.type !== 'Invoice' || doc.status === 'Draft' || doc.status === 'Cancelled') return out;
    const ratio = paidRatio(doc, totalsFn);
    documentCommission(doc).lines.forEach(line => {
      const key = providerKey(line.provider);
      if (!key) return;
      const entry = out[key] || (out[key] = { vendor: line.provider, cost: 0 });
      entry.cost += line.cost;
    });
    Object.keys(out).forEach(key => { out[key].target = round2(out[key].cost * ratio); });
    return out;
  }

  function syncProviderBills(state, { today, totalsFn }) {
    if (!Array.isArray(state.vendorBills)) state.vendorBills = [];
    const bills = state.vendorBills;
    const result = { created: [], updated: [], removed: [] };
    const docs = state.documents || [];
    const isAuto = b => b && b.autoOutsourced === true;

    // Every (invoice, provider) pair that has a target or an existing auto bill.
    const groups = new Map();
    const group = (invoiceId, key) => {
      const id = `${invoiceId}\u0000${key}`;
      if (!groups.has(id)) groups.set(id, { invoiceId, key, doc: null, vendor: '', target: 0 });
      return groups.get(id);
    };
    docs.forEach(doc => {
      const targets = providerTargets(doc, totalsFn);
      Object.keys(targets).forEach(key => {
        const g = group(doc.id, key);
        g.doc = doc; g.vendor = targets[key].vendor; g.target = targets[key].target;
      });
    });
    bills.filter(isAuto).forEach(b => {
      if (b.sourceInvoiceId && b.providerKey) group(b.sourceInvoiceId, b.providerKey);
    });

    groups.forEach(g => {
      const mine = bills.filter(b => isAuto(b) && b.sourceInvoiceId === g.invoiceId && b.providerKey === g.key);
      const paidSum = mine.filter(b => b.status === 'Paid').reduce((s, b) => s + num(b.amount), 0);
      const open = mine.find(b => b.status !== 'Paid');
      const remaining = round2(g.target - paidSum);
      if (remaining > EPSILON) {
        if (open) {
          if (round2(open.amount) !== remaining) {
            const from = open.amount;
            open.amount = remaining;
            result.updated.push({ bill: open, from, to: remaining });
          }
        } else if (g.doc) {
          let n = 1;
          while (bills.some(b => b.id === `ob-${g.invoiceId}-${g.key}-${n}`)) n++;
          const bill = {
            id: `ob-${g.invoiceId}-${g.key}-${n}`,
            vendor: g.vendor,
            category: CATEGORY,
            amount: remaining,
            currency: g.doc.currency || 'INR',
            due: addDays(today, 7),
            status: 'Pending',
            note: `Outsourced services for ${(g.doc.client && g.doc.client.name) || ''} · ${g.doc.number || ''}`,
            autoOutsourced: true,
            sourceInvoiceId: g.invoiceId,
            sourceInvoiceNumber: g.doc.number || '',
            providerKey: g.key
          };
          bills.push(bill);
          result.created.push(bill);
        }
      } else if (open) {
        bills.splice(bills.indexOf(open), 1);
        result.removed.push(open);
      }
    });
    return result;
  }

  const api = { providerKey, isOutsourced, documentCommission, paidRatio, syncProviderBills };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.crmOutsourcing = api;
})(typeof window !== 'undefined' ? window : globalThis);
