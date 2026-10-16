'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const files = [
  'index.html', 'classic.html', 'lead-form.html', 'portal.html', 'privacy-policy.html', 'demo.html',
  'crm-loader.js', 'billing.js', 'crm.js', 'api-sync.js', 'pdf-engine.js', 'document-preview.js', 'proforma-advance.js',
  'client-process-engine.js', 'client-process.js', 'crm-stability.js', 'crm-operations.js', 'crm-priority-fixes.js',
  'client-journey.js', 'project-finance.js', 'delivery-team.js', 'transaction-receipts.js', 'accounts-workspace.js',
  'accounts-ledger-cleanup.js', 'accounting-core.js', 'accounts-dropdowns.js', 'ea360-style.js', 'workflow-stability.js',
  'crm-animations.js', 'mobile-controls.js', 'contracts.js', 'marketing-workspace.js',
  'crm.css', 'style.css', 'demo.css', 'ea360-style.css', 'service-worker.js', 'site.webmanifest',
  'ed-icon-180.png', 'ed-icon-192.png', 'ed-icon-512.png', 'favicon-32.png', 'favicon.svg'
];
const assetFiles = ['eric-rodgers-google-pay-qr.jpeg', 'erics-designs-crm-logo.png', 'gsap.min.js', 'jspdf.umd.min.js', 'payment-received-seal.svg', 'pdf-quotation-logo-clean.png', 'quotation-accepted-seal.svg', 'reference-document-logo.png', 'reference-payment-qr.png'];
fs.mkdirSync(dist, { recursive: true });
for (const name of files) fs.copyFileSync(path.join(root, name), path.join(dist, name));
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
for (const name of assetFiles) fs.copyFileSync(path.join(root, 'assets', name), path.join(dist, 'assets', name));

// Keep deployment output complete for every local script, stylesheet, icon, and
// other file referenced by the HTML entry points. A missing static file can
// leave one deployment with controls that silently never initialize.
const htmlFiles = files.filter(name => name.endsWith('.html'));
const missing = [];
for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map(match => match[1]);
  for (const reference of references) {
    if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(reference)) continue;
    const localPath = decodeURIComponent(reference.split(/[?#]/, 1)[0]).replace(/^\.\//, '');
    if (!localPath) continue;
    if (!fs.existsSync(path.join(root, localPath))) missing.push(`${htmlFile} -> source missing: ${localPath}`);
    if (!fs.existsSync(path.join(dist, localPath))) missing.push(`${htmlFile} -> dist missing: ${localPath}`);
  }
}
if (missing.length) throw new Error(`Deployment asset validation failed:\n${missing.join('\n')}`);
console.log(`Synced ${files.length} application files and ${assetFiles.length} assets to dist.`);
