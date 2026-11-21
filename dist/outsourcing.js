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
  const engine = window.crmOutsourcing;
  if (!engine || typeof engine.documentCommission !== 'function') {
    console.error('Outsourced services panel disabled: crmOutsourcing engine is missing.');
    return;
  }
  window.__outsourcingInstalled = true;
  const guarded = fn => function () {
    try { return fn.apply(this, arguments); } catch (error) { console.error('Outsourced services panel error', error); }
  };
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

  document.addEventListener('input', guarded(onAppEdit));
  document.addEventListener('change', guarded(onAppEdit));
  // Add/remove line buttons may redraw the items without render() or an input event.
  document.addEventListener('click', guarded(event => {
    const app = document.getElementById('app');
    if (!app || !app.contains(event.target) || event.target.closest('#outsourcingPanel')) return;
    setTimeout(guarded(syncPanel), 0);
  }));

  // Provider bills follow the invoices: sync them inside every save so they land in the same write.
  function syncProviderBillsOnSave() {
    try {
      const result = engine.syncProviderBills(db, { today: today(), totalsFn: totals });
      const messages = [];
      result.created.forEach(bill => messages.push(`Provider bill created: ${bill.vendor} ${money(bill.amount, bill.currency)} (${bill.sourceInvoiceNumber})`));
      result.updated.forEach(change => messages.push(`Provider bill updated: ${change.bill.vendor} ${money(change.from, change.bill.currency)} → ${money(change.to, change.bill.currency)}`));
      if (messages.length && typeof toast === 'function') toast(messages.join(' · '));
    } catch (error) {
      console.error('Provider bill sync failed; saving without it', error);
    }
  }

  if (typeof persist === 'function') {
    const persistBeforeOutsourcing = persist;
    persist = function () {
      syncProviderBillsOnSave();
      return persistBeforeOutsourcing.apply(this, arguments);
    };
  }

  // ---- Accounts report panel ----
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  function billStatus(state, invoiceId, currency) {
    let pending = 0;
    let paid = 0;
    (Array.isArray(state.vendorBills) ? state.vendorBills : []).forEach(bill => {
      if (!bill || bill.autoOutsourced !== true || bill.sourceInvoiceId !== invoiceId) return;
      if (bill.status === 'Paid') paid += Number(bill.amount) || 0;
      else pending += Number(bill.amount) || 0;
    });
    const parts = [];
    if (paid > 0) parts.push(`Paid ${money(round2(paid), currency)}`);
    if (pending > 0) parts.push(`Pending ${money(round2(pending), currency)}`);
    return parts.length ? parts.join(' · ') : 'Not due';
  }

  function buildRows(state, totalsFn) {
    const rows = [];
    const totalsByCurrency = {};
    ((state && state.documents) || []).forEach(doc => {
      if (!doc || doc.type !== 'Invoice' || doc.status === 'Cancelled') return;
      const result = engine.documentCommission(doc);
      if (!result.lines.length) return;
      const ratio = engine.paidRatio(doc, totalsFn);
      const earned = round2(result.commission * ratio);
      const currency = result.currency;
      rows.push({
        id: doc.id,
        number: doc.number || '',
        client: (doc.client && doc.client.name) || '',
        currency,
        price: result.revenue,
        cost: result.cost,
        commission: result.commission,
        paidPercent: Math.round(ratio * 100),
        earned,
        billStatus: billStatus(state, doc.id, currency)
      });
      const t = totalsByCurrency[currency] || (totalsByCurrency[currency] = { price: 0, cost: 0, commission: 0, earned: 0 });
      t.price = round2(t.price + result.revenue);
      t.cost = round2(t.cost + result.cost);
      t.commission = round2(t.commission + result.commission);
      t.earned = round2(t.earned + earned);
    });
    return { rows, totals: totalsByCurrency };
  }
  window.crmOutsourcingReport = { buildRows };

  function reportHtml(report) {
    if (!report.rows.length) {
      return `<div class="panel-head"><h3>Outsourced services &amp; commission</h3></div>
        <p class="sub">No outsourced services yet. Tick “Outsourced” on a document line to track provider costs and your commission.</p>`;
    }
    const body = report.rows.map(r => `<tr>
        <td data-label="Client">${esc(r.client)}</td>
        <td data-label="Invoice"><button type="button" class="linklike" data-os-open="${esc(r.id)}">${esc(r.number)}</button></td>
        <td data-label="Client price" class="num">${esc(money(r.price, r.currency))}</td>
        <td data-label="Provider cost" class="num">${esc(money(r.cost, r.currency))}</td>
        <td data-label="Commission" class="num${r.commission < 0 ? ' is-loss' : ''}">${esc(commissionText(r.commission, r.currency))}</td>
        <td data-label="Client paid">${esc(`Client paid ${r.paidPercent}%`)}</td>
        <td data-label="Provider bill">${esc(r.billStatus)}</td>
      </tr>`).join('');
    const totalLines = Object.keys(report.totals).map(cur => {
      const t = report.totals[cur];
      return `<p class="outsourcing-report-total"><b>${esc(cur)}</b> · Client price ${esc(money(t.price, cur))} · Provider cost ${esc(money(t.cost, cur))} · Commission ${esc(commissionText(t.commission, cur))} · Commission earned so far ${esc(money(t.earned, cur))}</p>`;
    }).join('');
    return `<div class="panel-head"><h3>Outsourced services &amp; commission</h3></div>
      <div class="outsourcing-report-scroll"><table class="outsourcing-report-table">
        <thead><tr><th>Client</th><th>Invoice</th><th>Client price</th><th>Provider cost</th><th>Commission</th><th>Client paid</th><th>Provider bill</th></tr></thead>
        <tbody>${body}</tbody></table></div>
      ${totalLines}`;
  }

  function renderReportPanel() {
    const app = document.getElementById('app');
    let panel = document.getElementById('outsourcingReport');
    const onAccounts = typeof view !== 'undefined' && view === 'Accounts' && !currentDraft();
    if (!onAccounts || !app) {
      if (panel) panel.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement('section');
      panel.className = 'panel outsourcing-report';
      panel.id = 'outsourcingReport';
    }
    panel.innerHTML = reportHtml(buildRows(db, totals));
    const anchor = document.getElementById('accounts-vendor-bills');
    if (anchor && anchor.parentNode) {
      if (anchor.previousElementSibling !== panel) anchor.parentNode.insertBefore(panel, anchor);
    } else if (app.lastElementChild !== panel) {
      app.appendChild(panel);
    }
  }

  document.addEventListener('click', guarded(event => {
    const button = event.target && event.target.closest && event.target.closest('[data-os-open]');
    if (button && typeof openDoc === 'function') openDoc(button.getAttribute('data-os-open'));
  }));

  // One place for everything that runs after each render.
  const afterRender = guarded(function () {
    renderEditorPanel();
    renderReportPanel();
  });

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
