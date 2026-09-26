'use strict';

require('dotenv').config();
const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { randomUUID, createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const port = Number(process.env.PORT || 4000);
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/erics_designs_erp';
const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:4000,http://127.0.0.1:4000,https://ericsdesignsindia.github.io')
  .split(',').map(value => value.trim()).filter(Boolean);
const secretFile = path.join(__dirname, '..', '.auth-secret');
const frontendUrl = String(process.env.FRONTEND_URL || 'https://ericsdesignsindia.github.io/erics-designs-mini-crm/').replace(/\/?$/, '/');
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/api/integrations/google-drive/callback`;
const gmailRedirectUri = process.env.GMAIL_REDIRECT_URI || `http://localhost:${port}/api/integrations/gmail/callback`;
const jwtSecret = process.env.JWT_SECRET || (fs.existsSync(secretFile)
  ? fs.readFileSync(secretFile, 'utf8').trim()
  : (() => { const secret = randomUUID() + randomUUID(); fs.writeFileSync(secretFile, secret, { mode: 0o600 }); return secret; })());

app.use(cors({ origin(origin, callback) {
  if (!origin || origins.includes(origin)) return callback(null, true);
  return callback(new Error('Origin is not allowed by this local ERP API.'));
}}));
// A 4 MB file becomes roughly 5.4 MB after browser base64 encoding, so accept a little headroom.
app.use(express.json({ limit: '6mb', verify(req, _res, buffer) { req.rawBody = buffer; } }));

const workspaceSchema = new mongoose.Schema({
  workspaceId: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
  state: { type: mongoose.Schema.Types.Mixed, required: true },
  revision: { type: Number, required: true, default: 0 }
}, { timestamps: true, versionKey: false });
const Workspace = mongoose.model('Workspace', workspaceSchema);
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 60 },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'admin' }
}, { timestamps: true, versionKey: false });
const User = mongoose.model('User', userSchema);
const driveIntegrationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
  accountEmail: { type: String, trim: true },
  tokenCiphertext: { type: String, required: true },
  connectedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });
const DriveIntegration = mongoose.model('DriveIntegration', driveIntegrationSchema);
const gmailIntegrationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
  accountEmail: { type: String, trim: true }, tokenCiphertext: { type: String, required: true }, connectedAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });
const GmailIntegration = mongoose.model('GmailIntegration', gmailIntegrationSchema);
const backupSchema = new mongoose.Schema({
  workspaceId: { type: String, required: true, index: true },
  reason: { type: String, default: 'automatic daily restore point' },
  stateCiphertext: { type: String, required: true }
}, { timestamps: true, versionKey: false });
const Backup = mongoose.model('Backup', backupSchema);

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 'State must be an object.';
  for (const key of ['documents', 'clients', 'services']) {
    if (!Array.isArray(state[key])) return `State must include a ${key} array.`;
  }
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) return 'State must include settings.';
  if (state.documents.length > 10000 || state.clients.length > 10000) return 'Workspace limit exceeded.';
  return null;
}

function workspaceId(value) {
  return typeof value === 'string' && /^[a-z0-9_-]{1,80}$/i.test(value) ? value : null;
}

const resources = new Set(['clients', 'documents', 'services', 'projects', 'tasks', 'activity']);

function recordId(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,100}$/i.test(value) ? value : null;
}

function normaliseState(state) {
  for (const key of ['documents', 'clients', 'services', 'projects', 'tasks', 'activity']) state[key] ??= [];
  return state;
}

function validateRecord(resource, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Record must be an object.';
  if (resource === 'clients' && !String(value.name || '').trim()) return 'Client name is required.';
  if (resource === 'documents') {
    if (!String(value.number || '').trim()) return 'Document number is required.';
    if (!['Invoice', 'Proforma', 'Quotation'].includes(value.type)) return 'Document type must be Invoice, Proforma, or Quotation.';
    if (!value.client || typeof value.client !== 'object' || !String(value.client.name || '').trim()) return 'Document client is required.';
    if (!Array.isArray(value.items)) return 'Document items are required.';
  }
  if (resource === 'tasks' && (!String(value.title || '').trim() || !String(value.due || '').trim())) return 'Task title and due date are required.';
  if (resource === 'projects' && !String(value.name || '').trim()) return 'Project name is required.';
  if (resource === 'services' && !String(value.name || '').trim()) return 'Service name is required.';
  return null;
}

async function getWorkspace(id) {
  const workspace = await Workspace.findOne({ workspaceId: id }).lean();
  if (!workspace) {
    const error = new Error('Workspace not found.');
    error.status = 404;
    throw error;
  }
  return workspace;
}

async function saveState(workspace, state) {
  const updated = await Workspace.findOneAndUpdate(
    { workspaceId: workspace.workspaceId, revision: workspace.revision },
    { state, revision: workspace.revision + 1 },
    { new: true, runValidators: true }
  ).lean();
  if (!updated) {
    const error = new Error('A newer workspace version exists. Reload and try again.');
    error.status = 409;
    throw error;
  }
  try {
    await createAutomaticBackup(updated);
  } catch (backupError) {
    // A backup failure must never block a CRM save. The server log keeps the issue visible.
    console.error('Automatic backup failed:', backupError.message);
  }
  return updated;
}

// Public integrations can arrive while an administrator is saving CRM changes in
// the browser. Reload the workspace and apply the integration change again when
// that normal optimistic-lock race occurs, rather than rejecting a lead.
async function updateWorkspaceState(workspaceId, mutate, retries = 3) {
  let conflict;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const workspace = await getWorkspace(workspaceId);
    const state = normaliseState(structuredClone(workspace.state));
    const result = await mutate(state);
    try {
      await saveState(workspace, state);
      return result;
    } catch (error) {
      if (error.status !== 409 || attempt === retries - 1) throw error;
      conflict = error;
    }
  }
  throw conflict;
}

function backupKey() { return createHash('sha256').update(process.env.BACKUP_ENCRYPTION_KEY || jwtSecret).digest(); }
function encryptBackup(value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', backupKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
async function createAutomaticBackup(workspace) {
  const latest = await Backup.findOne({ workspaceId: workspace.workspaceId }).sort({ createdAt: -1 }).lean();
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < 24 * 60 * 60 * 1000) return;
  await Backup.create({ workspaceId: workspace.workspaceId, stateCiphertext: encryptBackup(workspace.state) });
  const expired = await Backup.find({ workspaceId: workspace.workspaceId }).sort({ createdAt: -1 }).skip(30).select('_id').lean();
  if (expired.length) await Backup.deleteMany({ _id: { $in: expired.map(item => item._id) } });
}

function issueToken(user) {
  return jwt.sign({ sub: user._id.toString(), username: user.username, role: user.role }, jwtSecret, { expiresIn: '7d' });
}

function googleDriveConfig() {
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  return { configured, redirectUri: googleRedirectUri };
}

function gmailConfig() {
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  return { configured, redirectUri: gmailRedirectUri };
}
function integrationKey() {
  if (!process.env.GOOGLE_TOKEN_ENCRYPTION_KEY) throw new Error('Google Drive encryption is not configured.');
  return createHash('sha256').update(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY).digest();
}

function encryptIntegration(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', integrationKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decryptIntegration(value) {
  const raw = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', integrationKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
}

async function driveAccessToken(userId) {
  const integration = await DriveIntegration.findOne({ userId });
  if (!integration) { const error = new Error('Connect Google Drive in Settings before uploading attachments.'); error.status = 409; throw error; }
  const tokens = decryptIntegration(integration.tokenCiphertext);
  if (tokens.access_token && (!tokens.expiry_date || Number(tokens.expiry_date) > Date.now() + 60000)) return tokens.access_token;
  if (!tokens.refresh_token) { const error = new Error('Reconnect Google Drive to continue.'); error.status = 401; throw error; }
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }) });
  const refreshed = await response.json();
  if (!response.ok) { const error = new Error('Reconnect Google Drive to continue.'); error.status = 401; throw error; }
  Object.assign(tokens, refreshed, { refresh_token: tokens.refresh_token, expiry_date: Date.now() + Number(refreshed.expires_in || 3600) * 1000 });
  integration.tokenCiphertext = encryptIntegration(tokens); integration.updatedAt = new Date(); await integration.save();
  return tokens.access_token;
}
async function driveRequest(token, url, options = {}) { const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } }); const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(body?.error?.message || 'Google Drive request failed.'); error.status = response.status; throw error; } return body; }

function whatsappConfig() {
  return {
    configured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || ''),
    graphVersion: String(process.env.WHATSAPP_GRAPH_VERSION || 'v22.0')
  };
}

async function gmailAccessToken(userId) {
  const integration = await GmailIntegration.findOne({ userId });
  if (!integration) { const error = new Error('Connect Gmail in Settings before opening the mailbox.'); error.status = 409; throw error; }
  const tokens = decryptIntegration(integration.tokenCiphertext);
  if (tokens.access_token && (!tokens.expiry_date || Number(tokens.expiry_date) > Date.now() + 60000)) return tokens.access_token;
  if (!tokens.refresh_token) { const error = new Error('Reconnect Gmail to continue.'); error.status = 401; throw error; }
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }) });
  const refreshed = await response.json();
  if (!response.ok) { const error = new Error('Reconnect Gmail to continue.'); error.status = 401; throw error; }
  Object.assign(tokens, refreshed, { refresh_token: tokens.refresh_token, expiry_date: Date.now() + Number(refreshed.expires_in || 3600) * 1000 });
  integration.tokenCiphertext = encryptIntegration(tokens); integration.updatedAt = new Date(); await integration.save();
  return tokens.access_token;
}

function validWhatsAppRecipient(value) {
  const phone = String(value || '').replace(/\D/g, '');
  return phone.length >= 8 && phone.length <= 15 ? phone : null;
}

async function sendWhatsAppInvoice({ to, filename, mimeType, base64, caption }) {
  const config = whatsappConfig();
  if (!config.configured) { const error = new Error('WhatsApp Business API is not configured on the server.'); error.status = 409; throw error; }
  const recipient = validWhatsAppRecipient(to);
  const bytes = Buffer.from(String(base64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!recipient) { const error = new Error('A valid client WhatsApp number is required.'); error.status = 400; throw error; }
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) { const error = new Error('The invoice PDF must be smaller than 4 MB.'); error.status = 400; throw error; }
  const root = `https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.phoneNumberId)}`;
  const upload = new FormData();
  upload.append('messaging_product', 'whatsapp');
  upload.append('file', new Blob([bytes], { type: mimeType || 'application/pdf' }), filename || 'invoice.pdf');
  const mediaResponse = await fetch(`${root}/media`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }, body: upload });
  const media = await mediaResponse.json().catch(() => ({}));
  if (!mediaResponse.ok || !media.id) { const error = new Error(media?.error?.message || 'WhatsApp could not upload the invoice PDF.'); error.status = mediaResponse.status || 502; throw error; }
  const messageResponse = await fetch(`${root}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'document', document: { id: media.id, filename: filename || 'invoice.pdf', caption: String(caption || '').slice(0, 1024) } }) });
  const message = await messageResponse.json().catch(() => ({}));
  if (!messageResponse.ok) { const error = new Error(message?.error?.message || 'WhatsApp could not send the invoice.'); error.status = messageResponse.status || 502; throw error; }
  return message;
}
function metaLeadConfig() {
  return { configured: Boolean(process.env.META_VERIFY_TOKEN && process.env.META_APP_SECRET && process.env.META_PAGE_ACCESS_TOKEN) };
}

async function metaPageSubscription() {
  if (!process.env.META_PAGE_ACCESS_TOKEN) return false;
  const appId = String(process.env.META_APP_ID || '1428706729188935');
  const response = await fetch(`https://graph.facebook.com/v22.0/me/subscribed_apps?fields=id,subscribed_fields&access_token=${encodeURIComponent(process.env.META_PAGE_ACCESS_TOKEN)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return false;
  const app = (payload.data || []).find(item => String(item.id) === appId);
  if (!app) return false;
  const fields = Array.isArray(app.subscribed_fields) ? app.subscribed_fields : [];
  return fields.length === 0 || fields.includes('leadgen');
}

function validMetaSignature(req) {
  const signature = String(req.headers['x-hub-signature-256'] || '');
  if (!signature.startsWith('sha256=') || !req.rawBody || !process.env.META_APP_SECRET) return false;
  const hmac = require('crypto').createHmac('sha256', process.env.META_APP_SECRET).update(req.rawBody).digest('hex');
  return signature === `sha256=${hmac}`;
}

function metaLeadFields(values) {
  const fields = {};
  for (const value of values || []) {
    const key = String(value.name || '').toLowerCase();
    const answer = Array.isArray(value.values) ? value.values.filter(Boolean).join(', ') : '';
    if (answer) fields[key] = answer;
  }
  const name = fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(' ') || fields.name || 'Meta Lead';
  return {
    name: String(name).trim().slice(0, 120),
    email: String(fields.email || '').trim().toLowerCase().slice(0, 160),
    phone: String(fields.phone_number || fields.phone || '').trim().slice(0, 40),
    service: String(fields.service || fields.interested_service || '').trim().slice(0, 120),
    details: Object.entries(fields).map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`).join('\n')
  };
}

async function importMetaLead(leadgenId) {
  const response = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(leadgenId)}?fields=created_time,field_data,form_id&access_token=${encodeURIComponent(process.env.META_PAGE_ACCESS_TOKEN)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload?.error?.message || 'Meta lead lookup failed.'); error.status = response.status; throw error; }
  const lead = metaLeadFields(payload.field_data);
  const note = `Meta Lead Ads enquiry${lead.service ? ` - ${lead.service}` : ''}\nForm: ${payload.form_id || 'Unknown'}\nLead ID: ${leadgenId}\n\n${lead.details || 'No additional details supplied.'}`;
  return updateWorkspaceState('erics-designs-default', state => {
    const existing = state.clients.find(client => lead.email && client.email === lead.email) || state.clients.find(client => lead.phone && client.phone === lead.phone);
    if (existing) {
      if (existing.notes?.includes(`Lead ID: ${leadgenId}`)) return { duplicate: true, client: existing };
      existing.notes = `${existing.notes ? existing.notes + '\n\n' : ''}${note}`; existing.updated = new Date().toISOString();
      return { duplicate: true, client: existing };
    }
    const client = { id: randomUUID(), name: lead.name, contact: lead.name, email: lead.email, phone: lead.phone, source: 'Meta Lead Ads', stage: 'New lead', value: 0, notes: note, created: new Date().toISOString(), updated: new Date().toISOString() };
    state.clients.unshift(client); state.activity.unshift({ id: randomUUID(), message: `New Meta Lead Ads lead: ${client.name}`, date: new Date().toISOString() });
    return { duplicate: false, client };
  });
}
async function driveFolder(token, name, parentId) { const safeName = String(name).replace(/'/g, "\\'"); const parent = parentId ? ` and '${parentId}' in parents` : ''; const query = `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parent}`; const found = await driveRequest(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`); if (found.files?.[0]) return found.files[0].id; const created = await driveRequest(token, 'https://www.googleapis.com/drive/v3/files?fields=id,name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }) }); return created.id; }

function validCredentials(username, password) {
  if (!/^[a-z0-9._-]{3,60}$/i.test(String(username || ''))) return 'Use 3–60 letters, numbers, dots, underscores, or hyphens for the username.';
  if (typeof password !== 'string' || password.length < 10) return 'Use a password with at least 10 characters.';
  return null;
}

async function requireAuth(req, res, next) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Sign in is required.' });
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch (_error) { return res.status(401).json({ error: 'Your session has expired. Sign in again.' }); }
}

async function ensureOwner() {
  const owner = await User.findOne({ role: 'owner' }).lean();
  if (owner) return owner;
  const first = await User.findOne({}).sort({ createdAt: 1 });
  if (!first) return null;
  first.role = 'owner'; await first.save(); return first.toObject();
}
async function requireOwner(req, res, next) {
  try {
    await ensureOwner();
    const user = await User.findById(req.user.sub).lean();
    if (!user || user.role !== 'owner') return res.status(403).json({ error: 'Only the business owner can perform this action.' });
    req.owner = user; return next();
  } catch (error) { return next(error); }
}

function portalDocument(token) {
  if (!/^[a-zA-Z0-9_-]{24,160}$/.test(String(token || ''))) return null;
  return Workspace.findOne({ workspaceId: 'erics-designs-default', 'state.documents.portalToken': token }).lean();
}
function publicDocument(document) {
  const copy = structuredClone(document);
  delete copy.portalToken;
  delete copy.client?.id;
  return copy;
}
app.get('/api/public/portal/:token', async (req, res, next) => {
  try {
    const workspace = await portalDocument(req.params.token);
    const document = workspace?.state?.documents?.find(item => item.portalToken === req.params.token);
    if (!document || document.status === 'Cancelled') return res.status(404).json({ error: 'This client link is unavailable.' });
    return res.json({ document: publicDocument(document) });
  } catch (error) { return next(error); }
});
app.post('/api/public/portal/:token/approve', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    const workspace = await portalDocument(token);
    const document = workspace?.state?.documents?.find(item => item.portalToken === token);
    if (!document || document.type !== 'Quotation' || document.status !== 'Sent') return res.status(409).json({ error: 'This quotation cannot be approved from this link.' });
    if (document.due && document.due < new Date().toISOString().slice(0, 10)) return res.status(409).json({ error: 'This quotation has expired. Please contact Eric’s Designs.' });
    await updateWorkspaceState('erics-designs-default', state => {
      const target = state.documents.find(item => item.portalToken === token);
      if (!target || target.type !== 'Quotation' || target.status !== 'Sent') { const error = new Error('This quotation is no longer available for approval.'); error.status = 409; throw error; }
      target.status = 'Accepted'; target.acceptedAt = new Date().toISOString(); target.updated = new Date().toISOString();
      state.activity.unshift({ id: randomUUID(), message: `Client approved quotation ${target.number}`, date: target.acceptedAt });
    });
    return res.json({ ok: true, message: 'Quotation approved.' });
  } catch (error) { return next(error); }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'erics-designs-erp-api', database: mongoose.connection.readyState === 1 ? 'connected' : 'connecting' }));

app.get('/api', (_req, res) => res.json({
  service: 'erics-designs-erp-api',
  resources: ['overview', 'settings', ...resources],
  workspaceRoutes: '/api/workspaces/:workspaceId'
}));

const publicLeadRequests = new Map();
function leadRequestAllowed(ip) { const now = Date.now(), windowStart = now - 10 * 60 * 1000; const list = (publicLeadRequests.get(ip) || []).filter(time => time > windowStart); if (list.length >= 12) return false; list.push(now); publicLeadRequests.set(ip, list); return true; }
function secureTokenMatches(actual, expected) {
  if (!expected || !actual) return false;
  const actualBuffer = Buffer.from(actual), expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
app.post('/api/public/leads', async (req, res, next) => {
  try {
    const ip = req.ip || 'unknown';
    if (!leadRequestAllowed(ip)) return res.status(429).json({ error: 'Please wait a few minutes before submitting another enquiry.' });
    const name = String(req.body.name || '').trim().slice(0, 120);
    const contact = String(req.body.contact || '').trim().slice(0, 120);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
    const phone = String(req.body.phone || '').trim().slice(0, 40);
    const service = String(req.body.service || '').trim().slice(0, 120);
    const message = String(req.body.message || '').trim().slice(0, 3000);
    const source = String(req.body.source || 'Website').trim().slice(0, 80);
    if (!name || !message || (!email && !phone)) return res.status(400).json({ error: 'Add your name, enquiry, and either an email address or WhatsApp number.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const result = await updateWorkspaceState('erics-designs-default', state => {
      const existing = state.clients.find(client => email && client.email === email) || state.clients.find(client => phone && client.phone === phone);
      if (existing) {
        existing.notes = `${existing.notes ? existing.notes + '\n\n' : ''}New ${source} enquiry${service ? ` - ${service}` : ''}: ${message}`;
        existing.updated = new Date().toISOString();
        return { duplicate: true };
      }
      const lead = { id: randomUUID(), name, contact, email, phone, source, stage: 'New lead', value: 0, notes: `${service ? `Interested service: ${service}\n\n` : ''}${message}`, created: new Date().toISOString(), updated: new Date().toISOString() };
      state.clients.unshift(lead); state.activity.unshift({ id: randomUUID(), message: `New ${source} lead: ${name}`, date: new Date().toISOString() });
      return { duplicate: false };
    });
    return res.status(result.duplicate ? 200 : 201).json({ ok: true, duplicate: result.duplicate });
  } catch (error) { return next(error); }
});

// Make sends Meta Lead Ads data here. The token keeps this integration endpoint private.
app.post('/api/integrations/make/leads', async (req, res, next) => {
  try {
    if (!secureTokenMatches(String(req.get('x-make-webhook-token') || ''), String(process.env.MAKE_WEBHOOK_TOKEN || ''))) return res.status(401).json({ error: 'Invalid Make webhook token.' });
    const name = String(req.body.name || req.body.full_name || 'Meta lead').trim().slice(0, 120);
    const contact = String(req.body.contact || req.body.full_name || name).trim().slice(0, 120);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
    const phone = String(req.body.phone || req.body.phone_number || '').trim().slice(0, 40);
    const service = String(req.body.service || req.body.service_interest || '').trim().slice(0, 120);
    const message = String(req.body.message || req.body.details || 'Meta Instant Form enquiry').trim().slice(0, 3000);
    const source = String(req.body.source || 'Meta Lead Ads (Make)').trim().slice(0, 80);
    if (!email && !phone) return res.status(400).json({ error: 'A Meta lead needs an email address or phone number.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Make supplied an invalid email address.' });
    const result = await updateWorkspaceState('erics-designs-default', state => {
      const existing = state.clients.find(client => email && client.email === email) || state.clients.find(client => phone && client.phone === phone);
      if (existing) {
        existing.notes = `${existing.notes ? existing.notes + '\n\n' : ''}New ${source} enquiry${service ? ` - ${service}` : ''}: ${message}`;
        existing.updated = new Date().toISOString();
        return { duplicate: true, clientId: existing.id };
      }
      const lead = { id: randomUUID(), name, contact, email, phone, source, stage: 'New lead', value: 0, notes: `${service ? `Interested service: ${service}\n\n` : ''}${message}`, created: new Date().toISOString(), updated: new Date().toISOString() };
      state.clients.unshift(lead); state.activity.unshift({ id: randomUUID(), message: `New ${source} lead: ${name}`, date: new Date().toISOString() });
      return { duplicate: false, clientId: lead.id };
    });
    return res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
  } catch (error) { return next(error); }
});

app.get('/api/integrations/whatsapp/status', requireAuth, requireOwner, (_req, res) => {
  const config = whatsappConfig();
  return res.json({ configured: config.configured, phoneNumberId: config.configured ? config.phoneNumberId : '' });
});

app.post('/api/integrations/whatsapp/send-document', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const result = await sendWhatsAppInvoice({
      to: req.body.to,
      filename: String(req.body.filename || 'invoice.pdf').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 150),
      mimeType: req.body.mimeType || 'application/pdf',
      base64: req.body.base64,
      caption: req.body.caption
    });
    return res.status(201).json({ ok: true, messageId: result.messages?.[0]?.id || '' });
  } catch (error) { return next(error); }
});
app.post('/api/integrations/whatsapp/send-invoice', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const result = await sendWhatsAppInvoice({
      to: req.body.to,
      filename: String(req.body.filename || 'invoice.pdf').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 150),
      mimeType: req.body.mimeType || 'application/pdf',
      base64: req.body.base64,
      caption: req.body.caption
    });
    return res.status(201).json({ ok: true, messageId: result.messages?.[0]?.id || '' });
  } catch (error) { return next(error); }
});
app.get('/api/integrations/make-leads/status', requireAuth, requireOwner, (_req, res) => {
  const baseUrl = String(process.env.PUBLIC_API_URL || `http://localhost:${port}`).replace(/\/$/, '');
  return res.json({ configured: Boolean(process.env.MAKE_WEBHOOK_TOKEN), webhookUrl: `${baseUrl}/api/integrations/make/leads` });
});
app.get('/api/integrations/meta-leads/status', requireAuth, requireOwner, async (_req, res, next) => {
  try {
    const baseUrl = String(process.env.PUBLIC_API_URL || `http://localhost:${port}`).replace(/\/$/, '');
    const configured = metaLeadConfig().configured;
    return res.json({ configured, pageConnected: configured ? await metaPageSubscription() : false, webhookUrl: `${baseUrl}/api/integrations/meta-leads/webhook` });
  } catch (error) { return next(error); }
});

app.post('/api/integrations/meta-leads/subscribe-page', requireAuth, requireOwner, async (_req, res, next) => {
  try {
    if (!metaLeadConfig().configured) return res.status(409).json({ error: 'Meta Lead Ads setup is incomplete on the server.' });
    const response = await fetch('https://graph.facebook.com/v22.0/me/subscribed_apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ subscribed_fields: 'leadgen', access_token: process.env.META_PAGE_ACCESS_TOKEN })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      const error = new Error(payload?.error?.message || 'Meta could not connect this Page to the CRM app.');
      error.status = response.status || 502; throw error;
    }
    return res.json({ connected: true, message: 'Meta Lead Ads is connected. New Page leads will be imported into the CRM.' });
  } catch (error) { return next(error); }
});

app.get('/api/integrations/meta-leads/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  if (mode === 'subscribe' && process.env.META_VERIFY_TOKEN && token === process.env.META_VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post('/api/integrations/meta-leads/webhook', async (req, res, next) => {
  try {
    if (!validMetaSignature(req)) return res.sendStatus(403);
    if (req.body?.object !== 'page') return res.sendStatus(404);
    for (const entry of req.body.entry || []) for (const change of entry.changes || []) {
      if (change.field === 'leadgen' && change.value?.leadgen_id) {
        try { await importMetaLead(String(change.value.leadgen_id)); } catch (error) { console.error('Meta lead import failed:', error.message); }
      }
    }
    return res.status(200).send('EVENT_RECEIVED');
  } catch (error) { return next(error); }
});

app.get('/api/auth/status', async (_req, res, next) => {
  try { return res.json({ setupRequired: (await User.countDocuments()) === 0 }); }
  catch (error) { return next(error); }
});

app.post('/api/auth/setup', async (req, res, next) => {
  try {
    if (await User.countDocuments()) return res.status(403).json({ error: 'An administrator account already exists.' });
    const username = String(req.body.username || '').trim().toLowerCase();
    const error = validCredentials(username, req.body.password);
    if (error) return res.status(400).json({ error });
    const user = await User.create({ username, passwordHash: await bcrypt.hash(req.body.password, 12), role: 'owner' });
    return res.status(201).json({ token: issueToken(user), user: { username: user.username, role: user.role } });
  } catch (error) { return next(error); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(String(req.body.password || ''), user.passwordHash)) return res.status(401).json({ error: 'Incorrect username or password.' });
    return res.json({ token: issueToken(user), user: { username: user.username, role: user.role } });
  } catch (error) { return next(error); }
});

app.get('/api/admin/me', requireAuth, async (req, res, next) => { try { const owner = await ensureOwner(); const user = await User.findById(req.user.sub).lean(); return res.json({ username: user?.username || '', role: user?.role || 'admin', ownerUsername: owner?.username || '' }); } catch (error) { return next(error); } });
app.get('/api/admin/users', requireAuth, requireOwner, async (_req, res, next) => { try { const users = await User.find({}, { username: 1, role: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean(); return res.json({ users: users.map(user => ({ id: user._id.toString(), username: user.username, role: user.role, createdAt: user.createdAt })) }); } catch (error) { return next(error); } });
app.post('/api/admin/users', requireAuth, requireOwner, async (req, res, next) => { try { const username = String(req.body.username || '').trim().toLowerCase(); const error = validCredentials(username, req.body.password); if (error) return res.status(400).json({ error }); if (await User.exists({ username })) return res.status(409).json({ error: 'That username is already in use.' }); const user = await User.create({ username, passwordHash: await bcrypt.hash(req.body.password, 12), role: 'owner' }); return res.status(201).json({ user: { id: user._id.toString(), username: user.username, role: user.role, createdAt: user.createdAt } }); } catch (error) { return next(error); } });
app.put('/api/admin/users/:userId/password', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const password = String(req.body.password || '');
    if (password.length < 10) return res.status(400).json({ error: 'Use a password with at least 10 characters.' });
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'Administrator not found.' });
    user.passwordHash = await bcrypt.hash(password, 12);
    await user.save();
    return res.json({ message: `Password reset for ${user.username}.` });
  } catch (error) { return next(error); }
});
app.get('/api/integrations/gmail/status', requireAuth, requireOwner, async (req, res, next) => {
  try { const config = gmailConfig(); const integration = await GmailIntegration.findOne({ userId: req.user.sub }).lean(); return res.json({ configured: config.configured, connected: Boolean(integration), accountEmail: integration?.accountEmail || null, redirectUri: config.redirectUri }); } catch (error) { return next(error); }
});
app.get('/api/integrations/gmail/messages', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const token = await gmailAccessToken(req.user.sub);
    const limit = Math.max(1, Math.min(25, Number(req.query.limit) || 15));
    const listResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=${limit}`, { headers: { Authorization: `Bearer ${token}` } });
    const list = await listResponse.json().catch(() => ({}));
    if (!listResponse.ok) return res.status(listResponse.status).json({ error: list?.error?.message || 'Gmail inbox could not be loaded.' });
    const messages = [];
    for (const item of list.messages || []) {
      const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
      const message = await response.json().catch(() => ({}));
      if (!response.ok) continue;
      const headers = Object.fromEntries((message.payload?.headers || []).map(header => [String(header.name || '').toLowerCase(), header.value || '']));
      const decodePart = value => Buffer.from(String(value || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const collectText = part => {
        if (!part) return '';
        const mime = String(part.mimeType || '').toLowerCase();
        if (mime === 'text/plain' && part.body?.data) return decodePart(part.body.data);
        for (const child of part.parts || []) { const text = collectText(child); if (text) return text; }
        if (mime === 'text/html' && part.body?.data) return decodePart(part.body.data).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ');
        return '';
      };
      messages.push({ id: message.id, threadId: message.threadId, from: headers.from || 'Unknown sender', subject: headers.subject || '(No subject)', date: headers.date || '', snippet: message.snippet || '', body: collectText(message.payload) || message.snippet || '', unread: (message.labelIds || []).includes('UNREAD') });
    }
    return res.json({ messages, nextPageToken: list.nextPageToken || null });
  } catch (error) { return next(error); }
});
app.get('/api/integrations/gmail/messages/:messageId', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const messageId = String(req.params.messageId || '');
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(messageId)) return res.status(400).json({ error: 'Invalid Gmail message.' });
    const token = await gmailAccessToken(req.user.sub);
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
    const message = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ error: message?.error?.message || 'Gmail message could not be opened.' });
    const headers = Object.fromEntries((message.payload?.headers || []).map(header => [String(header.name || '').toLowerCase(), header.value || '']));
    const decodePart = value => Buffer.from(String(value || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const collectText = part => {
      if (!part) return '';
      const mime = String(part.mimeType || '').toLowerCase();
      if (mime === 'text/plain' && part.body?.data) return decodePart(part.body.data);
      for (const child of part.parts || []) { const text = collectText(child); if (text) return text; }
      if (mime === 'text/html' && part.body?.data) return decodePart(part.body.data).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ');
      return '';
    };
    return res.json({ id: message.id, from: headers.from || 'Unknown sender', to: headers.to || '', subject: headers.subject || '(No subject)', date: headers.date || '', body: collectText(message.payload) || message.snippet || '', snippet: message.snippet || '' });
  } catch (error) { return next(error); }
});
app.post('/api/integrations/gmail/send-document', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const to = String(req.body?.to || '').trim();
    const subject = String(req.body?.subject || '').trim().replace(/[\r\n]+/g, ' ');
    const body = String(req.body?.body || '').trim();
    const filename = String(req.body?.filename || 'document.pdf').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 150);
    const mimeType = String(req.body?.mimeType || 'application/pdf');
    const attachment = Buffer.from(String(req.body?.base64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid recipient email address.' });
    if (!subject || !body) return res.status(400).json({ error: 'Add both a subject and message.' });
    if (!attachment.length || attachment.length > 4 * 1024 * 1024) return res.status(400).json({ error: 'The document PDF must be smaller than 4 MB.' });
    const token = await gmailAccessToken(req.user.sub);
    const boundary = `crm-${randomUUID()}`;
    const encoded = attachment.toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
    const rawMessage = [
      `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
      `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', body, '',
      `--${boundary}`, `Content-Type: ${mimeType}; name="${filename}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${filename}"`, '', encoded,
      `--${boundary}--`, ''
    ].join('\r\n');
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: Buffer.from(rawMessage, 'utf8').toString('base64url') }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ error: result?.error?.message || 'Gmail could not send this document.' });
    return res.json({ ok: true, id: result.id, threadId: result.threadId });
  } catch (error) { return next(error); }
});
app.post('/api/integrations/gmail/send', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const to = String(req.body?.to || '').trim();
    const subject = String(req.body?.subject || '').trim().replace(/[\r\n]+/g, ' ');
    const body = String(req.body?.body || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid recipient email address.' });
    if (!subject || !body) return res.status(400).json({ error: 'Add both a subject and message.' });
    if (subject.length > 200 || body.length > 20000) return res.status(400).json({ error: 'Email content is too long.' });
    const token = await gmailAccessToken(req.user.sub);
    const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}`, 'utf8').toString('base64url');
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ error: result?.error?.message || 'Gmail could not send this email.' });
    return res.json({ ok: true, id: result.id, threadId: result.threadId });
  } catch (error) { return next(error); }
});app.post('/api/integrations/gmail/connect', requireAuth, requireOwner, async (req, res, next) => {
  try { const config = gmailConfig(); if (!config.configured) return res.status(503).json({ error: 'Gmail setup is pending. Add the Google OAuth settings on Render first.' }); const state = jwt.sign({ purpose: 'gmail', sub: req.user.sub }, jwtSecret, { expiresIn: '10m' }); const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: config.redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email', access_type: 'offline', prompt: 'consent', state }); return res.json({ authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }); } catch (error) { return next(error); }
});
app.get('/api/integrations/gmail/callback', async (req, res) => {
  const done = (status, message) => res.redirect(`${frontendUrl}?gmail=${encodeURIComponent(status)}&message=${encodeURIComponent(message)}`);
  try { if (req.query.error) return done('denied', 'Gmail access was not granted.'); const state = jwt.verify(String(req.query.state || ''), jwtSecret); if (state.purpose !== 'gmail' || !req.query.code) return done('error', 'The Gmail connection link is invalid or expired.'); const config = gmailConfig(); if (!config.configured) return done('error', 'Gmail is not configured on the server.'); const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: String(req.query.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }) }); const tokens = await response.json(); if (!response.ok) return done('error', tokens?.error_description || 'Google could not complete the Gmail connection.'); const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } }); const profile = await profileResponse.json().catch(() => ({})); await GmailIntegration.findOneAndUpdate({ userId: state.sub }, { userId: state.sub, accountEmail: String(profile.email || ''), tokenCiphertext: encryptIntegration(tokens), connectedAt: new Date(), updatedAt: new Date() }, { upsert: true, new: true, runValidators: true }); return done('connected', 'Gmail is connected to Eric’s Designs CRM.'); } catch (_error) { return done('error', 'Gmail could not be connected. Please try again.'); }
});
app.delete('/api/integrations/gmail', requireAuth, requireOwner, async (req, res, next) => { try { await GmailIntegration.deleteOne({ userId: req.user.sub }); return res.json({ ok: true }); } catch (error) { return next(error); } });
app.get('/api/integrations/google-drive/status', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const config = googleDriveConfig();
    const integration = await DriveIntegration.findOne({ userId: req.user.sub }).lean();
    return res.json({ configured: config.configured, connected: Boolean(integration), accountEmail: integration?.accountEmail || null, redirectUri: config.redirectUri });
  } catch (error) { return next(error); }
});

app.post('/api/integrations/google-drive/connect', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const config = googleDriveConfig();
    if (!config.configured) return res.status(503).json({ error: 'Google Drive is not configured yet. Add the Google OAuth and encryption settings on the server first.' });
    const state = jwt.sign({ purpose: 'google-drive', sub: req.user.sub }, jwtSecret, { expiresIn: '10m' });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline', prompt: 'consent', state
    });
    return res.json({ authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  } catch (error) { return next(error); }
});

app.get('/api/integrations/google-drive/callback', async (req, res) => {
  const done = (status, message) => res.redirect(`${frontendUrl}?drive=${encodeURIComponent(status)}&message=${encodeURIComponent(message)}`);
  try {
    if (req.query.error) return done('denied', 'Google Drive access was not granted.');
    const state = jwt.verify(String(req.query.state || ''), jwtSecret);
    if (state.purpose !== 'google-drive' || !req.query.code) return done('error', 'The Google Drive connection link is invalid or expired.');
    const config = googleDriveConfig();
    if (!config.configured) return done('error', 'Google Drive is not configured on the server.');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: String(req.query.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }) });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) return done('error', tokens?.error_description || 'Google could not complete the connection.');
    let accountEmail = '';
    if (tokens.access_token) {
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const profile = await profileResponse.json().catch(() => ({}));
      accountEmail = String(profile.email || '');
    }
    await DriveIntegration.findOneAndUpdate({ userId: state.sub }, { userId: state.sub, accountEmail, tokenCiphertext: encryptIntegration(tokens), connectedAt: new Date(), updatedAt: new Date() }, { upsert: true, new: true, runValidators: true });
    return done('connected', 'Google Drive is connected to Eric�s Designs CRM.');
  } catch (error) { return done('error', 'Google Drive could not be connected. Please try again.'); }
});

app.delete('/api/integrations/google-drive', requireAuth, requireOwner, async (req, res, next) => {
  try { await DriveIntegration.deleteOne({ userId: req.user.sub }); return res.json({ ok: true }); }
  catch (error) { return next(error); }
});

app.post('/api/integrations/google-drive/attachments', requireAuth, requireOwner, async (req, res, next) => {
  try { const name = String(req.body.name || '').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 150); const clientName = String(req.body.clientName || 'Unassigned client').trim().slice(0, 120); const mimeType = String(req.body.mimeType || 'application/octet-stream').slice(0, 120); const content = String(req.body.base64 || '').replace(/^data:[^;]+;base64,/, ''); if (!name || !content) return res.status(400).json({ error: 'Choose a file to upload.' }); const bytes = Buffer.from(content, 'base64'); if (!bytes.length || bytes.length > 4 * 1024 * 1024) return res.status(400).json({ error: 'Files must be smaller than 4 MB.' }); const token = await driveAccessToken(req.user.sub); const rootId = await driveFolder(token, "Eric's Designs CRM"); const clientId = await driveFolder(token, clientName, rootId); const boundary = `crm-${randomUUID()}`; const metadata = Buffer.from(JSON.stringify({ name, mimeType, parents: [clientId] }), 'utf8'); const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`), metadata, Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]); const file = await driveRequest(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,createdTime,size', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }); return res.status(201).json({ attachment: { id: file.id, name: file.name, mimeType: file.mimeType, url: file.webViewLink || `https://drive.google.com/open?id=${file.id}`, createdAt: file.createdTime, size: Number(file.size || bytes.length) } }); }
  catch (error) { return next(error); }
});

app.get('/api/integrations/ai/status', requireAuth, (_req, res) => {
  res.json({ configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-4.1-mini' });
});

app.post('/api/ai/draft', requireAuth, async (req, res, next) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'AI drafting is not configured.' });
    const mode = String(req.body.mode || 'Quotation draft').slice(0, 80);
    const brief = String(req.body.brief || '').trim().slice(0, 12000);
    const context = String(req.body.context || '').slice(0, 16000);
    if (!brief) return res.status(400).json({ error: 'Add a brief before generating a draft.' });
    const prompt = `You write professional drafts for Eric's Designs, a creative and digital agency. Task: ${mode}. Use only the reference context below. Do not invent prices, promises, credentials, payment details, or deadlines. Flag missing details as questions. Return clear client-ready text.\n\nBRIEF\n${brief}\n\nREFERENCE CONTEXT\n${context}`;
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', input: prompt }) });
    const body = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: body?.error?.message || 'AI draft request failed.' });
    const text = body.output_text || body.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('') || '';
    return res.json({ text });
  } catch (error) { return next(error); }
});
app.use('/api/workspaces', requireAuth);

app.get('/api/workspaces/:workspaceId/backups', requireOwner, async (req, res, next) => {
  try {
    const id = workspaceId(req.params.workspaceId);
    if (!id) return res.status(400).json({ error: 'Invalid workspace id.' });
    const backups = await Backup.find({ workspaceId: id }).sort({ createdAt: -1 }).limit(30).lean();
    return res.json({ backups: backups.map(backup => ({ id: backup._id.toString(), createdAt: backup.createdAt, reason: backup.reason })), retention: 30 });
  } catch (error) { return next(error); }
});

app.get('/api/workspaces/:workspaceId', async (req, res, next) => {
  try {
    const id = workspaceId(req.params.workspaceId);
    if (!id) return res.status(400).json({ error: 'Invalid workspace id.' });
    const workspace = await Workspace.findOne({ workspaceId: id }).lean();
    if (!workspace) return res.status(404).json({ error: 'Workspace not found.' });
    return res.json({ workspaceId: workspace.workspaceId, state: workspace.state, revision: workspace.revision, updatedAt: workspace.updatedAt });
  } catch (error) { return next(error); }
});

app.put('/api/workspaces/:workspaceId', async (req, res, next) => {
  try {
    const id = workspaceId(req.params.workspaceId);
    if (!id) return res.status(400).json({ error: 'Invalid workspace id.' });
    const error = validateState(req.body.state);
    if (error) return res.status(400).json({ error });
    const expectedRevision = Number.isInteger(req.body.revision) ? req.body.revision : null;
    const current = await Workspace.findOne({ workspaceId: id }).lean();
    if (current && expectedRevision !== null && expectedRevision !== current.revision) {
      return res.status(409).json({ error: 'A newer workspace version exists.', revision: current.revision, state: current.state, updatedAt: current.updatedAt });
    }
    const nextRevision = (current?.revision || 0) + 1;
    const workspace = await Workspace.findOneAndUpdate(
      { workspaceId: id },
      { workspaceId: id, state: req.body.state, revision: nextRevision },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    return res.json({ ok: true, workspaceId: workspace.workspaceId, revision: workspace.revision, updatedAt: workspace.updatedAt });
  } catch (error) { return next(error); }
});

app.get('/api/workspaces/:workspaceId/overview', async (req, res, next) => {
  try {
    const workspace = await getWorkspace(workspaceId(req.params.workspaceId));
    const state = normaliseState(workspace.state);
    const invoices = state.documents.filter(document => document.type === 'Invoice');
    return res.json({
      clients: state.clients.length,
      documents: state.documents.length,
      quotations: state.documents.filter(document => document.type === 'Quotation').length,
      proformas: state.documents.filter(document => document.type === 'Proforma').length,
      invoices: invoices.length,
      projects: state.projects.length,
      openTasks: state.tasks.filter(task => !task.done).length,
      revision: workspace.revision,
      updatedAt: workspace.updatedAt
    });
  } catch (error) { return next(error); }
});

app.get('/api/workspaces/:workspaceId/settings', async (req, res, next) => {
  try {
    const workspace = await getWorkspace(workspaceId(req.params.workspaceId));
    return res.json({ settings: workspace.state.settings, revision: workspace.revision, updatedAt: workspace.updatedAt });
  } catch (error) { return next(error); }
});

app.put('/api/workspaces/:workspaceId/settings', async (req, res, next) => {
  try {
    const id = workspaceId(req.params.workspaceId);
    if (!id || !req.body.settings || typeof req.body.settings !== 'object' || Array.isArray(req.body.settings)) return res.status(400).json({ error: 'Valid settings are required.' });
    const workspace = await getWorkspace(id);
    const state = normaliseState(structuredClone(workspace.state));
    state.settings = { ...state.settings, ...req.body.settings };
    const updated = await saveState(workspace, state);
    return res.json({ ok: true, settings: updated.state.settings, revision: updated.revision, updatedAt: updated.updatedAt });
  } catch (error) { return next(error); }
});

app.get('/api/workspaces/:workspaceId/:resource', async (req, res, next) => {
  try {
    const resource = req.params.resource;
    if (!resources.has(resource)) return res.status(404).json({ error: 'Unknown ERP resource.' });
    const workspace = await getWorkspace(workspaceId(req.params.workspaceId));
    const state = normaliseState(workspace.state);
    return res.json({ [resource]: state[resource], revision: workspace.revision, updatedAt: workspace.updatedAt });
  } catch (error) { return next(error); }
});

app.post('/api/workspaces/:workspaceId/:resource', async (req, res, next) => {
  try {
    const id = workspaceId(req.params.workspaceId), resource = req.params.resource;
    if (!id || !resources.has(resource)) return res.status(404).json({ error: 'Unknown ERP resource.' });
    const error = validateRecord(resource, req.body.record);
    if (error) return res.status(400).json({ error });
    const workspace = await getWorkspace(id);
    const state = normaliseState(structuredClone(workspace.state));
    const record = { ...req.body.record, id: recordId(req.body.record.id) || randomUUID() };
    if (state[resource].some(item => item.id === record.id)) return res.status(409).json({ error: 'A record with this id already exists.' });
    state[resource].push(record);
    const updated = await saveState(workspace, state);
    return res.status(201).json({ record, revision: updated.revision, updatedAt: updated.updatedAt });
  } catch (error) { return next(error); }
});

app.get('/api/workspaces/:workspaceId/:resource/:recordId', async (req, res, next) => {
  try {
    const { resource } = req.params;
    if (!resources.has(resource)) return res.status(404).json({ error: 'Unknown ERP resource.' });
    const workspace = await getWorkspace(workspaceId(req.params.workspaceId));
    const record = normaliseState(workspace.state)[resource].find(item => item.id === req.params.recordId);
    if (!record) return res.status(404).json({ error: 'Record not found.' });
    return res.json({ record, revision: workspace.revision, updatedAt: workspace.updatedAt });
  } catch (error) { return next(error); }
});

app.put('/api/workspaces/:workspaceId/:resource/:recordId', async (req, res, next) => {
  try {
    const id = workspaceId(req.params.workspaceId), { resource, recordId: idValue } = req.params;
    if (!id || !resources.has(resource) || !recordId(idValue)) return res.status(404).json({ error: 'Unknown ERP resource.' });
    const error = validateRecord(resource, req.body.record);
    if (error) return res.status(400).json({ error });
    const workspace = await getWorkspace(id);
    const state = normaliseState(structuredClone(workspace.state));
    const index = state[resource].findIndex(item => item.id === idValue);
    if (index < 0) return res.status(404).json({ error: 'Record not found.' });
    const record = { ...req.body.record, id: idValue };
    state[resource][index] = record;
    const updated = await saveState(workspace, state);
    return res.json({ record, revision: updated.revision, updatedAt: updated.updatedAt });
  } catch (error) { return next(error); }
});

app.delete('/api/workspaces/:workspaceId/:resource/:recordId', async (req, res, next) => {
  try {
    const id = workspaceId(req.params.workspaceId), { resource, recordId: idValue } = req.params;
    if (!id || !resources.has(resource) || !recordId(idValue)) return res.status(404).json({ error: 'Unknown ERP resource.' });
    const workspace = await getWorkspace(id);
    const state = normaliseState(structuredClone(workspace.state));
    const index = state[resource].findIndex(item => item.id === idValue);
    if (index < 0) return res.status(404).json({ error: 'Record not found.' });
    const [record] = state[resource].splice(index, 1);
    const updated = await saveState(workspace, state);
    return res.json({ ok: true, record, revision: updated.revision, updatedAt: updated.updatedAt });
  } catch (error) { return next(error); }
});

// The ERP frontend and API share one local development address.
app.use(express.static(path.join(__dirname, '..', 'dist')));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'The ERP API could not complete this request.' });
});

async function start() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  app.listen(port, () => console.log(`ERP API listening at http://localhost:${port}`));
}

start().catch(error => { console.error('MongoDB connection failed:', error.message); process.exit(1); });
