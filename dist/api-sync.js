'use strict';

// Local development API. Change this URL when the API is deployed.
const ERP_API = window.ERP_API_URL || 'http://localhost:4000/api';
const ERP_WORKSPACE = 'erics-designs-default';
const ERP_TOKEN_KEY = 'erics-designs-erp-token';
let erpRevision = null;
let erpSyncTimer;
let erpOnline = false;
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
  if (document.getElementById('erp-auth')) return;
  api('/auth/status').then(({ setupRequired }) => {
    const dialog = document.createElement('dialog');
    dialog.id = 'erp-auth';
    dialog.className = 'client-form';
    dialog.innerHTML = `<div class="dialog-title"><h2>${setupRequired ? 'Set up ERP access' : 'Sign in to ERP'}</h2></div><p class="sub">${setupRequired ? 'Create the first administrator account for this local ERP.' : 'Enter your administrator account details to load MongoDB records.'}</p><form id="erp-auth-form"><div class="grid"><div class="full"><label for="erp-username">Username</label><input id="erp-username" autocomplete="username" required></div><div class="full"><label for="erp-password">Password</label><input id="erp-password" type="password" autocomplete="${setupRequired ? 'new-password' : 'current-password'}" minlength="10" required></div></div><p id="erp-auth-error" class="form-error" role="alert"></p><button class="primary" type="submit">${setupRequired ? 'Create administrator account' : 'Sign in'}</button></form>`;
    document.body.append(dialog);
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const username = dialog.querySelector('#erp-username').value.trim();
      const password = dialog.querySelector('#erp-password').value;
      const error = dialog.querySelector('#erp-auth-error');
      try {
        const result = await api(`/auth/${setupRequired ? 'setup' : 'login'}`, { method: 'POST', body: JSON.stringify({ username, password }) });
        erpToken = result.token;
        localStorage.setItem(ERP_TOKEN_KEY, erpToken);
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
  adminUsers: () => api('/admin/users'),
  createAdmin: (username, password) => api('/admin/users', { method: 'POST', body: JSON.stringify({ username, password }) }),
  draftAI: payload => api('/ai/draft', { method: 'POST', body: JSON.stringify(payload) })
};
window.erpAuth = { logout: () => { localStorage.removeItem(ERP_TOKEN_KEY); erpToken = ''; location.reload(); } };

async function pushWorkspace() {
  try {
    const result = await api(`/workspaces/${ERP_WORKSPACE}`, { method: 'PUT', body: JSON.stringify({ state: db, revision: erpRevision }) });
    erpRevision = result.revision;
    setErpStatus('MongoDB sync active', true);
  } catch (error) {
    if (error.status === 409 && error.data?.state) {
      erpRevision = error.data.revision;
      setErpStatus('Newer server data found. Reload to review it.', false);
      toast('A newer cloud version exists. Reload before making more changes.');
    } else setErpStatus('Changes remain saved on this browser', false);
  }
}

function scheduleWorkspaceSync() {
  clearTimeout(erpSyncTimer);
  erpSyncTimer = setTimeout(pushWorkspace, 350);
}

const localPersist = persist;
persist = function () {
  const saved = localPersist();
  if (saved) scheduleWorkspaceSync();
  return saved;
};

async function loadWorkspace() {
  if (!erpToken) {
    setErpStatus('Sign in to load MongoDB records', false);
    showAuth();
    return;
  }
  try {
    await api('/health');
    const remote = await api(`/workspaces/${ERP_WORKSPACE}`);
    db = migrate(remote.state);
    erpRevision = remote.revision;
    localStorage.setItem(KEY, JSON.stringify(db));
    lastSnapshot = localStorage.getItem(KEY);
    render();
    setErpStatus('MongoDB sync active', true);
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem(ERP_TOKEN_KEY);
      erpToken = '';
      setErpStatus('Sign in to continue', false);
      showAuth();
      return;
    }
    if (error.status === 404) {
      setErpStatus('Creating your MongoDB workspace…', true);
      await pushWorkspace();
    } else setErpStatus('Start the local API to enable sync', false);
  }
}

window.addEventListener('online', loadWorkspace);
loadWorkspace();
