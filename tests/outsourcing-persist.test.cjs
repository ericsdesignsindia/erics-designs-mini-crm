'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Minimal fake of the editor panel DOM: one row (line 0) inside #outsourcingPanel.
function fakePanel() {
  const el = (extra = {}) => ({ textContent: '', value: '', checked: false, disabled: false, attrs: {}, classList: { toggle() {} }, setAttribute(k, v) { this.attrs[k] = v; }, ...extra });
  const parts = { '[data-os-name]': el(), '[data-os-on]': el({ checked: true }), '[data-os-provider]': el(), '[data-os-cost]': el(), '[data-os-commission]': el() };
  const panelParts = { '[data-os-summary]': el(), '[data-os-review]': el() };
  const panel = { querySelectorAll: () => [row], querySelector: sel => panelParts[sel] || null, contains: () => false, remove() {} };
  const row = { dataset: { line: '0' }, querySelector: sel => parts[sel] || null, closest: sel => (sel === '.outsourcing-row' ? row : sel === '#outsourcingPanel' ? panel : null) };
  Object.values(parts).forEach(p => { p.closest = row.closest; });
  return { panel, row, parts, panelParts };
}

function createCrm({ persistResult = true, totalsThrows = false, confirmAnswer = true } = {}) {
  const calls = { persist: 0, billsSeenByPersist: [], edits: [], confirms: [] };
  const toasts = [];
  const errors = [];
  const timers = [];
  const listeners = {};
  const dom = fakePanel();
  const app = { contains: () => true };
  const context = {
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    confirm: message => { calls.confirms.push(message); return confirmAnswer; },
    editVendorBill: id => {
      const bill = context.db.vendorBills.find(b => b.id === id);
      calls.edits.push({ id, bill: bill && JSON.parse(JSON.stringify(bill)) });
    },
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
      const subtotal = round2((doc.items || []).reduce((s, i) => s + round2((Number(i.qty) || 0) * Number(i.rate || 0)), 0));
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
    document: {
      activeElement: null,
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      getElementById: id => (id === 'app' ? app : id === 'outsourcingPanel' ? dom.panel : null),
      querySelector: () => null
    }
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
  const flush = () => timers.splice(0).forEach(t => t.fn());
  const fire = (type, target) => (listeners[type] || []).forEach(fn => fn({ target }));
  return { context, calls, toasts, errors, timers, flush, fire, dom, run };
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
  assert.deepEqual(crm.toasts, [], 'not shown until the delay passes');
  assert.deepEqual(crm.timers.map(t => t.ms), [1500]);
  crm.flush();
  assert.deepEqual(crm.toasts, ['Provider bill created: Pixel Co ₹400.00 (INV-001)']);
});

test('a second save does not duplicate the bill or toast again', () => {
  const crm = createCrm();
  recordPayment(crm);
  crm.run('persist()');
  crm.run('persist()');
  crm.flush();
  assert.equal(crm.context.db.vendorBills.length, 1);
  assert.equal(crm.toasts.length, 1);
});

test('a changed cost toasts the update', () => {
  const crm = createCrm();
  recordPayment(crm);
  crm.run('persist()');
  crm.context.db.documents[0].items[0].outsourced.cost = 500;
  crm.run('persist()');
  crm.flush();
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
  crm.flush();
  assert.equal(crm.toasts.length, 0);
});

// ---- Final-review fixes (2026-11-21) ----

test('provider-bill toast waits 1500 ms and runs after later toasts from the same save', () => {
  const crm = createCrm();
  recordPayment(crm);
  crm.run('persist(); toast("Payment saved and reflected in Accounts.")');
  assert.deepEqual(crm.toasts, ['Payment saved and reflected in Accounts.']);
  assert.deepEqual(crm.timers.map(t => t.ms), [1500]);
  crm.flush();
  assert.deepEqual(crm.toasts, ['Payment saved and reflected in Accounts.', 'Provider bill created: Pixel Co ₹400.00 (INV-001)']);
});

test('no provider-bill toast when the save fails', () => {
  const crm = createCrm({ persistResult: false });
  recordPayment(crm);
  assert.equal(crm.run('persist()'), false);
  assert.equal(crm.timers.length, 0);
  crm.flush();
  assert.deepEqual(crm.toasts, []);
});

test('a currency change is toasted in each currency', () => {
  const crm = createCrm();
  recordPayment(crm);
  crm.run('persist()');
  const doc = crm.context.db.documents[0];
  doc.currency = 'AED';
  doc.items[0].outsourced.cost = 80;
  crm.run('persist()');
  crm.flush();
  assert.equal(crm.toasts[1], 'Provider bill updated: Pixel Co ₹400.00 → AED 80.00');
  assert.equal(crm.context.db.vendorBills[0].currency, 'AED');
});

const autoBill = over => ({ id: 'ob-inv1-pixel-co-1', vendor: 'Pixel Co', category: 'Outsourced services', amount: 400, currency: 'INR', due: '2026-11-28', status: 'Pending', note: '', autoOutsourced: true, sourceInvoiceId: 'inv1', sourceInvoiceNumber: 'INV-001', providerKey: 'pixel-co', ...over });

test('editing an auto bill asks first; cancel leaves it automatic and opens nothing', () => {
  const crm = createCrm({ confirmAnswer: false });
  crm.context.db.vendorBills.push(autoBill());
  crm.run('editVendorBill("ob-inv1-pixel-co-1")');
  assert.deepEqual(crm.calls.confirms, ['This bill follows invoice INV-001. Editing it here stops automatic updates for this bill. Continue?']);
  assert.equal(crm.calls.edits.length, 0);
  assert.equal(crm.context.db.vendorBills[0].autoOutsourced, true);
});

test('continuing detaches the bill (keeps its links) and opens the original edit form', () => {
  const crm = createCrm({ confirmAnswer: true });
  crm.context.db.vendorBills.push(autoBill());
  crm.run('editVendorBill("ob-inv1-pixel-co-1")');
  assert.equal(crm.calls.edits.length, 1);
  const seen = crm.calls.edits[0].bill;
  assert.equal('autoOutsourced' in seen, false, 'original form sees a detached bill');
  assert.deepEqual([seen.sourceInvoiceId, seen.sourceInvoiceNumber, seen.providerKey], ['inv1', 'INV-001', 'pixel-co']);
  // A later sync leaves the detached bill alone and counts it as covered.
  crm.context.db.vendorBills[0].amount = 350;
  recordPayment(crm);
  crm.run('persist()');
  assert.deepEqual(crm.context.db.vendorBills.map(b => [b.id, b.amount]), [['ob-inv1-pixel-co-1', 350], ['ob-inv1-pixel-co-2', 50]]);
});

test('manual and Paid bills open the edit form without asking', () => {
  const crm = createCrm();
  crm.context.db.vendorBills.push({ id: 'm1', vendor: 'X', amount: 5, status: 'Pending' }, autoBill({ id: 'p1', status: 'Paid' }));
  crm.run('editVendorBill("m1"); editVendorBill("p1"); editVendorBill("new-id")');
  assert.deepEqual(crm.calls.confirms, []);
  assert.deepEqual(crm.calls.edits.map(e => e.id), ['m1', 'p1', 'new-id']);
  assert.equal(crm.context.db.vendorBills[1].autoOutsourced, true);
});

function editCost(crm, value, provider = 'Pixel Co') {
  crm.context.draft = { id: 'inv1', currency: 'INR', discount: 0, items: [{ name: 'Site', qty: 1, rate: 1000 }] };
  crm.dom.parts['[data-os-on]'].checked = true;
  crm.dom.parts['[data-os-provider]'].value = provider;
  crm.dom.parts['[data-os-cost]'].value = value;
  crm.fire('input', crm.dom.parts['[data-os-cost]']);
  return crm.context.draft.items[0].outsourced;
}

test('blank or invalid provider cost is stored as null and asks for the cost', () => {
  for (const value of ['', 'abc', '-5']) {
    const crm = createCrm();
    const o = editCost(crm, value);
    assert.deepEqual({ ...o }, { provider: 'Pixel Co', cost: null }, `value ${JSON.stringify(value)}`);
    assert.equal(crm.dom.parts['[data-os-commission]'].textContent, 'Enter the provider cost');
    assert.equal(crm.dom.panelParts['[data-os-summary]'].textContent, 'No outsourced lines yet.');
  }
  const crm = createCrm();
  assert.deepEqual({ ...editCost(crm, '0') }, { provider: 'Pixel Co', cost: 0 });
  assert.deepEqual({ ...editCost(crm, '250.5') }, { provider: 'Pixel Co', cost: 250.5 });
  assert.equal(crm.dom.parts['[data-os-commission]'].textContent, 'Commission ₹749.50');
  editCost(crm, '', '');
  assert.equal(crm.dom.parts['[data-os-commission]'].textContent, 'Add a provider name to count this line');
});

test('editor shows the provider-changed note for the open invoice', () => {
  const crm = createCrm();
  crm.context.db.vendorBills.push(autoBill({ status: 'Paid', providerKey: 'pixel-studo' }));
  editCost(crm, '400');
  assert.equal(crm.dom.panelParts['[data-os-review]'].textContent, 'Provider changed after payment — check bills');
  crm.context.db.vendorBills[0].providerKey = 'pixel-co';
  editCost(crm, '400');
  assert.equal(crm.dom.panelParts['[data-os-review]'].textContent, '');
});
