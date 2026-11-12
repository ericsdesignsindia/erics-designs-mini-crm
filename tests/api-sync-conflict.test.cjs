'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Runs api-sync.js against a fake API that enforces revisions like server.js:
// a PUT with a stale revision gets 409 plus the current cloud workspace.
function createCrm(initialState) {
  const storage = new Map([['erics-designs-erp-token', 'test-token']]);
  const server = { revision: 1, state: structuredClone(initialState), puts: 0 };
  const toasts = [];
  const context = {
    window: { ERP_API_URL: 'https://crm.test/api', addEventListener() {} },
    document: { hidden: false, querySelector: () => ({ innerHTML: '' }), getElementById: () => null, addEventListener() {}, dispatchEvent: () => true },
    Event: class { constructor(type) { this.type = type; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (url, options = {}) => {
      const reply = (status, body) => ({ ok: status < 400, status, json: async () => structuredClone(body) });
      if (url.endsWith('/health')) return reply(200, { ok: true });
      if (url.endsWith('/admin/me')) return reply(200, { username: 'owner', role: 'owner' });
      if (url.endsWith('/workspaces/erics-designs-default') && options.method === 'PUT') {
        const body = JSON.parse(options.body);
        if (body.revision !== server.revision) return reply(409, { error: 'A newer workspace version exists.', revision: server.revision, state: server.state });
        server.state = body.state; server.revision += 1; server.puts += 1;
        return reply(200, { ok: true, revision: server.revision });
      }
      if (url.endsWith('/workspaces/erics-designs-default')) return reply(200, { revision: server.revision, state: server.state });
      return reply(200, {});
    },
    migrate: state => structuredClone(state),
    db: {}, KEY: 'crm-db', persist: () => true, lastSnapshot: null, recordDraft: null,
    render() {}, toast: message => toasts.push(message), confirm: () => true,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    Date, Number, String, JSON, Promise, Math, Error, Array, Object, Map, Set, structuredClone
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sync-merge.js'), 'utf8'), context, { filename: 'sync-merge.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'api-sync.js'), 'utf8'), context, { filename: 'api-sync.js' });
  const run = code => vm.runInContext(code, context);
  // Another device saves straight to the cloud.
  const otherDeviceSaves = mutate => { const next = structuredClone(server.state); mutate(next); server.state = next; server.revision += 1; };
  return { server, storage, toasts, run, otherDeviceSaves, context };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const start = () => ({ settings: { name: "Eric's Designs" }, clients: [{ id: 'c1', name: 'Alpha' }, { id: 'c2', name: 'Beta' }], documents: [] });

test('a save that clashes with another device merges both sets of changes instead of stalling', async () => {
  const crm = createCrm(start());
  await settle();
  crm.otherDeviceSaves(state => { state.clients[1].name = 'Beta Cloud'; state.clients.push({ id: 'c3', name: 'Gamma' }); });
  crm.run("db.clients[0].name = 'Alpha Here'; erpDirty = true");
  assert.equal(await crm.run('pushWorkspace()'), true);
  assert.deepEqual(crm.server.state.clients.map(c => c.name), ['Alpha Here', 'Beta Cloud', 'Gamma']);
  assert.equal(crm.run('erpConflict'), false, 'sync keeps working after the clash');
  assert.equal(crm.storage.get('erics-designs-erp-sync-review'), undefined, 'nothing needed review');
});

test('the same record changed on both devices keeps the cloud copy and offers this device copy for review', async () => {
  const crm = createCrm(start());
  await settle();
  crm.otherDeviceSaves(state => { state.clients[1].name = 'Beta Cloud'; });
  crm.run("db.clients[1].name = 'Beta Here'; erpDirty = true");
  assert.equal(await crm.run('pushWorkspace()'), true);
  assert.equal(crm.server.state.clients[1].name, 'Beta Cloud');
  const review = JSON.parse(crm.storage.get('erics-designs-erp-sync-review'));
  assert.equal(review.length, 1);
  assert.equal(review[0].local.name, 'Beta Here');

  // Choosing this device's version applies it and syncs it.
  crm.run("window.resolveSyncReview(0, 'mine')");
  assert.equal(crm.run('db.clients[1].name'), 'Beta Here');
  assert.equal(crm.storage.get('erics-designs-erp-sync-review'), undefined);
  assert.equal(await crm.run('pushWorkspace()'), true);
  assert.equal(crm.server.state.clients[1].name, 'Beta Here');
});

test('edits made while a save is in flight stay unsynced and are pushed next', async () => {
  const crm = createCrm(start());
  await settle();
  const fetch = crm.context.fetch;
  crm.context.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') crm.run("db.clients[0].name = 'Typed during save'");
    return fetch(url, options);
  };
  crm.run("db.clients[1].name = 'Beta edited'; erpDirty = true");
  assert.equal(await crm.run('pushWorkspace()'), true);
  assert.equal(crm.server.state.clients[0].name, 'Alpha', 'the in-flight request carried the earlier snapshot');
  assert.equal(crm.run('erpDirty'), true, 'the later edit is still marked unsynced');
  crm.context.fetch = fetch;
  assert.equal(await crm.run('pushWorkspace()'), true);
  assert.equal(crm.server.state.clients[0].name, 'Typed during save');
  assert.equal(crm.run('erpDirty'), false);
});

test('without a saved sync base the device keeps a full recovery copy that review can show', async () => {
  const crm = createCrm(start());
  await settle();
  crm.storage.delete('erics-designs-erp-sync-base');
  crm.otherDeviceSaves(state => { state.clients[0].name = 'Alpha Cloud'; });
  crm.run("db.clients[0].name = 'Alpha Here'; erpDirty = true");
  assert.equal(await crm.run('pushWorkspace()'), false);
  assert.equal(crm.run('db.clients[0].name'), 'Alpha Cloud', 'the cloud workspace is loaded');
  const recovery = JSON.parse(crm.storage.get('erics-designs-erp-local-recovery'));
  assert.equal(recovery.state.clients[0].name, 'Alpha Here', 'this device copy is kept');
  assert.equal(crm.run('erpConflict'), false, 'sync is not left stuck');
});
