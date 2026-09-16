'use strict';

require('dotenv').config();
const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const port = Number(process.env.PORT || 4000);
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/erics_designs_erp';
const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:4000,http://127.0.0.1:4000,https://ericsdesignsindia.github.io')
  .split(',').map(value => value.trim()).filter(Boolean);
const secretFile = path.join(__dirname, '..', '.auth-secret');
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

function issueToken(user) {
  return jwt.sign({ sub: user._id.toString(), username: user.username, role: user.role }, jwtSecret, { expiresIn: '7d' });
}

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
