/* Stable Accounts ledger and balance display. */
(function () {
  function amountText(value, currency) {
    const number = Number(value || 0);
    const sign = number < 0 ? '-' : '';
    const formatted = Math.abs(number).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency === 'AED' ? `${sign}AED ${formatted}` : `${sign}₹${formatted}`;
  }

  function cashFromVisibleLedger() {
    const totals = { INR: { opening: 0, income: 0, expense: 0 }, AED: { opening: 0, income: 0, expense: 0 } };
    try {
      if (typeof db !== 'undefined' && db && db.openingBalances) {
        Object.keys(totals).forEach((currency) => {
          totals[currency].opening = Number(db.openingBalances[currency] || 0);
        });
      }
    } catch (_) {}

    const rows = document.querySelectorAll('#accountRows tbody tr');
    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 7) return;
      const type = (cells[1].textContent || '').trim().toLowerCase();
      const amount = (cells[4].textContent || '').trim();
      const source = (cells[6].textContent || '').trim().toLowerCase();
      const currency = /aed/i.test(amount) ? 'AED' : 'INR';
      const value = Number((amount.replace(/[^0-9.\-]/g, '') || '0'));
      if (!value || source === 'external payment') return;
      if (type === 'income') totals[currency].income += value;
      if (type === 'expense') totals[currency].expense += value;
    });
    return totals;
  }

  function totalDisplay(totals, field) {
    const values = ['INR', 'AED'].map((currency) => {
      const data = totals[currency];
      const value = field === 'available'
        ? data.opening + data.income - data.expense
        : field === 'opening'
          ? data.opening
          : data.income - data.expense;
      return { currency, value };
    });
    const active = values.filter(({ value }) => Math.abs(value) > 0.0001);
    return (active.length ? active : [values[0]]).map(({ currency, value }) => amountText(value, currency)).join(' · ');
  }

  function setPanelValue(label, text) {
    const labels = Array.from(document.querySelectorAll('.stat span, .stat .muted, .stat p, .stat h3'));
    const labelNode = labels.find((node) => node.textContent.trim() === label);
    if (!labelNode) return;
    const panel = labelNode.closest('.stat');
    if (!panel) return;
    const valueNode = panel.querySelector('strong, h2, h3');
    if (valueNode) valueNode.textContent = text;
  }

  function patchCashSummary() {
    if (!document.querySelector('#accountRows tbody')) return;
    const totals = cashFromVisibleLedger();
    setPanelValue('Opening balance available', totalDisplay(totals, 'opening'));
    setPanelValue('Operating balance', totalDisplay(totals, 'operating'));

    const heading = Array.from(document.querySelectorAll('.eyebrow')).find((node) => node.textContent.trim() === 'AVAILABLE BUSINESS FUNDS');
    const panel = heading && heading.closest('.panel');
    const valueNode = panel && panel.querySelector('h2, strong');
    if (valueNode) valueNode.textContent = totalDisplay(totals, 'available');
    const description = panel && Array.from(panel.querySelectorAll('p, .muted')).find((node) => /Opening balance plus business income/i.test(node.textContent));
    if (description) description.textContent = 'Opening balance plus recorded income, less payments made from those funds.';
  }

  const baseLedgerRows = accountLedgerRows;
  accountLedgerRows = function (rows) {
    const table = baseLedgerRows(rows).replace('<th></th>', '<th class="right">Actions</th>');
    if (!rows.length) return table;
    return table.replace(/<td>(.*?)<\/td>(<\/tr>)/gs, (cell, content, end) => {
      if (!/smallbtn|Receipt PDF|Edit receipt|Edit transaction/.test(content)) return cell;
      if (content.trim() === '—') return cell;
      return `<td class="ledger-actions-cell"><details class="ledger-menu"><summary>Actions</summary><div class="ledger-actions">${content}</div></details>${end}`;
    });
  };

  const app = document.getElementById('app');
  if (app && window.MutationObserver) {
    new MutationObserver(() => setTimeout(patchCashSummary, 0)).observe(app, { childList: true, subtree: true });
  }
  setTimeout(patchCashSummary, 80);
  window.__crmPriorityFixes = 'ready';
})();



