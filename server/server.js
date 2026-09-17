'use strict';

require('dotenv').config();
const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { randomUUID, createCipheriv, createDecipheriv, createHash, randomBytes } = require('crypto');
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
const jwtSecret = process.env.JWT_SECRET || (fs.existsSync(secretFile)
  ? fs.readFileSync(secretFile, 'utf8').trim()
  : (() => { const secret = randomUUID() + randomUUID(); fs.writeFileSync(secretFile, secret, { mode: 0o600 }); return secret; })());

app.use(cors({ origin(origin, callback) {
  if (!origin || origins.includes(origin)) return callback(null, true);
  return callback(new Error('Origin is not allowed by this local ERP API.'));
}}));
app.use(express.json({ limit: '5mb' }));

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
  return updated;
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
async function driveFolder(token, name, parentId) { const safeName = String(name).replace(/'/g, "\\'"); const parent = parentId ? ` and '${parentId}' in parents` : ''; const query = `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parent}`; const found = await driveRequest(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`); if (found.files?.[0]) return found.files[0].id; const created = await driveRequest(token, 'https://www.googleapis.com/drive/v3/files?fields=id,name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }) }); return created.id; }

function validCredentials(username, password) {
  if (!/^[a-z0-9._-]{3,60}$/i.test(String(username || ''))) return 'Use 3â€“60 letters, numbers, dots, underscores, or hyphens for the username.';
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

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'erics-designs-erp-api', database: mongoose.connection.readyState === 1 ? 'connected' : 'connecting' }));

app.get('/api', (_req, res) => res.json({
  service: 'erics-designs-erp-api',
  resources: ['overview', 'settings', ...resources],
  workspaceRoutes: '/api/workspaces/:workspaceId'
}));

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
    const user = await User.create({ username, passwordHash: await bcrypt.hash(req.body.password, 12), role: 'admin' });
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

app.get('/api/admin/users', requireAuth, async (_req, res, next) => { try { const users = await User.find({}, { username: 1, role: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean(); return res.json({ users: users.map(user => ({ id: user._id.toString(), username: user.username, role: user.role, createdAt: user.createdAt })) }); } catch (error) { return next(error); } });
app.post('/api/admin/users', requireAuth, async (req, res, next) => { try { const username = String(req.body.username || '').trim().toLowerCase(); const error = validCredentials(username, req.body.password); if (error) return res.status(400).json({ error }); if (await User.exists({ username })) return res.status(409).json({ error: 'That username is already in use.' }); const user = await User.create({ username, passwordHash: await bcrypt.hash(req.body.password, 12), role: 'admin' }); return res.status(201).json({ user: { id: user._id.toString(), username: user.username, role: user.role, createdAt: user.createdAt } }); } catch (error) { return next(error); } });
app.put('/api/admin/users/:userId/password', requireAuth, async (req, res, next) => {
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
app.get('/api/integrations/google-drive/status', requireAuth, async (req, res, next) => {
  try {
    const config = googleDriveConfig();
    const integration = await DriveIntegration.findOne({ userId: req.user.sub }).lean();
    return res.json({ configured: config.configured, connected: Boolean(integration), accountEmail: integration?.accountEmail || null, redirectUri: config.redirectUri });
  } catch (error) { return next(error); }
});

app.post('/api/integrations/google-drive/connect', requireAuth, async (req, res, next) => {
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
    return done('connected', 'Google Drive is connected to Eric’s Designs CRM.');
  } catch (error) { return done('error', 'Google Drive could not be connected. Please try again.'); }
});

app.delete('/api/integrations/google-drive', requireAuth, async (req, res, next) => {
  try { await DriveIntegration.deleteOne({ userId: req.user.sub }); return res.json({ ok: true }); }
  catch (error) { return next(error); }
});

app.post('/api/integrations/google-drive/attachments', requireAuth, async (req, res, next) => {
  try { const name = String(req.body.name || '').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 150); const clientName = String(req.body.clientName || 'Unassigned client').trim().slice(0, 120); const mimeType = String(req.body.mimeType || 'application/octet-stream').slice(0, 120); const content = String(req.body.base64 || '').replace(/^data:[^;]+;base64,/, ''); if (!name || !content) return res.status(400).json({ error: 'Choose a file to upload.' }); const bytes = Buffer.from(content, 'base64'); if (!bytes.length || bytes.length > 4 * 1024 * 1024) return res.status(400).json({ error: 'Files must be smaller than 4 MB.' }); const token = await driveAccessToken(req.user.sub); const rootId = await driveFolder(token, "Eric's Designs CRM"); const clientId = await driveFolder(token, clientName, rootId); const boundary = `crm-${randomUUID()}`; const metadata = Buffer.from(JSON.stringify({ name, mimeType, parents: [clientId] }), 'utf8'); const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`), metadata, Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]); const file = await driveRequest(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,createdTime,size', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }); return res.status(201).json({ attachment: { id: file.id, name: file.name, mimeType: file.mimeType, url: file.webViewLink || `https://drive.google.com/open?id=${file.id}`, createdAt: file.createdTime, size: Number(file.size || bytes.length) } }); }
  catch (error) { return next(error); }
});

app.post('/api/ai/draft', requireAuth, async (req, res, next) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'AI drafting is not configured.' });
    const mode = String(req.body.mode || 'Quotation draft').slice(0, 80);
    const brief = String(req.body.brief || '').trim().slice(0, 12000);
    const context = String(req.body.context || '').slice(0, 16000);
    if (!brief) return res.status(400).json({ error: 'Add a brief before generating a draft.' });
    const prompt = `You write professional drafts for Eric's Designs, a creative and digital agency. Task: ${mode}. Use only the reference context below. Do not invent prices, promises, credentials, payment details, or deadlines. Flag missing details as questions. Return clear client-ready text.\n\nBRIEF\n${brief}\n\nREFERENCE CONTEXT\n${context}`;
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1-mini', input: prompt }) });
    const body = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: body?.error?.message || 'AI draft request failed.' });
    const text = body.output_text || body.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('') || '';
    return res.json({ text });
  } catch (error) { return next(error); }
});
app.use('/api/workspaces', requireAuth);

app.get('/api/workspaces/:workspaceId/backups', async (req, res, next) => {
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
