'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  providerKey, isOutsourced, documentCommission, paidRatio, syncProviderBills, reviewInvoiceBills
} = require('../outsourcing-engine.js');

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = v => Number(v) || 0;
// Mirrors the CRM's totals(): num(qty) (missing qty is 0), paid = sum of payments.
function totals(doc) {
  const subtotal = round2((doc.items || []).reduce((s, i) => s + round2(num(i.qty) * num(i.rate)), 0));
  const discount = round2(subtotal * num(doc.discount) / 100);
  const net = subtotal - discount;
  const tax = round2(net * num(doc.tax) / 100);
  const total = net + tax;
  const paid = (doc.payments || []).reduce((s, p) => s + num(p.amount), 0);
  return { subtotal, discount, net, tax, total, paid };
}
const TODAY = '2026-11-21';
const sync = state => syncProviderBills(state, { today: TODAY, totalsFn: totals });

const invoice = (over = {}) => ({
  id: 'inv1', type: 'Invoice', number: 'ED-0001', status: 'Sent', currency: 'INR',
  client: { name: 'Alpha' }, discount: 0, tax: 0,
  items: [{ name: 'Logo', qty: 1, rate: 10000, outsourced: { provider: 'Pixel Studio', cost: 6000 } }],
  payments: [], ...over
});

test('providerKey slugifies', () => {
  assert.equal(providerKey('Pixel Studio & Co.'), 'pixel-studio-co');
  assert.equal(providerKey('  --A  b-- '), 'a-b');
});

test('isOutsourced needs provider and finite cost >= 0', () => {
  assert.equal(isOutsourced({ outsourced: { provider: 'X', cost: 0 } }), true);
  assert.equal(isOutsourced({ outsourced: { provider: '  ', cost: 5 } }), false);
  assert.equal(isOutsourced({ outsourced: { provider: 'X', cost: -1 } }), false);
  assert.equal(isOutsourced({ outsourced: { provider: 'X', cost: NaN } }), false);
  assert.equal(isOutsourced({}), false);
});

test('commission uses discount and quantity', () => {
  const doc = { currency: 'INR', discount: 10, items: [
    { name: 'A', qty: 2, rate: 5000, outsourced: { provider: 'P', cost: 6000 } },
    { name: 'B', qty: 1, rate: 100 }
  ] };
  const c = documentCommission(doc);
  assert.equal(c.lines.length, 1);
  assert.equal(c.lines[0].index, 0);
  assert.equal(c.lines[0].revenue, 9000);
  assert.equal(c.lines[0].commission, 3000);
  assert.equal(c.revenue, 9000);
  assert.equal(c.cost, 6000);
  assert.equal(c.commission, 3000);
  assert.equal(c.currency, 'INR');
});

test('negative commission is reported', () => {
  const c = documentCommission({ items: [{ name: 'A', qty: 1, rate: 1000, outsourced: { provider: 'P', cost: 1500 } }] });
  assert.equal(c.commission, -500);
  assert.equal(c.lines[0].commission, -500);
});

test('missing qty counts as 0, as totals() does', () => {
  const c = documentCommission({ items: [{ name: 'A', rate: 1000, outsourced: { provider: 'P', cost: 400 } }] });
  assert.equal(c.revenue, 0);
  assert.equal(c.lines[0].commission, -400);
});

test('paidRatio caps at 1 and handles zero total', () => {
  assert.equal(paidRatio(invoice({ payments: [{ amount: 5000 }] }), totals), 0.5);
  assert.equal(paidRatio(invoice({ payments: [{ amount: 99999 }] }), totals), 1);
  assert.equal(paidRatio(invoice({ items: [] }), totals), 0);
});

test('no bill for Draft and Cancelled invoices', () => {
  for (const status of ['Draft', 'Cancelled']) {
    const state = { documents: [invoice({ status, payments: [{ amount: 10000 }] })], vendorBills: [] };
    const r = sync(state);
    assert.equal(state.vendorBills.length, 0);
    assert.equal(r.created.length, 0);
  }
});

test('no bill for non-invoice documents or unpaid invoices', () => {
  const state = { documents: [invoice({ type: 'Quotation', payments: [{ amount: 10000 }] }), invoice({ id: 'inv2' })] };
  sync(state);
  assert.equal(state.vendorBills.length, 0);
});

test('50% paid creates bill of 3000 with spec fields', () => {
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [] };
  const r = sync(state);
  assert.equal(r.created.length, 1);
  assert.deepEqual(state.vendorBills[0], {
    id: 'ob-inv1-pixel-studio-1', vendor: 'Pixel Studio', category: 'Outsourced services', amount: 3000,
    currency: 'INR', due: '2026-11-28', status: 'Pending',
    note: 'Outsourced services for Alpha · ED-0001', autoOutsourced: true,
    sourceInvoiceId: 'inv1', sourceInvoiceNumber: 'ED-0001', providerKey: 'pixel-studio'
  });
});

test('second sync is a no-op', () => {
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [] };
  sync(state);
  const snap = JSON.stringify(state);
  const r = sync(state);
  assert.deepEqual([r.created.length, r.updated.length, r.removed.length], [0, 0, 0]);
  assert.equal(JSON.stringify(state), snap);
});

test('more payment tops up the open bill', () => {
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [] };
  sync(state);
  state.documents[0].payments.push({ amount: 2500 });
  const r = sync(state);
  assert.equal(state.vendorBills.length, 1);
  assert.equal(state.vendorBills[0].amount, 4500);
  assert.equal(r.updated.length, 1);
  assert.equal(r.updated[0].from, 3000);
  assert.equal(r.updated[0].to, 4500);
});

test('after bill is Paid, extra payment creates n=2 for remainder only', () => {
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [] };
  sync(state);
  state.vendorBills[0].status = 'Paid';
  state.documents[0].payments.push({ amount: 5000 });
  const r = sync(state);
  assert.equal(state.vendorBills.length, 2);
  assert.equal(state.vendorBills[1].id, 'ob-inv1-pixel-studio-2');
  assert.equal(state.vendorBills[1].amount, 3000);
  assert.equal(state.vendorBills[0].amount, 3000);
  assert.equal(r.created.length, 1);
});

test('two providers get separate bills; names compare case-insensitively', () => {
  const doc = invoice({
    items: [
      { name: 'A', qty: 1, rate: 5000, outsourced: { provider: 'Pixel Studio', cost: 2000 } },
      { name: 'B', qty: 1, rate: 5000, outsourced: { provider: 'Code Co', cost: 3000 } },
      { name: 'C', qty: 1, rate: 0, outsourced: { provider: ' pixel studio ', cost: 1000 } }
    ],
    payments: [{ amount: 10000 }]
  });
  const state = { documents: [doc] };
  sync(state);
  assert.equal(state.vendorBills.length, 2);
  const byKey = Object.fromEntries(state.vendorBills.map(b => [b.providerKey, b.amount]));
  assert.deepEqual(byKey, { 'pixel-studio': 3000, 'code-co': 3000 });
});

test('cancelling removes unpaid auto bill but keeps Paid one', () => {
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [] };
  sync(state);
  state.documents[0].payments.push({ amount: 5000 });
  state.vendorBills[0].status = 'Paid';
  sync(state); // creates n=2
  assert.equal(state.vendorBills.length, 2);
  state.documents[0].status = 'Cancelled';
  const r = sync(state);
  assert.equal(r.removed.length, 1);
  assert.equal(state.vendorBills.length, 1);
  assert.equal(state.vendorBills[0].status, 'Paid');
  assert.equal(state.vendorBills[0].amount, 3000);
});

test('removing outsourced flag removes unpaid auto bill', () => {
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [] };
  sync(state);
  delete state.documents[0].items[0].outsourced;
  sync(state);
  assert.equal(state.vendorBills.length, 0);
});

test('manual bills are never touched; a detached bill (source + providerKey) counts as covered', () => {
  const manual = { id: 'ob-inv1-pixel-studio-1', vendor: 'Pixel Studio', amount: 1, status: 'Pending' };
  const manual2 = { id: 'b9', vendor: 'Pixel Studio', amount: 50, status: 'Pending', sourceInvoiceId: 'inv1', providerKey: 'pixel-studio' };
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [manual, manual2] };
  sync(state);
  assert.deepEqual(state.vendorBills[0], { id: 'ob-inv1-pixel-studio-1', vendor: 'Pixel Studio', amount: 1, status: 'Pending' });
  assert.equal(state.vendorBills[1].amount, 50);
  assert.equal(state.vendorBills.length, 3);
  assert.equal(state.vendorBills[2].id, 'ob-inv1-pixel-studio-2');
  assert.equal(state.vendorBills[2].amount, 2950);
  state.documents[0].status = 'Cancelled';
  sync(state);
  assert.equal(state.vendorBills.length, 2);
});

test('AED invoice creates AED bill', () => {
  const state = { documents: [invoice({ currency: 'AED', payments: [{ amount: 10000 }] })] };
  sync(state);
  assert.equal(state.vendorBills[0].currency, 'AED');
});

test('missing currency falls back to INR; vendorBills array is created', () => {
  const doc = invoice({ payments: [{ amount: 10000 }] });
  delete doc.currency;
  const state = { documents: [doc] };
  sync(state);
  assert.equal(state.vendorBills[0].currency, 'INR');
});

test('due date rolls over month and year', () => {
  const state = { documents: [invoice({ payments: [{ amount: 10000 }] })], vendorBills: [] };
  syncProviderBills(state, { today: '2026-12-28', totalsFn: totals });
  assert.equal(state.vendorBills[0].due, '2027-01-04');
});

// ---- Final-review fixes (2026-11-21) ----

test('cost null (blank or invalid entry) is not outsourced and earns no commission', () => {
  assert.equal(isOutsourced({ outsourced: { provider: 'X', cost: null } }), false);
  const c = documentCommission({ items: [{ name: 'A', qty: 1, rate: 1000, outsourced: { provider: 'X', cost: null } }] });
  assert.equal(c.lines.length, 0);
  assert.equal(c.commission, 0);
  const state = { documents: [invoice({ items: [{ name: 'A', qty: 1, rate: 10000, outsourced: { provider: 'X', cost: null } }], payments: [{ amount: 10000 }] })] };
  sync(state);
  assert.equal(state.vendorBills.length, 0);
});

test('currency switch moves the open bill to the invoice currency', () => {
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [] };
  sync(state);
  assert.deepEqual([state.vendorBills[0].currency, state.vendorBills[0].amount], ['INR', 3000]);
  const doc = state.documents[0];
  doc.currency = 'AED';
  doc.items[0].outsourced.cost = 600;
  doc.payments = [{ amount: 10000 }];
  const r = sync(state);
  assert.equal(state.vendorBills.length, 1);
  assert.deepEqual([state.vendorBills[0].currency, state.vendorBills[0].amount], ['AED', 600]);
  assert.equal(r.updated.length, 1);
  assert.deepEqual([r.updated[0].from, r.updated[0].fromCurrency, r.updated[0].to], [3000, 'INR', 600]);
  assert.deepEqual(reviewInvoiceBills(state, doc), { otherCurrency: false, providerChanged: false });
});

test('a Paid bill in another currency is never netted and is flagged', () => {
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [] };
  sync(state);
  state.vendorBills[0].status = 'Paid';
  const doc = state.documents[0];
  doc.currency = 'AED';
  doc.items[0].outsourced.cost = 600;
  doc.payments = [{ amount: 10000 }];
  sync(state);
  assert.equal(state.vendorBills.length, 2);
  assert.deepEqual([state.vendorBills[0].currency, state.vendorBills[0].amount, state.vendorBills[0].status], ['INR', 3000, 'Paid']);
  assert.deepEqual([state.vendorBills[1].currency, state.vendorBills[1].amount, state.vendorBills[1].status], ['AED', 600, 'Pending']);
  assert.deepEqual(reviewInvoiceBills(state, doc), { otherCurrency: true, providerChanged: false });
  const snap = JSON.stringify(state);
  sync(state);
  assert.equal(JSON.stringify(state), snap, 'idempotent');
});

test('provider rename after a fully covering Paid bill creates no new bill', () => {
  const state = { documents: [invoice({ items: [{ name: 'Logo', qty: 1, rate: 10000, outsourced: { provider: 'Pixel Studo', cost: 6000 } }], payments: [{ amount: 10000 }] })], vendorBills: [] };
  sync(state);
  state.vendorBills[0].status = 'Paid';
  state.documents[0].items[0].outsourced.provider = 'Pixel Studio';
  const r = sync(state);
  assert.equal(state.vendorBills.length, 1);
  assert.equal(r.created.length, 0);
  assert.deepEqual(reviewInvoiceBills(state, state.documents[0]), { otherCurrency: false, providerChanged: true });
});

test('provider rename after a partial Paid bill bills only the difference', () => {
  const state = { documents: [invoice({ items: [{ name: 'Logo', qty: 1, rate: 10000, outsourced: { provider: 'Pixel Studo', cost: 6000 } }], payments: [{ amount: 5000 }] })], vendorBills: [] };
  sync(state);
  state.vendorBills[0].status = 'Paid';
  const doc = state.documents[0];
  doc.items[0].outsourced.provider = 'Pixel Studio';
  doc.payments.push({ amount: 5000 });
  const r = sync(state);
  assert.equal(r.created.length, 1);
  assert.equal(state.vendorBills.length, 2);
  assert.deepEqual([state.vendorBills[1].providerKey, state.vendorBills[1].vendor, state.vendorBills[1].amount], ['pixel-studio', 'Pixel Studio', 3000]);
  const snap = JSON.stringify(state);
  sync(state);
  assert.equal(JSON.stringify(state), snap, 'idempotent');
});

test('orphaned credit is applied to current providers in line order', () => {
  const state = { documents: [invoice({ items: [{ name: 'Logo', qty: 1, rate: 10000, outsourced: { provider: 'Old Co', cost: 5000 } }], payments: [{ amount: 10000 }] })], vendorBills: [] };
  sync(state);
  state.vendorBills[0].status = 'Paid'; // 5000 paid to Old Co
  state.documents[0].items = [
    { name: 'A', qty: 1, rate: 5000, outsourced: { provider: 'Code Co', cost: 3000 } },
    { name: 'B', qty: 1, rate: 5000, outsourced: { provider: 'Pixel Studio', cost: 3000 } }
  ];
  sync(state);
  const open = state.vendorBills.filter(b => b.status !== 'Paid');
  assert.deepEqual(open.map(b => [b.providerKey, b.amount]), [['pixel-studio', 1000]]);
});

test('duplicate open auto bills: keep the first, remove the extra, then reconcile', () => {
  const base = { vendor: 'Pixel Studio', category: 'Outsourced services', currency: 'INR', due: '2026-11-28', note: '', autoOutsourced: true, sourceInvoiceId: 'inv1', sourceInvoiceNumber: 'ED-0001', providerKey: 'pixel-studio' };
  const paid = { ...base, id: 'ob-inv1-pixel-studio-1', amount: 1000, status: 'Paid' };
  const first = { ...base, id: 'ob-inv1-pixel-studio-2', amount: 2000, status: 'Pending' };
  const extra = { ...base, id: 'ob-inv1-pixel-studio-3', amount: 2000, status: 'Pending' };
  const detached = { ...base, id: 'b-det', amount: 500, status: 'Pending' };
  delete detached.autoOutsourced;
  const state = { documents: [invoice({ payments: [{ amount: 10000 }] })], vendorBills: [paid, first, extra, detached] };
  const r = sync(state);
  assert.deepEqual(state.vendorBills.map(b => b.id), ['ob-inv1-pixel-studio-1', 'ob-inv1-pixel-studio-2', 'b-det']);
  assert.deepEqual(r.removed.map(b => b.id), ['ob-inv1-pixel-studio-3']);
  assert.equal(state.vendorBills[1].amount, 4500); // 6000 - 1000 paid - 500 detached
  assert.equal(state.vendorBills[2].amount, 500);
});

test('detached bill is never edited or removed and counts as covered', () => {
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [] };
  sync(state);
  const bill = state.vendorBills[0];
  delete bill.autoOutsourced; // detached by a manual edit
  bill.amount = 2500;
  const doc = state.documents[0];
  doc.payments.push({ amount: 5000 });
  sync(state);
  assert.equal(state.vendorBills.length, 2);
  assert.equal(state.vendorBills[0].amount, 2500);
  assert.equal(state.vendorBills[1].amount, 3500);
  assert.equal(state.vendorBills[1].autoOutsourced, true);
  doc.status = 'Cancelled';
  sync(state);
  assert.deepEqual(state.vendorBills.map(b => b.id), [bill.id]);
  assert.equal(state.vendorBills[0].amount, 2500);
});

test('detached bill under a removed provider is orphaned credit', () => {
  const state = { documents: [invoice({ payments: [{ amount: 10000 }] })], vendorBills: [] };
  sync(state);
  delete state.vendorBills[0].autoOutsourced;
  state.documents[0].items[0].outsourced.provider = 'Pixel Studio Ltd';
  sync(state);
  assert.equal(state.vendorBills.length, 1);
  assert.equal(reviewInvoiceBills(state, state.documents[0]).providerChanged, true);
});

test('due date is the latest client payment date + 7, else today + 7', () => {
  const state = { documents: [invoice({ payments: [{ amount: 2000, date: '2026-11-15' }, { amount: 3000, date: '2026-11-10' }] })], vendorBills: [] };
  sync(state);
  assert.equal(state.vendorBills[0].due, '2026-11-22');
  const doc = state.documents[0];
  doc.payments.push({ amount: 0, date: '2026-12-30' });
  sync(state);
  assert.equal(state.vendorBills[0].due, '2026-11-22', 'due unchanged while the amount is unchanged');
  doc.payments.push({ amount: 2500, date: '2026-12-31' });
  sync(state);
  assert.equal(state.vendorBills[0].amount, 4500);
  assert.equal(state.vendorBills[0].due, '2027-01-07');
});

test('open bill vendor follows the current provider display name', () => {
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [] };
  sync(state);
  state.documents[0].items[0].outsourced.provider = 'PIXEL Studio';
  const r = sync(state);
  assert.equal(state.vendorBills[0].vendor, 'PIXEL Studio');
  assert.equal(r.updated.length, 0, 'a name refresh alone is not an amount change');
  assert.equal(state.vendorBills[0].due, '2026-11-28');
});
