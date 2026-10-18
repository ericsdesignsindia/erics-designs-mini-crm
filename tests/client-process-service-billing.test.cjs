const assert = require('node:assert/strict');
const { prepare, prepareServiceProformas, prepareServiceInvoice, serviceValue } = require('../client-process-engine');

const state = { documents: [], settings: { invoiceTerms: 'Net 7 days.' } };
const quote = {
  id: 'quote-1', type: 'Quotation', number: 'ED-Q-0001', status: 'Accepted',
  clientApprovedForProcess: true, contractConfirmedAt: '2026-10-18T08:00:00.000Z',
  currency: 'INR', discount: 10, tax: 18, terms: 'Quoted terms.',
  items: [
    { name: 'Website design', description: 'Design package', qty: 1, rate: 10000 },
    { name: 'SEO', description: 'Monthly SEO', qty: 2, rate: 10000 },
  ],
};
let id = 0;
const uuid = () => `record-${++id}`;
const now = '2026-10-18T08:00:00.000Z';
const proformas = prepareServiceProformas(state, quote, uuid, now);

assert.equal(proformas.length, 2, 'one proforma is created per quoted service');
assert.deepEqual(proformas.map(doc => doc.serviceIndex), [0, 1]);
assert.deepEqual(proformas.map(doc => doc.advanceAmount), [5310, 10620]);
assert.equal(prepare(state, quote, uuid, now), null, 'the combined proforma is suppressed in service-wise mode');
assert.equal(prepareServiceProformas(state, quote, uuid, now).length, 0, 'creating vouchers is idempotent');

const first = proformas[0];
first.payments.push({ id: 'advance-1', date: '2026-10-18', amount: 5309, reference: 'UPI' });
assert.equal(prepareServiceInvoice(state, quote, first, uuid, now), null, 'invoice waits for full advance');
first.payments[0].amount = first.advanceAmount;
const invoice = prepareServiceInvoice(state, quote, first, uuid, now);
assert.ok(invoice, 'balance invoice is created after advance payment');
assert.equal(invoice.serviceIndex, first.serviceIndex);
assert.equal(invoice.sourceProformaId, first.id);
assert.equal(invoice.payments[0].sourceProformaId, first.id, 'advance stays linked for ledger de-duplication');

const invoiceTotal = invoice.items.reduce((sum, item) => sum + item.qty * item.rate, 0);
const invoicePaid = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
assert.equal(invoiceTotal, 10000, 'the balance invoice retains the full service value');
assert.equal(invoiceTotal * 0.9 * 1.18 - invoicePaid, 5310, 'the invoice shows only the remaining amount due');
assert.equal(prepareServiceInvoice(state, quote, first, uuid, now).id, invoice.id, 'repeated action opens the same invoice');
assert.equal(serviceValue(quote, quote.items[1]), 21240);

console.log('Service-wise billing creates distinct advances and linked balance invoices without duplicates.');
