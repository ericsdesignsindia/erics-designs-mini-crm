'use strict';

/*
 * Outsourced services: editor panel.
 *
 * Adds an internal "Outsourced services" panel under the document editor. Each
 * line item can be marked as outsourced to a provider at a cost; the panel
 * shows the commission (client price less provider cost). Provider names and
 * costs are stored on the line item (item.outsourced = { provider, cost }) and
 * never appear on the client's PDF.
 */
(function () {
  if (window.__outsourcingInstalled) return;
  window.__outsourcingInstalled = true;

  const engine = window.crmOutsourcing;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  if (typeof financeCategories !== 'undefined' && Array.isArray(financeCategories) && !financeCategories.includes('Outsourced services')) {
    financeCategories.push('Outsourced services');
  }

  function currentDraft() { return typeof draft !== 'undefined' && draft && Array.isArray(draft.items) ? draft : null; }

  function money(value, currency) {
    const n = Number(value) || 0;
    const text = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const symbol = currency === 'AED' ? 'AED ' : '₹';
    return `${n < 0 ? '−' : ''}${symbol}${text}`;
  }

  function commissionText(value, currency) {
    return value < 0 ? `${money(value, currency)} (loss)` : money(value, currency);
  }

  function lineName(item, index) { return String(item.name || '').trim() || `Line ${index + 1}`; }

  function rowHtml(item, index) {
    const o = item.outsourced && typeof item.outsourced === 'object' ? item.outsourced : null;
    const on = !!o;
    const name = lineName(item, index);
    const provider = o && typeof o.provider === 'string' ? o.provider : '';
    const cost = o && o.cost !== undefined && o.cost !== null ? o.cost : '';
    return `<div class="outsourcing-row" data-line="${index}">
      <div class="outsourcing-name"><b data-os-name>${esc(name)}</b></div>
      <label class="outsourcing-check"><input type="checkbox" data-os-on ${on ? 'checked' : ''} aria-label="Outsourced: ${esc(name)}"><span>Outsourced</span></label>
      <label class="outsourcing-field"><span>Provider</span><input type="text" data-os-provider value="${esc(provider)}" placeholder="Provider name" ${on ? '' : 'disabled'} aria-label="Provider name for ${esc(name)}"></label>
      <label class="outsourcing-field"><span>Provider cost</span><input type="number" data-os-cost min="0" step="0.01" inputmode="decimal" value="${esc(cost)}" ${on ? '' : 'disabled'} aria-label="Provider cost for ${esc(name)}"></label>
      <div class="outsourcing-commission" data-os-commission></div>
    </div>`;
  }

  function panelHtml(doc) {
    const rows = doc.items.length ? doc.items.map(rowHtml).join('') : '<p class="sub">Add a line item to mark it as outsourced.</p>';
    return `<div class="panel-head"><h3>Outsourced services</h3></div>
      <p class="sub outsourcing-hint">Provider names and costs are internal. They never appear on the client's PDF.</p>
      <div class="outsourcing-rows">${rows}</div>
      <p class="outsourcing-summary" data-os-summary aria-live="polite"></p>`;
  }

  // Update names, commission figures and summary without touching any input.
  function updateInPlace(panel, doc) {
    const result = engine.documentCommission(doc);
    const byIndex = new Map(result.lines.map(line => [line.index, line]));
    panel.querySelectorAll('.outsourcing-row').forEach(row => {
      const index = Number(row.dataset.line);
      const item = doc.items[index];
      if (!item) return;
      const name = lineName(item, index);
      const nameEl = row.querySelector('[data-os-name]');
      if (nameEl.textContent !== name) nameEl.textContent = name;
      row.querySelector('[data-os-on]').setAttribute('aria-label', `Outsourced: ${name}`);
      row.querySelector('[data-os-provider]').setAttribute('aria-label', `Provider name for ${name}`);
      row.querySelector('[data-os-cost]').setAttribute('aria-label', `Provider cost for ${name}`);
      const out = row.querySelector('[data-os-commission]');
      const line = byIndex.get(index);
      let text = '';
      let negative = false;
      if (line) {
        text = `Commission ${commissionText(line.commission, result.currency)}`;
        negative = line.commission < 0;
      } else if (item.outsourced) {
        text = 'Add a provider name to count this line';
      }
      if (out.textContent !== text) out.textContent = text;
      out.classList.toggle('is-loss', negative);
    });
    const summary = panel.querySelector('[data-os-summary]');
    const cur = result.currency;
    summary.textContent = result.lines.length
      ? `Client price ${money(result.revenue, cur)} · Provider cost ${money(result.cost, cur)} · Commission ${commissionText(result.commission, cur)}`
      : 'No outsourced lines yet.';
    summary.classList.toggle('is-loss', result.commission < 0);
  }

  function renderEditorPanel() {
    const doc = currentDraft();
    const app = document.getElementById('app');
    let panel = document.getElementById('outsourcingPanel');
    if (!doc || !app) {
      if (panel) panel.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement('section');
      panel.className = 'panel outsourcing-panel';
      panel.id = 'outsourcingPanel';
    }
    panel.innerHTML = panelHtml(doc);
    if (app.lastElementChild !== panel) app.appendChild(panel);
    updateInPlace(panel, doc);
  }

  // Keep the panel in step with line-item edits made elsewhere in the editor.
  function syncPanel() {
    const doc = currentDraft();
    const panel = document.getElementById('outsourcingPanel');
    if (!doc || !panel) return;
    const active = document.activeElement;
    const typingInside = panel.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
    if (panel.querySelectorAll('.outsourcing-row').length !== doc.items.length) {
      if (!typingInside) renderEditorPanel();
      return;
    }
    updateInPlace(panel, doc);
  }

  function onPanelEdit(event) {
    const row = event.target.closest('.outsourcing-row');
    const doc = currentDraft();
    if (!row || !doc) return;
    const item = doc.items[Number(row.dataset.line)];
    if (!item) return;
    const on = row.querySelector('[data-os-on]').checked;
    const providerInput = row.querySelector('[data-os-provider]');
    const costInput = row.querySelector('[data-os-cost]');
    providerInput.disabled = !on;
    costInput.disabled = !on;
    if (on) {
      const raw = costInput.value;
      const cost = raw === '' ? 0 : Number(raw);
      item.outsourced = { provider: providerInput.value.trim(), cost: Number.isFinite(cost) && cost >= 0 ? cost : 0 };
    } else {
      delete item.outsourced;
    }
    updateInPlace(row.closest('#outsourcingPanel'), doc);
  }

  function onAppEdit(event) {
    const app = document.getElementById('app');
    if (!app || !app.contains(event.target)) return;
    if (event.target.closest('#outsourcingPanel')) onPanelEdit(event);
    else syncPanel();
  }

  document.addEventListener('input', onAppEdit);
  document.addEventListener('change', onAppEdit);
  // Add/remove line buttons may redraw the items without render() or an input event.
  document.addEventListener('click', event => {
    const app = document.getElementById('app');
    if (!app || !app.contains(event.target) || event.target.closest('#outsourcingPanel')) return;
    setTimeout(syncPanel, 0);
  });

  // One place for everything that runs after each render (Task 4 adds the Accounts panel here).
  function afterRender() {
    renderEditorPanel();
  }

  if (typeof window.render === 'function') {
    const renderBeforeOutsourcing = window.render;
    window.render = function () {
      const result = renderBeforeOutsourcing.apply(this, arguments);
      afterRender();
      return result;
    };
  }
  afterRender();
})();
