'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function createCrm({ persistResult = true, totalsThrows = false } = {}) {
  const calls = { persist: 0, billsSeenByPersist: [] };
  const toasts = [];
  const errors = [];
  const context = {
    db: {
      vendorBills: [],
      documents: [{
        id: 'inv1', type: 'Invoice', number: 'INV-001', status: 'Sent', currency: 'INR', client: { name: 'Alpha' },
        items: [{ name: 'Site', qty: 1, rate: 1000, outsourced: { provider: 'Pixel Co', cost: 400 } }],
        discount: 0, tax: 0, payments: []
      }]
    },
    draft: null, view: 'documents', financeCategories: [],
    esc: v => String(v ?? ''),
    today: () => '2026-11-21',
    totals: doc => {
      if (totalsThrows) throw new Error('totals boom');
      const subtotal = round2((doc.items || []).reduce((s, i) => s + round2((i.qty === undefined || i.qty === null || i.qty === '' ? 1 : Number(i.qty)) * Number(i.rate || 0)), 0));
      const discount = round2(subtotal * Number(doc.discount || 0) / 100);
      const net = subtotal - discount;
      const tax = round2(net * Number(doc.tax || 0) / 100);
      const total = net + tax;
      const paid = (doc.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      return { subtotal, discount, tax, total, paid, balance: total - paid };
    },
    render() {},
    toast: message => toasts.push(message),
    console: { error: (...args) => errors.push(args.map(String).join(' ')), log() {} },
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null }
  };
  context.persist = function () {
    calls.persist += 1;
    calls.billsSeenByPersist.push(context.db.vendorBills.length);
    return persistResult;
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('outsourcing-engine.js'), context, { filename: 'outsourcing-engine.js' });
  vm.runInContext(read('outsourcing.js'), context, { filename: 'outsourcing.js' });
  const run = code => vm.runInContext(code, context);
  return { context, calls, toasts, errors, run };
}

const recordPayment = crm => crm.context.db.documents[0].payments.push({ amount: 1000 });

test('a save after a client payment creates the provider bill and toasts it', () => {
  const crm = createCrm();
  assert.equal(crm.run('persist()'), true);
  assert.equal(crm.context.db.vendorBills.length, 0, 'no bill before any payment');
  recordPayment(crm);
  assert.equal(crm.run('persist()'), true);
  const bills = crm.context.db.vendorBills;
  assert.equal(bills.length, 1);
  assert.equal(bills[0].vendor, 'Pixel Co');
  assert.equal(bills[0].amount, 400);
  assert.equal(bills[0].sourceInvoiceNumber, 'INV-001');
  assert.deepEqual(crm.toasts, ['Provider bill created: Pixel Co ₹400.00 (INV-001)']);
});

test('a second save does not duplicate the bill or toast again', () => {
  const crm = createCrm();
  recordPayment(crm);
  crm.run('persist()');
  crm.run('persist()');
  assert.equal(crm.context.db.vendorBills.length, 1);
  assert.equal(crm.toasts.length, 1);
});

test('a changed cost toasts the update', () => {
  const crm = createCrm();
  recordPayment(crm);
  crm.run('persist()');
  crm.context.db.documents[0].items[0].outsourced.cost = 500;
  crm.run('persist()');
  assert.equal(crm.context.db.vendorBills[0].amount, 500);
  assert.equal(crm.toasts[1], 'Provider bill updated: Pixel Co ₹400.00 → ₹500.00');
});

test('the original persist still runs and its result passes through', () => {
  for (const result of [true, false]) {
    const crm = createCrm({ persistResult: result });
    recordPayment(crm);
    assert.equal(crm.run('persist()'), result);
    assert.equal(crm.calls.persist, 1);
  }
});

test('the bill is already in db when the original persist runs (same write)', () => {
  const crm = createCrm();
  recordPayment(crm);
  crm.run('persist()');
  assert.deepEqual(crm.calls.billsSeenByPersist, [1]);
});

test('an exception in the sync is logged and never blocks the save', () => {
  const crm = createCrm({ totalsThrows: true });
  recordPayment(crm);
  assert.equal(crm.run('persist()'), true);
  assert.equal(crm.calls.persist, 1);
  assert.ok(crm.errors.some(line => line.includes('Provider bill sync failed')), 'error logged');
  assert.equal(crm.toasts.length, 0);
});
