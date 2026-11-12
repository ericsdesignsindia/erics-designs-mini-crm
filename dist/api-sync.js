'use strict';

// Local development API. Change this URL when the API is deployed.
const ERP_API = window.ERP_API_URL || 'http://localhost:4000/api';
const ERP_WORKSPACE = 'erics-designs-default';
const ERP_TOKEN_KEY = 'erics-designs-erp-token';
const ERP_DIRTY_KEY = 'erics-designs-erp-unsynced';
const ERP_REVISION_KEY = 'erics-designs-erp-revision';
const ERP_RECOVERY_KEY = 'erics-designs-erp-local-recovery';
// The workspace exactly as this device last synced it: the common ancestor for merges.
const ERP_BASE_KEY = 'erics-designs-erp-sync-base';
// This device's versions of records that were also changed in the cloud, kept for review.
const ERP_REVIEW_KEY = 'erics-designs-erp-sync-review';
const savedRevision = localStorage.getItem(ERP_REVISION_KEY);
let erpRevision = /^\d+$/.test(savedRevision || '') ? Number(savedRevision) : null;
let erpSyncTimer;
let erpRetryTimer;
let erpOnline = false;
let erpDirty = localStorage.getItem(ERP_DIRTY_KEY) === '1';
let erpConflict = false;
window.crmCurrentUser = null;
// A remembered device keeps only the expiring access token; the password is never stored by the CRM.
let erpToken = localStorage.getItem(ERP_TOKEN_KEY) || sessionStorage.getItem(ERP_TOKEN_KEY) || '';
// A short-lived sessionStorage handoff keeps a remembered or current login
// alive when an automatically detected release reloads this tab.
sessionStorage.removeItem(ERP_TOKEN_KEY);

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
  metaAdsStatus: () => api('/integrations/meta-ads/status'),
  connectMetaAds: () => api('/integrations/meta-ads/connect', { method: 'POST' }),
  syncMetaAds: () => api('/integrations/meta-ads/sync', { method: 'POST' }),
  disconnectMetaAds: () => api('/integrations/meta-ads', { method: 'DELETE' }),
  whatsappStatus: () => api('/integrations/whatsapp/status'),
  sendInvoiceWhatsApp: payload => api('/integrations/whatsapp/send-invoice', { method: 'POST', body: JSON.stringify(payload) }),
  sendDocumentWhatsApp: payload => api('/integrations/whatsapp/send-document', { method: 'POST', body: JSON.stringify(payload) }),
  sendDocumentEmail: payload => api('/integrations/gmail/send-document', { method: 'POST', body: JSON.stringify(payload) }),
  subscribeMetaLeadPage: () => api('/integrations/meta-leads/subscribe-page', { method: 'POST' }),
  importExistingMetaLead: leadId => api('/integrations/meta-leads/import-existing', { method: 'POST', body: JSON.stringify({ leadId }) }),
  gmailStatus: () => api('/integrations/gmail/status'),
  gmailMessages: () => api('/integrations/gmail/messages'),
  gmailMessage: id => api(`/integrations/gmail/messages/${encodeURIComponent(id)}`),
  connectGmail: () => api('/integrations/gmail/connect', { method: 'POST' }),
  disconnectGmail: () => api('/integrations/gmail', { method: 'DELETE' }),
  googleDriveStatus: () => api('/integrations/google-drive/status'),
  backups: () => api(`/workspaces/${ERP_WORKSPACE}/backups`),
  findBackupDocument: number => api(`/workspaces/${ERP_WORKSPACE}/backups/documents/${encodeURIComponent(number)}`),
  restoreBackupDocument: (backupId, number) => api(`/workspaces/${ERP_WORKSPACE}/backups/${encodeURIComponent(backupId)}/documents/${encodeURIComponent(number)}/restore`, { method: 'POST' }),
  restoreBackup: id => api(`/workspaces/${ERP_WORKSPACE}/backups/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  uploadDriveAttachment: payload => api('/integrations/google-drive/attachments', { method: 'POST', body: JSON.stringify(payload) }),
  uploadSignedContract: (contractId, payload) => api(`/workspaces/${ERP_WORKSPACE}/contracts/${encodeURIComponent(contractId)}/files`, { method: 'POST', body: JSON.stringify(payload) }),
  analyzeSignedContract: (contractId, fileId) => api(`/workspaces/${ERP_WORKSPACE}/contracts/${encodeURIComponent(contractId)}/files/${encodeURIComponent(fileId)}`),
  downloadSignedContract: async (contractId, fileId) => {
    const auth = erpToken ? { Authorization: `Bearer ${erpToken}` } : {};
    const response = await fetch(`${ERP_API}/workspaces/${ERP_WORKSPACE}/contracts/${encodeURIComponent(contractId)}/files/${encodeURIComponent(fileId)}?download=1`, { headers: auth });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Could not download the signed contract.'); }
    return response.blob();
  },
  connectGoogleDrive: () => api('/integrations/google-drive/connect', { method: 'POST' }),
  disconnectGoogleDrive: () => api('/integrations/google-drive', { method: 'DELETE' })
};
window.erpAuth = { logout: () => { erpToken = ''; localStorage.removeItem(ERP_TOKEN_KEY); sessionStorage.removeItem(ERP_TOKEN_KEY); location.reload(); }, login: () => { erpToken = ''; showAuth(); } };

function rememberRevision() { if (Number.isInteger(erpRevision)) localStorage.setItem(ERP_REVISION_KEY, String(erpRevision)); }
function scheduleSyncRetry() {
  clearTimeout(erpRetryTimer);
  if (!erpToken || !erpDirty || erpConflict) return;
  erpRetryTimer = setTimeout(() => pushWorkspace(), 20 * 1000);
}
function markUnsynced() { erpDirty = true; localStorage.setItem(ERP_DIRTY_KEY, '1'); scheduleSyncRetry(); }
function markSynced() { erpDirty = false; erpConflict = false; clearTimeout(erpRetryTimer); localStorage.removeItem(ERP_DIRTY_KEY); rememberRevision(); applyCRMReleaseWhenSafe?.(); }

function saveSyncBase(stateText) {
  try { localStorage.setItem(ERP_BASE_KEY, typeof stateText === 'string' ? stateText : JSON.stringify(stateText)); } catch (_) { localStorage.removeItem(ERP_BASE_KEY); }
}
function readSyncBase() {
  try { const text = localStorage.getItem(ERP_BASE_KEY); return text ? JSON.parse(text) : null; } catch (_) { return null; }
}
function pendingSyncReview() {
  try { const list = JSON.parse(localStorage.getItem(ERP_REVIEW_KEY) || '[]'); return Array.isArray(list) ? list : []; } catch (_) { return []; }
}
function savePendingSyncReview(list) {
  if (list.length) localStorage.setItem(ERP_REVIEW_KEY, JSON.stringify(list)); else localStorage.removeItem(ERP_REVIEW_KEY);
  updateSyncReviewBanner();
}

// Merge this device's unsynced edits onto a newer cloud workspace. Returns false
// when there is no common ancestor (an older session), so the caller falls back
// to keeping a full recovery copy.
function mergeIntoCloud(remoteState, remoteRevision) {
  const base = readSyncBase();
  if (!base || !window.crmSyncMerge || typeof migrate !== 'function') return false;
  const remote = migrate(JSON.parse(JSON.stringify(remoteState)));
  const { state, conflicts } = window.crmSyncMerge.mergeWorkspace(base, db, remote);
  db = migrate(state);
  erpRevision = remoteRevision;
  rememberRevision();
  saveSyncBase(remote);
  localStorage.setItem(KEY, JSON.stringify(db));
  lastSnapshot = localStorage.getItem(KEY);
  if (conflicts.length) {
    const savedAt = new Date().toISOString();
    savePendingSyncReview([...pendingSyncReview(), ...conflicts.map(item => ({ ...item, savedAt }))]);
  }
  if (typeof render === 'function') render();
  if (typeof toast === 'function') toast(conflicts.length
    ? `Merged with cloud changes. ${conflicts.length} item${conflicts.length === 1 ? '' : 's'} changed on both devices need${conflicts.length === 1 ? 's' : ''} your review.`
    : 'Merged your changes with newer cloud changes.');
  return true;
}

function keepRecoveryCopy(revision) {
  localStorage.setItem(ERP_RECOVERY_KEY, JSON.stringify({ savedAt: new Date().toISOString(), revision: Number.isInteger(revision) ? revision : null, state: db }));
  updateSyncReviewBanner();
}

let erpMergeAttempts = 0;
async function pushWorkspace() {
  if (erpConflict) return false;
  // Snapshot what is sent: edits made while the request is in flight must stay unsynced.
  const sent = JSON.stringify(db);
  try {
    const result = await api(`/workspaces/${ERP_WORKSPACE}`, { method: 'PUT', body: JSON.stringify({ state: JSON.parse(sent), revision: Number.isInteger(erpRevision) ? erpRevision : 0 }) });
    erpRevision = result.revision;
    erpMergeAttempts = 0;
    saveSyncBase(sent);
    if (JSON.stringify(db) !== sent) { rememberRevision(); scheduleWorkspaceSync(); return true; }
    markSynced();
    setErpStatus(`MongoDB sync active · auto-refresh every ${ERP_AUTO_REFRESH_SECONDS} seconds`, true);
    return true;
  } catch (error) {
    if (error.status === 409 && error.data?.state) {
      // Another device saved first. Merge record by record and try again.
      if (erpMergeAttempts < 3 && mergeIntoCloud(error.data.state, error.data.revision)) {
        erpMergeAttempts += 1;
        return pushWorkspace();
      }
      erpMergeAttempts = 0;
      // No merge possible: keep a full copy of this device's data, then load the cloud.
      keepRecoveryCopy(erpRevision);
      db = migrate(error.data.state);
      erpRevision = error.data.revision;
      saveSyncBase(db);
      markSynced();
      localStorage.setItem(KEY, JSON.stringify(db));
      lastSnapshot = localStorage.getItem(KEY);
      if (typeof render === 'function') render();
      setErpStatus('Cloud workspace loaded · your unsynced copy is kept for review', true);
      toast('Cloud changes were found. A copy of this device\'s unsynced work is kept under "Sync review".');
    } else { setErpStatus('Saving retry queued · your changes are safe on this device', false); scheduleSyncRetry(); }
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
    try {
      window.crmCurrentUser = await api('/admin/me');
    } catch (identityError) {
      if (identityError.status === 401) throw identityError;
      window.crmCurrentUser = null;
    }
    let remote = await api(`/workspaces/${ERP_WORKSPACE}`);
    if (erpDirty) {
      const localRevision = Number.isInteger(erpRevision) ? erpRevision : Number(localStorage.getItem(ERP_REVISION_KEY));
      // A new device must never replace the shared workspace with its browser cache.
      // Only upload pending edits when they started from the exact cloud revision.
      if (Number.isInteger(localRevision) && localRevision === remote.revision) {
        if (!await pushWorkspace()) return;
        remote = await api(`/workspaces/${ERP_WORKSPACE}`);
      } else if (mergeIntoCloud(remote.state, remote.revision)) {
        // Unsynced edits from an earlier session were merged onto the newer cloud copy.
        if (await pushWorkspace()) remote = await api(`/workspaces/${ERP_WORKSPACE}`);
        else return;
      } else {
        keepRecoveryCopy(localRevision);
        erpDirty = false;
        erpConflict = false;
        localStorage.removeItem(ERP_DIRTY_KEY);
        toast('Loaded the shared cloud workspace. A copy of this device\'s unsynced work is kept under "Sync review".');
      }
    }
    db = migrate(remote.state);
    erpRevision = remote.revision;
    saveSyncBase(db);
    markSynced();
    localStorage.setItem(KEY, JSON.stringify(db));
    lastSnapshot = localStorage.getItem(KEY);
    render();
    setErpStatus(`MongoDB sync active · auto-refresh every ${ERP_AUTO_REFRESH_SECONDS} seconds`, true);
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

// Keep cloud data current without interrupting record editing.
const ERP_AUTO_REFRESH_SECONDS = 30;
const ERP_AUTO_REFRESH_MS = ERP_AUTO_REFRESH_SECONDS * 1000;
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
      saveSyncBase(db);
      rememberRevision();
      localStorage.setItem(KEY, JSON.stringify(db));
      lastSnapshot = localStorage.getItem(KEY);
      render();
      document.dispatchEvent(new Event('erp-workspace-loaded'));
      setErpStatus(`Cloud data refreshed just now · next check in ${ERP_AUTO_REFRESH_SECONDS} seconds`, true);
      toast('CRM refreshed with the latest cloud data.');
      return true;
    } else {
      setErpStatus(`Auto-refresh checked just now · next check in ${ERP_AUTO_REFRESH_SECONDS} seconds`, true);
      return false;
    }
  } catch (error) {
    if (error.status === 401) {
      erpToken = '';
      localStorage.removeItem(ERP_TOKEN_KEY);
      setErpStatus('Log in to continue', false);
      showAuth();
    } else setErpStatus('Cloud refresh unavailable · retrying automatically', erpOnline);
  } finally {
    erpRefreshInFlight = false;
  }
}
window.refreshWorkspaceIfChanged = refreshWorkspaceIfChanged;

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
  if (!document.hidden) {
    refreshWorkspaceIfChanged();
    checkForCRMRelease();
  }
});

// The cloud workspace timer above refreshes records. This separate, lightweight
// check detects newly deployed app code and refreshes this tab once it is safe.
const CRM_RELEASE_CHECK_MS = 15 * 1000;
let crmReleaseId = '';
let crmReleasePending = false;
let crmReleaseNoticeShown = false;
let crmReleaseCheckInFlight = false;

async function checkForCRMRelease() {
  if (crmReleaseCheckInFlight || document.hidden) return;
  crmReleaseCheckInFlight = true;
  try {
    const response = await fetch(`./crm-build.json?check=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) return;
    const release = await response.json();
    if (!release.id) return;
    if (!crmReleaseId) {
      crmReleaseId = release.id;
      return;
    }
    if (release.id !== crmReleaseId) {
      crmReleasePending = true;
      applyCRMReleaseWhenSafe();
    }
  } catch (_) {
    // Temporary network failures should not interrupt CRM work.
  } finally {
    crmReleaseCheckInFlight = false;
  }
}

function applyCRMReleaseWhenSafe() {
  if (!crmReleasePending || document.hidden) return;
  const editing = typeof recordDraft !== 'undefined' && !!recordDraft;
  const modalOpen = !!document.querySelector('dialog[open]');
  if (editing || modalOpen || erpDirty || erpConflict) {
    if (!crmReleaseNoticeShown) {
      if (typeof toast === 'function') toast('A CRM update is ready. Save or close your current work to apply it.');
      crmReleaseNoticeShown = true;
    }
    return;
  }
  if (erpToken) sessionStorage.setItem(ERP_TOKEN_KEY, erpToken);
  location.reload();
}

setInterval(checkForCRMRelease, CRM_RELEASE_CHECK_MS);
document.addEventListener('DOMContentLoaded', checkForCRMRelease, { once: true });
document.addEventListener('erp-workspace-loaded', applyCRMReleaseWhenSafe);
document.addEventListener('close', applyCRMReleaseWhenSafe, true);
window.addEventListener('focus', () => {
  checkForCRMRelease();
  applyCRMReleaseWhenSafe();
});



// Sync review: items this device changed that were also changed in the cloud,
// plus any full recovery copy kept when a merge was not possible.
const SYNC_COLLECTION_LABELS = { documents: 'Document', clients: 'Client', projects: 'Project', tasks: 'Follow-up', accounts: 'Account entry', vendorBills: 'Vendor bill', recurringExpenses: 'Recurring expense', contracts: 'Contract', employees: 'Team member', services: 'Service', settings: 'Setting', activity: 'Activity', milestones: 'Milestone', followUps: 'Follow-up' };
const SYNC_REASONS = {
  'edited-both': 'Changed on this device and in the cloud',
  'deleted-in-cloud': 'Deleted in the cloud, edited on this device',
  'deleted-here': 'Deleted on this device, edited in the cloud',
  'number-taken': 'Created on this device, but another device used the same number'
};
const syncEscape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function readRecoveryCopy() {
  try { return JSON.parse(localStorage.getItem(ERP_RECOVERY_KEY) || 'null'); } catch (_) { return null; }
}

function updateSyncReviewBanner() {
  if (!document.body) return;
  const count = pendingSyncReview().length + (readRecoveryCopy() ? 1 : 0);
  let button = document.getElementById('syncReviewButton');
  if (!count) { button?.remove(); return; }
  if (!button) {
    button = document.createElement('button');
    button.id = 'syncReviewButton';
    button.type = 'button';
    button.className = 'sync-review-button';
    button.onclick = openSyncReview;
    document.body.append(button);
  }
  button.textContent = `Sync review · ${count}`;
  button.setAttribute('aria-label', `${count} sync item${count === 1 ? '' : 's'} need review`);
}

function nextSyncDocumentNumber(type) {
  const prefix = type === 'Quotation' ? 'ED-Q-' : type === 'Proforma' ? 'ED-P-' : 'ED-';
  const used = (db.documents || []).filter(doc => doc.type === type).map(doc => Number(String(doc.number || '').slice(prefix.length)) || 0);
  return prefix + String(Math.max(0, ...used) + 1).padStart(4, '0');
}

function applyLocalSyncVersion(item) {
  const local = item.local === null ? null : JSON.parse(JSON.stringify(item.local));
  if (item.whole) db[item.collection] = local;
  else if (item.field) {
    db[item.collection] = db[item.collection] || {};
    if (local === null) delete db[item.collection][item.id]; else db[item.collection][item.id] = local;
  } else {
    const list = Array.isArray(db[item.collection]) ? db[item.collection] : (db[item.collection] = []);
    const at = list.findIndex(record => record.id === item.id);
    if (local === null) { if (at >= 0) list.splice(at, 1); }
    else {
      if (item.collection === 'documents' && local.number && list.some(doc => doc.id !== local.id && doc.number === local.number)) {
        const fresh = nextSyncDocumentNumber(local.type);
        if (!confirm(`${local.number} is already used by another document. Restore this one as ${fresh}?`)) return false;
        local.number = fresh;
      }
      if (at >= 0) list.splice(at, 1, local);
      else if (item.collection === 'documents') list.push(local);
      else list.unshift(local);
    }
  }
  if (typeof persist === 'function' && !persist()) return false;
  if (typeof render === 'function') render();
  return true;
}

window.resolveSyncReview = function (index, choice) {
  const list = pendingSyncReview();
  const item = list[index];
  if (!item) return;
  if (choice === 'mine' && !applyLocalSyncVersion(item)) return;
  list.splice(index, 1);
  savePendingSyncReview(list);
  if (typeof toast === 'function') toast(choice === 'mine' ? 'This device\'s version was applied and will sync.' : 'Kept the cloud version.');
  if (pendingSyncReview().length || readRecoveryCopy()) openSyncReview(); else document.getElementById('syncReview')?.close();
};

window.downloadSyncReview = function () {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), review: pendingSyncReview(), recoveryCopy: readRecoveryCopy() }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `crm-sync-review-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

window.discardRecoveryCopy = function () {
  if (!confirm('Delete the saved copy of unsynced work from this device? Download it first if you might need it. This cannot be undone.')) return;
  localStorage.removeItem(ERP_RECOVERY_KEY);
  updateSyncReviewBanner();
  if (pendingSyncReview().length) openSyncReview(); else document.getElementById('syncReview')?.close();
};

function openSyncReview() {
  const list = pendingSyncReview();
  const recovery = readRecoveryCopy();
  let dialog = document.getElementById('syncReview');
  if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'syncReview'; dialog.className = 'client-form sync-review'; document.body.append(dialog); }
  const rows = list.map((item, index) => `<div class="sync-review-row"><div><b>${syncEscape(item.label)}</b><small>${syncEscape(SYNC_COLLECTION_LABELS[item.collection] || item.collection)} · ${syncEscape(SYNC_REASONS[item.reason] || item.reason)}${item.savedAt ? ' · ' + syncEscape(new Date(item.savedAt).toLocaleString()) : ''}</small></div><div class="actions"><button type="button" class="smallbtn" onclick="resolveSyncReview(${index},'mine')">${item.local === null ? 'Delete it (this device)' : 'Use this device\'s version'}</button><button type="button" class="smallbtn" onclick="resolveSyncReview(${index},'cloud')">Keep cloud version</button></div></div>`).join('');
  const recoveryRow = recovery ? `<div class="sync-review-row"><div><b>Full copy of unsynced work</b><small>Saved ${syncEscape(recovery.savedAt ? new Date(recovery.savedAt).toLocaleString() : 'earlier')} when this device could not merge with the cloud. Download it before discarding.</small></div><div class="actions"><button type="button" class="smallbtn" onclick="downloadSyncReview()">Download</button><button type="button" class="smallbtn" onclick="discardRecoveryCopy()">Discard</button></div></div>` : '';
  dialog.innerHTML = `<div class="dialog-title"><div><div class="eyebrow">Cloud sync</div><h2>Sync review</h2><p class="sub">These items changed on this device and also in the cloud. The CRM is showing the cloud version. Choose which version to keep for each one.</p></div><button type="button" aria-label="Close" onclick="document.getElementById('syncReview').close()">×</button></div><div class="sync-review-list">${rows}${recoveryRow || ''}${!rows && !recoveryRow ? '<p class="sub">Nothing needs review.</p>' : ''}</div><div class="actions"><button type="button" onclick="downloadSyncReview()">Download all as a file</button></div>`;
  if (!dialog.open) dialog.showModal();
}
window.openSyncReview = openSyncReview;
updateSyncReviewBanner();

// Notify CRM extensions after a cloud workspace has loaded.
const erpWorkspaceLoaded = loadWorkspace;
loadWorkspace = async function () {
  const result = await erpWorkspaceLoaded();
  if (erpToken && db) document.dispatchEvent(new Event('erp-workspace-loaded'));
  return result;
};
loadWorkspace();
