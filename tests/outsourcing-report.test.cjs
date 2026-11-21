'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const totals = doc => {
  const total = round2((doc.items || []).reduce((s, i) => s + Number(i.qty ?? 1) * Number(i.rate || 0), 0));
  const paid = (doc.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  return { total, paid, balance: total - paid };
};
const inv = (id, extra) => Object.assign({
  id, type: 'Invoice', number: id.toUpperCase(), status: 'Sent', currency: 'INR', client: { name: 'Client ' + id },
  items: [{ name: 'Site', qty: 1, rate: 10000, outsourced: { provider: 'Pixel Co', cost: 6000 } }], payments: []
}, extra);

function build(documents, vendorBills) {
  const context = {
    db: { documents, vendorBills }, draft: null, view: 'Accounts', financeCategories: [],
    totals, render() {}, console: { error() {}, log() {} },
    document: { addEventListener() {}, getElementById: () => null }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('outsourcing-engine.js'), context);
  vm.runInContext(read('outsourcing.js'), context);
  return context.crmOutsourcingReport.buildRows(context.db, totals);
}

test('report rows, partial payment, bill status, exclusions and per-currency totals', () => {
  const docs = [
    inv('a', { payments: [{ amount: 5000 }] }),
    inv('b', { payments: [{ amount: 10000 }] }),
    inv('c', { status: 'Cancelled' }),
    inv('d', { currency: 'AED' }),
    inv('e', { items: [{ name: 'Plain', qty: 1, rate: 500 }] }),
    { id: 'q', type: 'Quotation', items: [], payments: [] }
  ];
  const bills = [
    { autoOutsourced: true, sourceInvoiceId: 'a', amount: 3000, currency: 'INR', status: 'Pending' },
    { autoOutsourced: true, sourceInvoiceId: 'b', amount: 3000, currency: 'INR', status: 'Paid' },
    { autoOutsourced: true, sourceInvoiceId: 'b', amount: 3000, currency: 'INR', status: 'Pending' },
    { autoOutsourced: false, sourceInvoiceId: 'a', amount: 99, currency: 'INR', status: 'Pending' }
  ];
  const { rows, totals: t } = build(docs, bills);
  assert.deepEqual([...rows.map(r => r.id)], ['a', 'b', 'd']);
  const a = rows[0];
  assert.equal(a.price, 10000);
  assert.equal(a.cost, 6000);
  assert.equal(a.commission, 4000);
  assert.equal(a.paidPercent, 50);
  assert.equal(a.earned, 2000);
  assert.equal(a.billStatus, 'Pending ₹3,000.00');
  assert.equal(rows[1].billStatus, 'Paid ₹3,000.00 · Pending ₹3,000.00');
  assert.equal(rows[2].billStatus, 'Not due');
  assert.deepEqual({ ...t.INR }, { price: 20000, cost: 12000, commission: 8000, earned: 6000 });
  assert.deepEqual({ ...t.AED }, { price: 10000, cost: 6000, commission: 4000, earned: 0 });
  assert.deepEqual([...Object.keys(t).sort()], ['AED', 'INR']);
});

test('paid-only bill status', () => {
  const { rows } = build([inv('a', { payments: [{ amount: 10000 }] })], [{ autoOutsourced: true, sourceInvoiceId: 'a', amount: 6000, currency: 'INR', status: 'Paid' }]);
  assert.equal(rows[0].billStatus, 'Paid ₹6,000.00');
});
