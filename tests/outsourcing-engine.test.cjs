'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  providerKey, isOutsourced, documentCommission, paidRatio, syncProviderBills
} = require('../outsourcing-engine.js');

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = v => Number(v) || 0;
// Mirrors the CRM's totals(): paid = sum of payments.
function totals(doc) {
  const subtotal = round2((doc.items || []).reduce((s, i) => s + round2((i.qty === undefined ? 1 : num(i.qty)) * num(i.rate)), 0));
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

test('missing qty counts as 1', () => {
  const c = documentCommission({ items: [{ name: 'A', rate: 1000, outsourced: { provider: 'P', cost: 400 } }] });
  assert.equal(c.revenue, 1000);
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

test('manual bills are never touched', () => {
  const manual = { id: 'ob-inv1-pixel-studio-1', vendor: 'Pixel Studio', amount: 1, status: 'Pending' };
  const manual2 = { id: 'b9', vendor: 'Pixel Studio', amount: 50, status: 'Pending', sourceInvoiceId: 'inv1', providerKey: 'pixel-studio' };
  const state = { documents: [invoice({ payments: [{ amount: 5000 }] })], vendorBills: [manual, manual2] };
  sync(state);
  assert.deepEqual(state.vendorBills[0], { id: 'ob-inv1-pixel-studio-1', vendor: 'Pixel Studio', amount: 1, status: 'Pending' });
  assert.equal(state.vendorBills[1].amount, 50);
  assert.equal(state.vendorBills.length, 3);
  assert.equal(state.vendorBills[2].id, 'ob-inv1-pixel-studio-2');
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
