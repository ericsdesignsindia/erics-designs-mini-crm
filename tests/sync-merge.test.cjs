'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeWorkspace, stableStringify } = require('../sync-merge.js');

const base = () => ({
  settings: { name: "Eric's Designs", tax: 18, currency: 'INR' },
  clients: [{ id: 'c1', name: 'Alpha' }, { id: 'c2', name: 'Beta' }],
  documents: [{ id: 'd1', type: 'Invoice', number: 'ED-0001', status: 'Sent', payments: [] }],
  activity: [{ id: 'a1', message: 'Created Alpha' }]
});

test('edits to different records on each device both survive', () => {
  const local = base(); local.clients[0].name = 'Alpha Ltd';
  const remote = base(); remote.clients[1].name = 'Beta Pvt';
  const { state, conflicts } = mergeWorkspace(base(), local, remote);
  assert.deepEqual(state.clients.map(c => c.name), ['Alpha Ltd', 'Beta Pvt']);
  assert.equal(conflicts.length, 0);
});

test('records added on both devices are all kept, local additions keep their position', () => {
  const local = base(); local.clients.unshift({ id: 'c3', name: 'Gamma' });
  local.activity.unshift({ id: 'a2', message: 'Added Gamma' });
  const remote = base(); remote.clients.unshift({ id: 'c4', name: 'Delta' });
  remote.activity.unshift({ id: 'a3', message: 'Added Delta' });
  const { state, conflicts } = mergeWorkspace(base(), local, remote);
  assert.deepEqual(state.clients.map(c => c.id).sort(), ['c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(state.activity.map(a => a.id).sort(), ['a1', 'a2', 'a3']);
  assert.equal(state.clients[0].id, 'c3', 'a record unshifted locally stays at the top');
  assert.equal(conflicts.length, 0);
});

test('a payment recorded here survives a status change made in the cloud on another document', () => {
  const b = base(); b.documents.push({ id: 'd2', type: 'Quotation', number: 'ED-Q-0001', status: 'Sent' });
  const local = JSON.parse(JSON.stringify(b)); local.documents[0].payments.push({ id: 'p1', amount: 500, date: '2026-11-12' });
  const remote = JSON.parse(JSON.stringify(b)); remote.documents[1].status = 'Accepted';
  const { state, conflicts } = mergeWorkspace(b, local, remote);
  assert.equal(state.documents.find(d => d.id === 'd1').payments.length, 1);
  assert.equal(state.documents.find(d => d.id === 'd2').status, 'Accepted');
  assert.equal(conflicts.length, 0);
});

test('the same record edited differently on both devices keeps the cloud copy and reports this device copy', () => {
  const local = base(); local.clients[0].name = 'Alpha Here';
  const remote = base(); remote.clients[0].name = 'Alpha Cloud';
  const { state, conflicts } = mergeWorkspace(base(), local, remote);
  assert.equal(state.clients[0].name, 'Alpha Cloud');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].collection, 'clients');
  assert.equal(conflicts[0].reason, 'edited-both');
  assert.equal(conflicts[0].local.name, 'Alpha Here');
});

test('a delete on one side applies when the other side did not touch the record', () => {
  const local = base(); local.clients = local.clients.filter(c => c.id !== 'c2');
  const { state, conflicts } = mergeWorkspace(base(), local, base());
  assert.deepEqual(state.clients.map(c => c.id), ['c1']);
  assert.equal(conflicts.length, 0);
});

test('a record edited here but deleted in the cloud goes to review instead of vanishing', () => {
  const local = base(); local.clients[1].name = 'Beta edited';
  const remote = base(); remote.clients = remote.clients.filter(c => c.id !== 'c2');
  const { state, conflicts } = mergeWorkspace(base(), local, remote);
  assert.deepEqual(state.clients.map(c => c.id), ['c1']);
  assert.equal(conflicts[0].reason, 'deleted-in-cloud');
  assert.equal(conflicts[0].local.name, 'Beta edited');
});

test('settings merge field by field', () => {
  const local = base(); local.settings.tax = 5;
  const remote = base(); remote.settings.name = 'Erics Designs Studio';
  const { state, conflicts } = mergeWorkspace(base(), local, remote);
  assert.equal(state.settings.tax, 5);
  assert.equal(state.settings.name, 'Erics Designs Studio');
  assert.equal(conflicts.length, 0);
});

test('a new document whose number the cloud already used goes to review', () => {
  const local = base(); local.documents.push({ id: 'd-local', type: 'Invoice', number: 'ED-0002', status: 'Draft' });
  const remote = base(); remote.documents.push({ id: 'd-cloud', type: 'Invoice', number: 'ED-0002', status: 'Draft' });
  const { state, conflicts } = mergeWorkspace(base(), local, remote);
  assert.deepEqual(state.documents.map(d => d.id), ['d1', 'd-cloud']);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].reason, 'number-taken');
  assert.equal(conflicts[0].local.id, 'd-local');
});

test('key order differences are not treated as edits', () => {
  assert.equal(stableStringify({ a: 1, b: { c: 2, d: 3 } }), stableStringify({ b: { d: 3, c: 2 }, a: 1 }));
  const local = base(); local.clients[0] = { name: 'Alpha', id: 'c1' };
  const remote = base(); remote.clients[0].name = 'Alpha Cloud';
  const { state, conflicts } = mergeWorkspace(base(), local, remote);
  assert.equal(state.clients[0].name, 'Alpha Cloud');
  assert.equal(conflicts.length, 0);
});

test('identical changes on both sides are not a conflict', () => {
  const local = base(); local.documents[0].status = 'Paid';
  const remote = base(); remote.documents[0].status = 'Paid';
  const { conflicts } = mergeWorkspace(base(), local, remote);
  assert.equal(conflicts.length, 0);
});
