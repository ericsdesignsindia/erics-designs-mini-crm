'use strict';

// Local development API. Change this URL when the API is deployed.
const ERP_API = window.ERP_API_URL || 'http://localhost:4000/api';
const ERP_WORKSPACE = 'erics-designs-default';
const ERP_TOKEN_KEY = 'erics-designs-erp-token';
const ERP_DIRTY_KEY = 'erics-designs-erp-unsynced';
const ERP_REVISION_KEY = 'erics-designs-erp-revision';
const savedRevision = localStorage.getItem(ERP_REVISION_KEY);
let erpRevision = /^\d+$/.test(savedRevision || '') ? Number(savedRevision) : null;
let erpSyncTimer;
let erpOnline = false;
let erpDirty = localStorage.getItem(ERP_DIRTY_KEY) === '1';
let erpConflict = false;
// A remembered device keeps only the expiring access token; the password is never stored by the CRM.
let erpToken = localStorage.getItem(ERP_TOKEN_KEY) || '';

function setErpStatus(text, online) {
  erpOnline = online;
  const footer = document.querySelector('aside footer');
  if (footer) footer.innerHTML = `${online ? 'Cloud sync connected' : 'Browser storage · Offline mode'}<br><small>${text}</small>`;
}

async function api(path, options = {}) {
  const auth = erpToken ? { Authorization: `Bearer ${erpToken}` } : {};
  const response = await fetch(`${ERP_API}${path}`, { headers: { 'Content-Type': 'application/json', ...auth, ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'ERP API request failed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function showAuth() {
  const nav = document.getElementById('nav');
  const app = document.getElementById('app');
  const commandBar = document.getElementById('commandBar');
  const mobileNav = document.getElementById('mobileNav');
  if (commandBar) commandBar.innerHTML = '';
  if (mobileNav) mobileNav.innerHTML = '';
  if (nav) nav.innerHTML = '';
  if (app) app.innerHTML = '<section class="panel empty"><h2>Secure CRM access</h2><p>Please sign in with an administrator account to view client, quotation, and invoice records.</p></section>';
  if (document.getElementById('erp-auth')) return;
  api('/auth/status').then(({ setupRequired }) => {
    const dialog = document.createElement('dialog');
    dialog.id = 'erp-auth';
    dialog.className = 'client-form';
    dialog.innerHTML = `<div class="dialog-title"><h2>${setupRequired ? 'Set up ERP access' : 'Log in to CRM'}</h2></div><p class="sub">${setupRequired ? 'Create the first administrator account for this local ERP.' : 'Enter your administrator account details to load MongoDB records.'}</p><form id="erp-auth-form"><div class="grid"><div class="full"><label for="erp-username">Username</label><input id="erp-username" autocomplete="username" required></div><div class="full"><label for="erp-password">Password</label><input id="erp-password" type="password" autocomplete="${setupRequired ? 'new-password' : 'current-password'}" minlength="10" required></div><label class="erp-remember full"><input id="erp-remember" type="checkbox" ${localStorage.getItem(ERP_TOKEN_KEY)?'checked':''}> Remember this device for up to 7 days</label></div><p class="hint">Your password is never saved by the CRM.</p><p id="erp-auth-error" class="form-error" role="alert"></p><button class="primary" type="submit">${setupRequired ? 'Create administrator account' : 'Log in'}</button></form>`;
    document.body.append(dialog);
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const username = dialog.querySelector('#erp-username').value.trim();
      const password = dialog.querySelector('#erp-password').value;
      const remember = dialog.querySelector('#erp-remember').checked;
      const error = dialog.querySelector('#erp-auth-error');
      try {
        const result = await api(`/auth/${setupRequired ? 'setup' : 'login'}`, { method: 'POST', body: JSON.stringify({ username, password }) });
        erpToken = result.token;
        if (remember) localStorage.setItem(ERP_TOKEN_KEY, erpToken); else localStorage.removeItem(ERP_TOKEN_KEY);
        dialog.close(); dialog.remove();
        loadWorkspace();
      } catch (requestError) { error.textContent = requestError.message; }
    };
    dialog.showModal();
  }).catch(() => setErpStatus('Start the local API to enable sign-in', false));
}

// Reusable frontend API client for future screens and integrations.
window.erpApi = {
  health: () => api('/health'),
  overview: () => api(`/workspaces/${ERP_WORKSPACE}/overview`),
  list: resource => api(`/workspaces/${ERP_WORKSPACE}/${resource}`),
  get: (resource, id) => api(`/workspaces/${ERP_WORKSPACE}/${resource}/${id}`),
  create: (resource, record) => api(`/workspaces/${ERP_WORKSPACE}/${resource}`, { method: 'POST', body: JSON.stringify({ record }) }),
  update: (resource, id, record) => api(`/workspaces/${ERP_WORKSPACE}/${resource}/${id}`, { method: 'PUT', body: JSON.stringify({ record }) }),
  remove: (resource, id) => api(`/workspaces/${ERP_WORKSPACE}/${resource}/${id}`, { method: 'DELETE' }),
  getSettings: () => api(`/workspaces/${ERP_WORKSPACE}/settings`),
  updateSettings: settings => api(`/workspaces/${ERP_WORKSPACE}/settings`, { method: 'PUT', body: JSON.stringify({ settings }) }),
  adminMe: () => api('/admin/me'),
  adminUsers: () => api('/admin/users'),
  createAdmin: (username, password) => api('/admin/users', { method: 'POST', body: JSON.stringify({ username, password }) }),
  resetAdminPassword: (userId, password) => api(`/admin/users/${userId}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  draftAI: payload => api('/ai/draft', { method: 'POST', body: JSON.stringify(payload) }),
  aiStatus: () => api('/integrations/ai/status'),
  metaLeadStatus: () => api('/integrations/meta-leads/status'),
  whatsappStatus: () => api('/integrations/whatsapp/status'),
  sendInvoiceWhatsApp: payload => api('/integrations/whatsapp/send-invoice', { method: 'POST', body: JSON.stringify(payload) }),
  sendDocumentWhatsApp: payload => api('/integrations/whatsapp/send-document', { method: 'POST', body: JSON.stringify(payload) }),
  sendDocumentEmail: payload => api('/integrations/gmail/send-document', { method: 'POST', body: JSON.stringify(payload) }),
  subscribeMetaLeadPage: () => api('/integrations/meta-leads/subscribe-page', { method: 'POST' }),
  gmailStatus: () => api('/integrations/gmail/status'),
  gmailMessages: () => api('/integrations/gmail/messages'),
  gmailMessage: id => api(`/integrations/gmail/messages/${encodeURIComponent(id)}`),
  connectGmail: () => api('/integrations/gmail/connect', { method: 'POST' }),
  disconnectGmail: () => api('/integrations/gmail', { method: 'DELETE' }),
  googleDriveStatus: () => api('/integrations/google-drive/status'),
  backups: () => api(`/workspaces/${ERP_WORKSPACE}/backups`),
  restoreBackup: id => api(`/workspaces/${ERP_WORKSPACE}/backups/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  uploadDriveAttachment: payload => api('/integrations/google-drive/attachments', { method: 'POST', body: JSON.stringify(payload) }),
  connectGoogleDrive: () => api('/integrations/google-drive/connect', { method: 'POST' }),
  disconnectGoogleDrive: () => api('/integrations/google-drive', { method: 'DELETE' })
};
window.erpAuth = { logout: () => { erpToken = ''; localStorage.removeItem(ERP_TOKEN_KEY); location.reload(); }, login: () => { erpToken = ''; showAuth(); } };

function rememberRevision() { if (Number.isInteger(erpRevision)) localStorage.setItem(ERP_REVISION_KEY, String(erpRevision)); }
function markUnsynced() { erpDirty = true; localStorage.setItem(ERP_DIRTY_KEY, '1'); }
function markSynced() { erpDirty = false; erpConflict = false; localStorage.removeItem(ERP_DIRTY_KEY); rememberRevision(); }

async function pushWorkspace() {
  if (erpConflict) return false;
  try {
    const result = await api(`/workspaces/${ERP_WORKSPACE}`, { method: 'PUT', body: JSON.stringify({ state: db, revision: Number.isInteger(erpRevision) ? erpRevision : 0 }) });
    erpRevision = result.revision;
    markSynced();
    setErpStatus('MongoDB sync active', true);
    return true;
  } catch (error) {
    if (error.status === 409 && error.data?.state) {
      erpConflict = true;
      setErpStatus('Cloud changes need review. Your browser data is protected.', false);
      toast('Cloud changes were found. Your local work was kept safely and was not overwritten.');
    } else setErpStatus('Changes remain saved on this browser', false);
    return false;
  }
}

function scheduleWorkspaceSync() {
  clearTimeout(erpSyncTimer);
  erpSyncTimer = setTimeout(pushWorkspace, 350);
}

const localPersist = persist;
persist = function () {
  const saved = localPersist();
  if (saved) { markUnsynced(); scheduleWorkspaceSync(); }
  return saved;
};

async function loadWorkspace() {
  if (!erpToken) {
    setErpStatus('Log in to load MongoDB records', false);
    showAuth();
    return;
  }
  try {
    await api('/health');
    let remote = await api(`/workspaces/${ERP_WORKSPACE}`);
    if (erpDirty) {
      erpRevision = Number.isInteger(erpRevision) ? erpRevision : Number(localStorage.getItem(ERP_REVISION_KEY));
      if (!Number.isInteger(erpRevision)) erpRevision = remote.revision;
      if (!await pushWorkspace()) return;
      remote = await api(`/workspaces/${ERP_WORKSPACE}`);
    }
    db = migrate(remote.state);
    erpRevision = remote.revision;
    markSynced();
    localStorage.setItem(KEY, JSON.stringify(db));
    lastSnapshot = localStorage.getItem(KEY);
    render();
    setErpStatus('MongoDB sync active', true);
    startWorkspaceAutoRefresh();
  } catch (error) {
    if (error.status === 401) {
      erpToken = '';
      localStorage.removeItem(ERP_TOKEN_KEY);
      setErpStatus('Log in to continue', false);
      showAuth();
      return;
    }
    if (error.status === 404) {
      setErpStatus('Creating your MongoDB workspace…', true);
      erpRevision = 0;
      await pushWorkspace();
    } else setErpStatus('Start the local API to enable sync', false);
  }
}

window.addEventListener('online', () => erpDirty ? pushWorkspace() : loadWorkspace());
loadWorkspace();

// Keep cloud data current without interrupting record editing.
const ERP_AUTO_REFRESH_MS = 45 * 1000;
let erpAutoRefreshTimer;
let erpRefreshInFlight = false;

async function refreshWorkspaceIfChanged(force = false) {
  if (!erpToken || erpRefreshInFlight || (!force && document.hidden) || recordDraft || erpDirty || erpConflict) return false;
  erpRefreshInFlight = true;
  try {
    const remote = await api(`/workspaces/${ERP_WORKSPACE}`);
    if (remote.revision !== erpRevision) {
      db = migrate(remote.state);
      erpRevision = remote.revision;
      localStorage.setItem(KEY, JSON.stringify(db));
      lastSnapshot = localStorage.getItem(KEY);
      render();
      setErpStatus('MongoDB sync active · updated just now', true);
      toast('CRM updated with the latest cloud data.');
      return true;
    } else {
      setErpStatus('MongoDB sync active · checked just now', true);
      return false;
    }
  } catch (error) {
    if (error.status === 401) {
      erpToken = '';
      localStorage.removeItem(ERP_TOKEN_KEY);
      setErpStatus('Log in to continue', false);
      showAuth();
    }
  } finally {
    erpRefreshInFlight = false;
  }
}

async function syncWorkspaceNow() {
  if (!erpToken) { showAuth(); return false; }
  if (erpConflict) { toast('Cloud changes need review before this device can sync.'); return false; }
  if (erpDirty && !await pushWorkspace()) return false;
  return refreshWorkspaceIfChanged(true);
}
window.syncCRMNow = syncWorkspaceNow;

function startWorkspaceAutoRefresh() {
  clearInterval(erpAutoRefreshTimer);
  erpAutoRefreshTimer = setInterval(refreshWorkspaceIfChanged, ERP_AUTO_REFRESH_MS);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshWorkspaceIfChanged();
});



// Notify CRM extensions after a cloud workspace has loaded.
const erpWorkspaceLoaded = loadWorkspace;
loadWorkspace = async function () {
  const result = await erpWorkspaceLoaded();
  if (erpToken && db) document.dispatchEvent(new Event('erp-workspace-loaded'));
  return result;
};
