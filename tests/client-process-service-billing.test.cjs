const assert = require('node:assert/strict');
const { prepare, prepareServiceProformas, prepareServiceInvoice, prepareCompletedServiceInvoice, serviceValue, serviceProgressStage, isSequentialStepBlocked } = require('../client-process-engine');

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

const singleServiceQuote = {
  ...quote, id: 'quote-single-service', serviceBillingAllocations: undefined,
  items: [{ name: 'SEO', qty: 1, rate: 12000 }], discount: 0, tax: 0,
};
const singleServiceState = { documents: [], settings: {} };
assert.equal(prepareServiceProformas(singleServiceState, singleServiceQuote, uuid, now).length, 1, 'separate service billing supports a quotation with one service');

const progressQuote = { ...quote, id: 'quote-progress', billingMode: 'service-wise' };
const progressDocs = [
  { id: 'progress-p1', type: 'Proforma', status: 'Accepted', rootId: progressQuote.id, serviceIndex: 0, total: 5000, paid: 5000, balance: 0 },
  { id: 'progress-p2', type: 'Proforma', status: 'Accepted', rootId: progressQuote.id, serviceIndex: 1, total: 5000, paid: 5000, balance: 0 },
  { id: 'progress-i1', type: 'Invoice', status: 'Paid', rootId: progressQuote.id, serviceIndex: 0, total: 10000, paid: 10000, balance: 0 },
];
const summaryTotals = document => ({ total: document.total, paid: document.paid, balance: document.balance });
assert.equal(serviceProgressStage(progressQuote, progressDocs, summaryTotals), 5, 'one paid service does not mark the full quotation complete');
progressDocs.push({ id: 'progress-i2', type: 'Invoice', status: 'Sent', rootId: progressQuote.id, serviceIndex: 1, total: 10000, paid: 0, balance: 10000 });
assert.equal(serviceProgressStage(progressQuote, progressDocs, summaryTotals), 6, 'an unpaid balance invoice keeps the quotation at payment due');
progressDocs[3].paid = 10000;
progressDocs[3].balance = 0;
assert.equal(serviceProgressStage(progressQuote, progressDocs, summaryTotals), 7, 'the quotation completes after every service invoice is paid');

const legacyProgressQuote = { ...progressQuote, id: 'quote-legacy-progress', billingMode: 'service-completion' };
const legacyProgressDocs = [
  { id: 'legacy-i1', type: 'Invoice', status: 'Paid', rootId: legacyProgressQuote.id, serviceIndex: 0, total: 10000, paid: 10000, balance: 0 },
];
assert.equal(serviceProgressStage(legacyProgressQuote, legacyProgressDocs, summaryTotals), 5, 'one paid legacy service invoice leaves remaining services in progress');
legacyProgressDocs.push({ id: 'legacy-i2', type: 'Invoice', status: 'Sent', rootId: legacyProgressQuote.id, serviceIndex: 1, total: 10000, paid: 0, balance: 10000 });
assert.equal(serviceProgressStage(legacyProgressQuote, legacyProgressDocs, summaryTotals), 6, 'a legacy service invoice balance remains due');
legacyProgressDocs[1].paid = 10000;
legacyProgressDocs[1].balance = 0;
assert.equal(serviceProgressStage(legacyProgressQuote, legacyProgressDocs, summaryTotals), 7, 'legacy service billing completes only after all services are invoiced and paid');

const sequentialProject = { deliveryMode: 'sequential', tasks: [
  { id: 'first', serviceIndex: 0, sequence: 1, done: false },
  { id: 'second', serviceIndex: 1, sequence: 2, done: true },
] };
assert.equal(isSequentialStepBlocked(sequentialProject, sequentialProject.tasks[1]), true, 'sequential billing cannot advance past an unfinished earlier service');
sequentialProject.tasks[0].done = true;
assert.equal(isSequentialStepBlocked(sequentialProject, sequentialProject.tasks[1]), false, 'sequential billing unlocks after the earlier service is complete');

const unpricedQuote = {
  id: 'quote-unpriced', type: 'Quotation', number: 'ED-Q-0002', status: 'Accepted',
  clientApprovedForProcess: true, contractConfirmedAt: now, currency: 'INR',
  rateCard: true, discount: 0, tax: 18,
  items: [{ name: 'Brand strategy', qty: 1, rate: 0, rateText: 'Included in package' }, { name: 'Website', qty: 1, rate: 0, rateText: 'Included in package' }],
};
const allocatedState = { documents: [], settings: {} };
const allocatedProformas = prepareServiceProformas(allocatedState, unpricedQuote, uuid, now, [12000, 18000]);
assert.equal(allocatedProformas.length, 2, 'manual allocations support services without individual quotation prices');
assert.deepEqual(unpricedQuote.serviceBillingAllocations, [12000, 18000], 'service allocations are saved on the source quotation');
assert.deepEqual(allocatedProformas.map(doc => doc.projectValue), [14160, 21240], 'quotation tax is applied to each allocated service');
assert.deepEqual(allocatedProformas.map(doc => doc.advanceAmount), [7080, 10620], 'each service requests its own half advance');
assert.deepEqual(allocatedProformas.map(doc => doc.items[0].rate), [12000, 18000], 'generated billing documents use the entered service allocation');

const noAdvanceQuote = {
  id: 'quote-no-advance', type: 'Quotation', number: 'ED-Q-0003', status: 'Accepted',
  clientApprovedForProcess: true, contractConfirmedAt: now, billingMode: 'service-completion',
  currency: 'INR', discount: 10, tax: 18, serviceBillingAllocations: [12000, 18000],
  items: [
    { name: 'Brand strategy', qty: 1, rate: 0, rateText: 'Included in package' },
    { name: 'Website', qty: 1, rate: 0, rateText: 'Included in package' },
  ],
};
const noAdvanceState = { documents: [], settings: { invoiceTerms: 'Net 7 days.' } };
assert.equal(prepare(noAdvanceState, noAdvanceQuote, uuid, now), null, 'no combined advance proforma is created');
assert.equal(prepareCompletedServiceInvoice(noAdvanceState, { ...noAdvanceQuote, contractConfirmedAt: null }, 0, uuid, now), null, 'invoice creation requires a confirmed contract');
const serviceInvoice = prepareCompletedServiceInvoice(noAdvanceState, noAdvanceQuote, 0, uuid, now);
assert.ok(serviceInvoice, 'completed service can receive its own invoice without an advance');
assert.equal(serviceInvoice.serviceIndex, 0);
assert.equal(serviceInvoice.items.length, 1, 'invoice contains only the completed service');
assert.equal(serviceInvoice.projectValue, 12744, 'service value includes its share of discount and tax');
assert.deepEqual(serviceInvoice.payments, [], 'no advance payment is carried to the service invoice');
assert.equal(serviceInvoice.advanceAmount, 0);
assert.match(serviceInvoice.terms, /No advance was requested/);
assert.equal(prepareCompletedServiceInvoice(noAdvanceState, noAdvanceQuote, 0, uuid, now).id, serviceInvoice.id, 'repeated action returns the existing service invoice');
const remainingServiceInvoice = prepareCompletedServiceInvoice(noAdvanceState, noAdvanceQuote, 1, uuid, now);
assert.ok(remainingServiceInvoice, 'each quoted service can be invoiced separately');
assert.equal(remainingServiceInvoice.serviceIndex, 1);

console.log('Service-wise advances and no-advance completion invoices are generated separately and without duplicates.');
