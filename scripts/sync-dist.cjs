'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const files = [
  'index.html', 'classic.html', 'lead-form.html', 'portal.html', 'privacy-policy.html', 'demo.html',
  'billing.js', 'crm.js', 'api-sync.js', 'pdf-engine.js', 'document-preview.js', 'proforma-advance.js',
  'client-process-engine.js', 'client-process.js', 'crm-stability.js', 'crm-operations.js', 'crm-priority-fixes.js',
  'client-journey.js', 'project-finance.js', 'delivery-team.js', 'transaction-receipts.js', 'accounts-workspace.js',
  'accounts-ledger-cleanup.js', 'accounting-core.js', 'accounts-dropdowns.js', 'ea360-style.js', 'workflow-stability.js',
  'crm.css', 'style.css', 'demo.css', 'ea360-style.css', 'service-worker.js', 'site.webmanifest',
  'ed-icon-180.png', 'ed-icon-192.png', 'ed-icon-512.png', 'favicon-32.png', 'favicon.svg'
];
const assetFiles = ['eric-rodgers-google-pay-qr.jpeg', 'erics-designs-crm-logo.png', 'jspdf.umd.min.js', 'payment-received-seal.svg', 'pdf-quotation-logo-clean.png', 'quotation-accepted-seal.svg', 'reference-document-logo.png', 'reference-payment-qr.png'];
fs.mkdirSync(dist, { recursive: true });
for (const name of files) fs.copyFileSync(path.join(root, name), path.join(dist, name));
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
for (const name of assetFiles) fs.copyFileSync(path.join(root, 'assets', name), path.join(dist, 'assets', name));
console.log(`Synced ${files.length} application files and ${assetFiles.length} assets to dist.`);
