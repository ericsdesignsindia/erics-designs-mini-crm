'use strict';

/*
 * Additional services billing.
 *
 * When a client asks for extra work beyond the original scope, this builds a
 * separate invoice (or a quotation, when the client should approve first) for
 * just those services. It opens a prefilled draft in the normal document
 * editor: nothing is saved until the person reviews it and presses Save, so
 * numbering, PDFs, sharing and payments all work as they do for any document.
 *
 * The draft is linked to the client and, optionally, to the project or the
 * earlier quotation/invoice it extends (`additionalTo`), and it is billed on
 * its own so it is never counted twice with the original scope.
 */
(function () {
  if (window.__additionalServicesInstalled) return;
  window.__additionalServicesInstalled = true;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = value => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; };
  let customRows = 0;

  function clientById(id) { return (db.clients || []).find(client => client.id === id) || null; }

  function relatedOptions(client) {
    if (!client) return [];
    const docs = typeof clientDocuments === 'function'
      ? clientDocuments(client)
      : (db.documents || []).filter(doc => doc.client?.id === client.id || doc.client?.name?.toLowerCase() === client.name.toLowerCase());
    const projects = (db.projects || []).filter(project => project.clientId === client.id || String(project.client || '').toLowerCase() === client.name.toLowerCase());
    return [
      ...projects.map(project => ({ value: `project:${project.id}`, label: `Project · ${project.name}`, project: project.name })),
      ...docs.filter(doc => doc.status !== 'Cancelled' && doc.type !== 'Proforma')
        .map(doc => ({ value: `doc:${doc.id}`, label: `${doc.type === 'Quotation' ? 'Quotation' : 'Invoice'} · ${doc.number}${doc.project ? ' · ' + doc.project : ''}`, project: doc.project || '', number: doc.number, id: doc.id }))
    ];
  }

  function serviceRows() {
    const services = (db.services || []).filter(service => service && service.name);
    if (!services.length) return '<p class="sub">No saved services yet. Add custom services below.</p>';
    return services.map(service => `<div class="addl-service-row" data-service="${esc(service.id)}">
      <label class="addl-service-pick"><input type="checkbox" class="addl-pick"><span><b>${esc(service.name)}</b>${service.description ? `<small>${esc(service.description)}</small>` : ''}</span></label>
      <label class="addl-num"><span>Qty</span><input type="number" class="addl-qty" min="1" step="1" value="1" aria-label="Quantity for ${esc(service.name)}"></label>
      <label class="addl-num"><span>Rate</span><input type="number" class="addl-rate" min="0" step="0.01" value="${esc(money(service.rate))}" aria-label="Rate for ${esc(service.name)}"></label>
    </div>`).join('');
  }

  function customRow() {
    customRows += 1;
    return `<div class="addl-service-row addl-custom" data-custom="${customRows}">
      <label class="addl-custom-name"><span>Service</span><input class="addl-name" placeholder="e.g. Extra landing page" aria-label="Custom service name"></label>
      <label class="addl-num"><span>Qty</span><input type="number" class="addl-qty" min="1" step="1" value="1" aria-label="Custom service quantity"></label>
      <label class="addl-num"><span>Rate</span><input type="number" class="addl-rate" min="0" step="0.01" value="0" aria-label="Custom service rate"></label>
      <label class="addl-custom-desc"><span>Description (optional)</span><input class="addl-desc" aria-label="Custom service description"></label>
    </div>`;
  }

  function refreshRelated(dialog) {
    const client = clientById(dialog.querySelector('#addl-client').value);
    const select = dialog.querySelector('#addl-related');
    select.innerHTML = '<option value="">Not linked to an earlier project or document</option>' +
      relatedOptions(client).map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('');
  }

  function updateTotal(dialog) {
    let total = 0;
    dialog.querySelectorAll('.addl-service-row').forEach(row => {
      const picked = row.classList.contains('addl-custom') ? row.querySelector('.addl-name').value.trim() : row.querySelector('.addl-pick').checked;
      if (picked) total += money(row.querySelector('.addl-qty').value) * money(row.querySelector('.addl-rate').value);
    });
    dialog.querySelector('#addl-total').textContent = `Subtotal before tax: ₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function collectItems(dialog) {
    const items = [];
    dialog.querySelectorAll('.addl-service-row').forEach(row => {
      const qty = Math.max(1, money(row.querySelector('.addl-qty').value) || 1);
      const rate = money(row.querySelector('.addl-rate').value);
      if (row.classList.contains('addl-custom')) {
        const name = row.querySelector('.addl-name').value.trim();
        if (name) items.push({ name, description: row.querySelector('.addl-desc').value.trim(), qty, rate });
      } else if (row.querySelector('.addl-pick').checked) {
        const service = (db.services || []).find(item => item.id === row.dataset.service);
        if (service) items.push({ name: service.name, description: service.description || '', qty, rate });
      }
    });
    return items;
  }

  function createDraft(dialog) {
    const error = dialog.querySelector('#addl-error');
    const client = clientById(dialog.querySelector('#addl-client').value);
    if (!client) { error.textContent = 'Choose the client who asked for the additional services.'; return; }
    const items = collectItems(dialog);
    if (!items.length) { error.textContent = 'Tick at least one service or add a custom service.'; return; }
    if (items.some(item => !(item.rate > 0))) { error.textContent = 'Enter a rate above zero for every service you are billing.'; return; }
    const type = dialog.querySelector('input[name="addl-type"]:checked')?.value === 'Quotation' ? 'Quotation' : 'Invoice';
    const related = relatedOptions(client).find(option => option.value === dialog.querySelector('#addl-related').value) || null;
    const note = dialog.querySelector('#addl-note').value.trim();

    if (typeof draft !== 'undefined' && draft && !confirm('Discard the unsaved document you are editing and start this one?')) return;
    if (typeof draft !== 'undefined') draft = null;
    dialog.close();
    newDoc(type);
    if (!draft) return;

    draft.client = {
      ...(draft.client || {}),
      id: client.id,
      name: client.name || '',
      contact: client.contact || '',
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || '',
      gstin: client.gstin || ''
    };
    draft.items = items;
    draft.project = related?.project ? `${related.project} — additional services` : 'Additional services';
    // A real priced document for the extra scope: never a rate card, never folded into the original.
    draft.rateCard = false;
    draft.tax = Number(db.settings?.tax ?? draft.tax ?? 0);
    draft.discount = 0;
    draft.additionalServices = true;
    if (related) draft.additionalTo = { kind: related.value.split(':')[0], id: related.value.split(':')[1], label: related.number || related.project };
    const reference = related?.number ? ` They are billed separately from ${related.number}.` : '';
    const intro = `Additional services requested by the client.${reference}${note ? ' ' + note : ''}`;
    draft.terms = `${intro}\n\n${draft.terms || ''}`.trim();
    draft.updated = new Date().toISOString();
    if (typeof render === 'function') render();
    if (typeof toast === 'function') toast(`${type === 'Quotation' ? 'Quotation' : 'Invoice'} draft for additional services is ready. Review it, then press Save.`);
  }

  window.openAdditionalServicesInvoice = function (clientId) {
    if (!(db.clients || []).length) { if (typeof toast === 'function') toast('Add the client first, then bill their additional services.'); return; }
    customRows = 0;
    let dialog = document.getElementById('additionalServicesDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'additionalServicesDialog';
      dialog.className = 'client-form additional-services';
      document.body.append(dialog);
    }
    const preselect = clientId || (typeof selectedClient !== 'undefined' ? selectedClient : '') || '';
    const clients = [...db.clients].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    dialog.innerHTML = `<div class="dialog-title"><div><div class="eyebrow">Extra scope</div><h2>Bill additional services</h2><p class="sub">Create a separate invoice for services the client asked for beyond the original work. You review it in the editor before saving.</p></div><button type="button" aria-label="Close" data-close>×</button></div>
      <form id="additionalServicesForm" novalidate>
        <div class="grid">
          <div class="full"><label for="addl-client">Client</label><select id="addl-client" required><option value="">Choose a client</option>${clients.map(client => `<option value="${esc(client.id)}" ${client.id === preselect ? 'selected' : ''}>${esc(client.name)}</option>`).join('')}</select></div>
          <div class="full"><label for="addl-related">Related to (optional)</label><select id="addl-related"></select></div>
          <fieldset class="full addl-type"><legend>Create</legend>
            <label><input type="radio" name="addl-type" value="Invoice" checked> Invoice — bill the client now</label>
            <label><input type="radio" name="addl-type" value="Quotation"> Quotation — client approves first</label>
          </fieldset>
        </div>
        <h3 class="addl-heading">Services</h3>
        <div class="addl-services">${serviceRows()}</div>
        <div class="addl-custom-list"></div>
        <button type="button" class="smallbtn" data-add-custom>+ Add a custom service</button>
        <div class="full addl-note-wrap"><label for="addl-note">Note on the document (optional)</label><input id="addl-note" placeholder="e.g. Requested on WhatsApp, 17 Nov"></div>
        <p id="addl-total" class="addl-total"></p>
        <p id="addl-error" class="form-error" role="alert"></p>
        <div class="actions"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Create draft</button></div>
      </form>`;
    refreshRelated(dialog);
    updateTotal(dialog);
    dialog.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => dialog.close(); });
    dialog.querySelector('#addl-client').onchange = () => refreshRelated(dialog);
    dialog.querySelector('[data-add-custom]').onclick = () => {
      dialog.querySelector('.addl-custom-list').insertAdjacentHTML('beforeend', customRow());
      dialog.querySelector('.addl-custom-list .addl-custom:last-child .addl-name').focus();
    };
    dialog.addEventListener('input', () => { dialog.querySelector('#addl-error').textContent = ''; updateTotal(dialog); });
    dialog.querySelector('form').onsubmit = event => { event.preventDefault(); createDraft(dialog); };
    if (!dialog.open) dialog.showModal();
  };

  // Entry points: the Documents page header and each client profile header.
  function addEntryButton() {
    if (typeof view === 'undefined' || (typeof draft !== 'undefined' && draft)) return;
    const onDocuments = view === 'Documents';
    const onClient = view === 'Clients' && typeof selectedClient !== 'undefined' && selectedClient;
    if (!onDocuments && !onClient) return;
    const actions = document.querySelector('#app > header .actions');
    if (!actions || actions.querySelector('[data-additional-services]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.additionalServices = '1';
    button.textContent = '+ Additional services';
    button.title = 'Bill services the client asked for beyond the original scope';
    button.onclick = () => window.openAdditionalServicesInvoice(onClient ? selectedClient : '');
    // On a client profile, sit next to "+ Quotation"; on Documents, lead the create buttons.
    const quotation = onClient && [...actions.children].find(item => /\+\s*Quotation/.test(item.textContent));
    if (quotation) quotation.after(button); else actions.prepend(button);
  }

  if (typeof window.render === 'function') {
    const renderBeforeAdditionalServices = window.render;
    window.render = function () {
      const result = renderBeforeAdditionalServices.apply(this, arguments);
      addEntryButton();
      return result;
    };
  }
  document.addEventListener('erp-workspace-loaded', addEntryButton);
  addEntryButton();
})();
