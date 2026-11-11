const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('CRM auto-refresh checks cloud revisions and protects active edits', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api-sync.js'), 'utf8');
  const storage = new Map([['erics-designs-erp-token', 'test-token']]);
  const sessionStore = new Map();
  const requests = [];
  const toasts = [];
  const intervals = [];
  const handlers = {};
  const footer = { innerHTML: '' };
  let remote = { revision: 1, state: { records: ['initial'] } };
  let renders = 0;

  const context = {
    window: { ERP_API_URL: 'https://crm.test/api', addEventListener() {} },
    document: {
      hidden: false,
      querySelector: () => footer,
      getElementById: () => null,
      addEventListener: (name, handler) => { handlers[name] = handler; },
      dispatchEvent: () => true
    },
    Event: class { constructor(type) { this.type = type; } },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    // api-sync.js also reads a short-lived login handoff from sessionStorage.
    sessionStorage: {
      getItem: key => sessionStore.get(key) ?? null,
      setItem: (key, value) => sessionStore.set(key, String(value)),
      removeItem: key => sessionStore.delete(key)
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return { ok: true, status: 200, json: async () => structuredClone(remote) };
    },
    migrate: state => structuredClone(state),
    db: {},
    KEY: 'crm-db',
    persist: () => true,
    lastSnapshot: null,
    recordDraft: null,
    render: () => { renders += 1; },
    toast: message => toasts.push(message),
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: (handler, delay) => { intervals.push({ handler, delay }); return intervals.length; },
    clearInterval() {},
    Date,
    Number,
    String,
    JSON,
    Promise,
    Math,
    Error,
    structuredClone
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'api-sync.js' });
  await new Promise(resolve => setImmediate(resolve));

  // api-sync.js also schedules a separate release check, so look for the 30-second workspace refresh.
  assert.equal(intervals.filter(item => item.delay === 30_000).length, 1);
  assert.match(footer.innerHTML, /auto-refresh every 30 seconds/i);
  assert.equal(renders, 1);

  remote = { revision: 2, state: { records: ['updated'] } };
  assert.equal(await context.window.refreshWorkspaceIfChanged(), true);
  assert.deepEqual(vm.runInContext('db.records', context), ['updated']);
  assert.equal(renders, 2);
  assert.ok(toasts.includes('CRM refreshed with the latest cloud data.'));

  const workspaceRequests = () => requests.filter(request => request.url.endsWith('/workspaces/erics-designs-default')).length;
  const beforeGuardChecks = workspaceRequests();
  vm.runInContext('recordDraft = { id: "editing" }', context);
  assert.equal(await context.window.refreshWorkspaceIfChanged(), false);
  vm.runInContext('recordDraft = null; erpDirty = true', context);
  assert.equal(await context.window.refreshWorkspaceIfChanged(), false);
  vm.runInContext('erpDirty = false', context);
  context.document.hidden = true;
  assert.equal(await context.window.refreshWorkspaceIfChanged(), false);
  assert.equal(workspaceRequests(), beforeGuardChecks);

  context.document.hidden = false;
  remote = { revision: 3, state: { records: ['visible-tab-update'] } };
  handlers.visibilitychange();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(vm.runInContext('db.records', context), ['visible-tab-update']);
});
