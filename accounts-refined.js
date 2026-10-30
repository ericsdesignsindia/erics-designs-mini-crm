/* A clear accounting workflow built on the existing CRM ledger and actions. */
(function () {
  const balanceItems = (title, values, note) => `<div class="accounting-balance-item"><span>${esc(title)}</span><strong>${currencySummary(values)}</strong><small>${esc(note)}</small></div>`;

  const setupAction = (value, label) => `<option value="${value}">${esc(label)}</option>`;

  const performanceSummary = (period = today().slice(0, 7)) => {
    const entries = accountLedger().filter(entry => ['Income', 'Expense'].includes(entry.type)
      && (period === 'all' || String(entry.date).slice(0, 7) === period));
    const expenses = entries.filter(entry => entry.type === 'Expense');
    const isOwnerName = value => /(^|[^a-z])(tanishka|erics?)(?=$|[^a-z])/i.test(String(value || '').toLowerCase());
    const isOwnerPayment = entry => {
      const employee = (db.employees || []).find(person => person.id === entry.employeeId);
      const recipients = [employee?.name, entry.employeeName, entry.payee, entry.recipient, entry.counterparty];
      if (recipients.some(isOwnerName)) return true;
      // Existing manual payroll notes often store the recipient after this label.
      const note = String(entry.note || '');
      return /^employee payment\s*[·:-]\s*(?:mr\.?\s*)?(?:tanishka|erics?)(?=$|\s|[·,:-])/i.test(note)
        || /\b(?:profit distribution|owner payment|owner)\s*[·:-]\s*(?:tanishka|erics?)(?=$|\s|[·,:-])/i.test(note);
    };
    const isEmployeePayment = entry => Boolean(entry.employeeId)
      || String(entry.category || '').toLowerCase() === 'payroll'
      || /^employee payment\b/i.test(String(entry.note || ''));
    const income = financeSum(entries.filter(entry => entry.type === 'Income'));
    const ownerPayments = financeSum(expenses.filter(isOwnerPayment));
    const employeePayments = financeSum(expenses.filter(entry => !isOwnerPayment(entry) && isEmployeePayment(entry)));
    const otherExpenses = financeSum(expenses.filter(entry => !isOwnerPayment(entry) && !isEmployeePayment(entry)));
    const profit = {};
    for (const currency of new Set([...Object.keys(income), ...Object.keys(ownerPayments), ...Object.keys(employeePayments), ...Object.keys(otherExpenses)])) {
      profit[currency] = num(income[currency]) - num(employeePayments[currency]) - num(otherExpenses[currency]);
    }
    const details = entries.map(entry => {
      if (entry.type === 'Income') return { ...entry, performanceKind: 'income', affectsProfit: true };
      if (isOwnerPayment(entry)) return { ...entry, performanceKind: 'owner', affectsProfit: false };
      if (isEmployeePayment(entry)) return { ...entry, performanceKind: 'employee', affectsProfit: true };
      return { ...entry, performanceKind: 'other', affectsProfit: true };
    });
    return { income, ownerPayments, employeePayments, otherExpenses, profit, transactionCount: entries.length, details };
  };

  window.accountingPerformanceSummary = performanceSummary;

  const isOwnerLedgerEntry = entry => {
    const employee = (db.employees || []).find(person => person.id === entry.employeeId);
    const recipient = [employee?.name, entry.employeeName, entry.payee, entry.recipient, entry.counterparty].filter(Boolean).join(' ');
    const note = String(entry.note || '');
    return entry.ownerPayment === true
      || /(^|[^a-z])(tanishka|erics?)(?=$|[^a-z])/i.test(recipient)
      || /^employee payment\s*[·:-]\s*(?:mr\.?\s*)?(?:tanishka|erics?)(?=$|\s|[·,:-])/i.test(note)
      || /\b(?:profit distribution|owner payment|owner)\s*[·:-]\s*(?:mr\.?\s*)?(?:tanishka|erics?)(?=$|\s|[·,:-])/i.test(note);
  };
  const originalAccountLedgerRow = accountLedgerRow;
  accountLedgerRow = function (entry) {
    const row = originalAccountLedgerRow(entry);
    return isOwnerLedgerEntry(entry) ? row.replace(/Employee payment/g, 'Owner profit').replace('<b>Payroll</b>', '<b>Owner distribution</b>') : row;
  };

  let activePerformanceDetails = null;
  const performanceDetailConfig = {
    income: { title: 'Income received', note: 'Client invoice payments and other recorded income for this period.', rows: summary => summary.details.filter(entry => entry.performanceKind === 'income') },
    owner: { title: 'Owner profit paid', note: 'Payments to Tanishka and Eric, shown separately and excluded from expenses.', rows: summary => summary.details.filter(entry => entry.performanceKind === 'owner') },
    employee: { title: 'Employee payments', note: 'Payments to team members other than the owners. These reduce the profit estimate.', rows: summary => summary.details.filter(entry => entry.performanceKind === 'employee') },
    other: { title: 'Other expenses', note: 'Business expenses that are not owner distributions or employee payments.', rows: summary => summary.details.filter(entry => entry.performanceKind === 'other') },
    profit: { title: 'Profit before owner payouts', note: 'Income received less employee payments and other expenses. Owner payouts are excluded.', rows: summary => summary.details.filter(entry => entry.affectsProfit) }
  };

  const performanceDetailsHtml = (kind, period) => {
    const config = performanceDetailConfig[kind];
    if (!config) return '';
    const summary = performanceSummary(period);
    const rows = config.rows(summary).map(entry => {
      const employee = (db.employees || []).find(person => person.id === entry.employeeId);
      const recipient = employee?.name || entry.employeeName || entry.payee || entry.recipient || entry.counterparty;
      return recipient && !String(entry.note || '').toLowerCase().includes(String(recipient).toLowerCase())
        ? { ...entry, note: [entry.note, recipient].filter(Boolean).join(' · ') }
        : entry;
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const periodLabel = period === 'all' ? 'all recorded time' : period;
    const ledger = accountLedgerRows(rows).replaceAll('>Open invoice<', '>Edit invoice<');
    return `<section class="accounting-performance-details" aria-live="polite"><div class="dialog-title"><div><div class="eyebrow">PERFORMANCE DETAILS</div><h3>${esc(config.title)}</h3><p class="sub">${esc(config.note)} Showing ${rows.length} transaction${rows.length === 1 ? '' : 's'} for ${esc(periodLabel)}.</p></div><button type="button" class="smallbtn" onclick="window.closeAccountsPerformanceDetails()">Close details</button></div>${kind === 'profit' ? '<p class="accounting-performance-detail-note">Income rows add to profit; employee payments and other expenses subtract from it.</p>' : ''}${ledger}</section>`;
  };

  const performancePanel = (period = today().slice(0, 7)) => {
    const months = [...new Set([today().slice(0, 7), ...accountLedger().map(entry => String(entry.date || '').slice(0, 7)).filter(value => /^\d{4}-\d{2}$/.test(value))])].sort().reverse();
    const summary = performanceSummary(period);
    const options = months.map(value => `<option value="${value}" ${period === value ? 'selected' : ''}>${esc(value)}</option>`).join('');
    return `<div class="dialog-title"><div><div class="eyebrow">INCOME, PAYROLL & PROFIT</div><h2>Business performance</h2><p class="sub">Payments to Tanishka and Eric are recorded as owner profit; payments to other team members are expenses. Select a card to see its transactions.</p></div><label class="accounting-performance-period-label" for="accounts-performance-period">Period<select id="accounts-performance-period" onchange="window.updateAccountsPerformance(this.value)"><option value="all" ${period === 'all' ? 'selected' : ''}>All recorded time</option>${options}</select></label></div><div class="accounting-performance-grid"><button type="button" class="accounting-performance-stat" onclick="window.openAccountsPerformanceDetails('income')"><span>Income received</span><strong>${financeRows(summary.income)}</strong><small>View income details →</small></button><button type="button" class="accounting-performance-stat" onclick="window.openAccountsPerformanceDetails('owner')"><span>Owner profit paid</span><strong>${financeRows(summary.ownerPayments)}</strong><small>View owner payments →</small></button><button type="button" class="accounting-performance-stat" onclick="window.openAccountsPerformanceDetails('employee')"><span>Employee payments</span><strong>${financeRows(summary.employeePayments)}</strong><small>View employee payments →</small></button><button type="button" class="accounting-performance-stat" onclick="window.openAccountsPerformanceDetails('other')"><span>Other expenses</span><strong>${financeRows(summary.otherExpenses)}</strong><small>View expense details →</small></button><button type="button" class="accounting-performance-stat accounting-performance-profit" onclick="window.openAccountsPerformanceDetails('profit')"><span>Profit before owner payouts</span><strong>${financeRows(summary.profit)}</strong><small>View profit calculation →</small></button></div><p class="hint">Cash-basis estimate: income less employee payments and other business expenses. Owner payments are shown separately and do not reduce profit; all expenses are included even if paid outside CRM funds. Unpaid invoices and bills are excluded; this is not an accrual or tax report.</p><div id="accounts-performance-details">${activePerformanceDetails ? performanceDetailsHtml(activePerformanceDetails, period) : ''}</div>`;
  };

  window.updateAccountsPerformance = function (period) {
    const target = document.getElementById('accounts-performance-content');
    if (target) {
      const selectedPeriod = period === 'all' ? 'all' : /^\d{4}-\d{2}$/.test(period) ? period : today().slice(0, 7);
      target.innerHTML = performancePanel(selectedPeriod);
      if (activePerformanceDetails) document.getElementById('accounts-performance-details')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  window.openAccountsPerformanceDetails = function (kind) {
    if (!performanceDetailConfig[kind]) return;
    activePerformanceDetails = kind;
    const select = document.getElementById('accounts-performance-period');
    const target = document.getElementById('accounts-performance-details');
    if (!target) return;
    target.innerHTML = performanceDetailsHtml(kind, select?.value || today().slice(0, 7));
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  window.closeAccountsPerformanceDetails = function () {
    activePerformanceDetails = null;
    const target = document.getElementById('accounts-performance-details');
    if (target) target.innerHTML = '';
  };

  const cashBreakdown = () => {
    const balances = () => ({ INR: 0, AED: 0 });
    const opening = { ...balances(), ...(db.openingBalances || {}) };
    const openingUsed = balances(), income = balances(), operatingUsed = balances(), external = balances();
    for (const entry of accountLedger()) {
      const currency = entry.currency || 'INR';
      const amount = num(entry.amount);
      if (entry.externalPayment) external[currency] = (external[currency] || 0) + amount;
      else if (entry.type === 'Income') income[currency] = (income[currency] || 0) + amount;
      else if (entry.paymentSource === 'Opening balance') openingUsed[currency] = (openingUsed[currency] || 0) + amount;
      else operatingUsed[currency] = (operatingUsed[currency] || 0) + amount;
    }
    const openingAvailable = balances(), operatingAvailable = balances(), available = balances();
    for (const currency of ['INR', 'AED']) {
      openingAvailable[currency] = num(opening[currency]) - num(openingUsed[currency]);
      operatingAvailable[currency] = num(income[currency]) - num(operatingUsed[currency]);
      available[currency] = openingAvailable[currency] + operatingAvailable[currency];
    }
    return { openingAvailable, operatingAvailable, available, external };
  };

  window.runAccountingAction = function (select) {
    const action = select.value;
    select.value = '';
    if (action === 'opening') return showOpeningBalances();
    if (action === 'vendor') return document.getElementById('accounts-vendor-bills')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (action === 'invoices') return nav('Final invoices');
    if (action === 'receipts') return document.getElementById('accounts-transactions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (action === 'reconcile') return window.openAccountsDetails('accounts-reconciliation');
    if (action === 'budgets') return window.openAccountsDetails('accounts-planning');
    if (action === 'export') return exportAccountingReport();
  };

  window.openAccountsDetails = function (id) {
    const details = document.getElementById(id);
    if (details) {
      let parent = details.parentElement;
      while (parent) {
        if (parent.tagName === 'DETAILS') parent.open = true;
        parent = parent.parentElement;
      }
      details.open = true;
      details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  window.openClientInvoiceDues = function () {
    window.openAccountsDetails('accounts-reconciliation');
    document.querySelector('#accounts-reconciliation .collections-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.clearAccountingSummaryFilter = function () {
    const list = document.getElementById('accountRows');
    if (!list) return;
    const search = document.querySelector('#accounts-transactions input[aria-label="Search account records"]');
    if (search) search.value = '';
    const rows = accountLedger().slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    list.innerHTML = accountLedgerRows(rows);
  };

  window.openAccountingSummaryDetails = function (kind) {
    if (kind === 'dues') return window.openClientInvoiceDues();
    if (kind === 'bills') {
      const section = document.getElementById('accounts-vendor-bills');
      if (!section) return;
      const rows = [...section.querySelectorAll('.finance-bill-row')];
      rows.forEach(row => { row.hidden = row.querySelector('.badge')?.textContent.trim() === 'Paid'; });
      let note = document.getElementById('accounts-bills-summary-filter');
      if (!note) {
        note = document.createElement('div');
        note.id = 'accounts-bills-summary-filter';
        note.className = 'accounting-summary-filter-note';
        section.querySelector('.finance-bills')?.before(note);
      }
      const pending = rows.filter(row => !row.hidden).length;
      note.innerHTML = `<span>Showing ${pending} unpaid supplier bill${pending === 1 ? '' : 's'}.</span><button type="button" onclick="window.clearAccountingBillsSummaryFilter()">Show all bills</button>`;
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const type = kind === 'received' ? 'Income' : kind === 'paid' ? 'Expense' : null;
    if (!type) return;
    const month = today().slice(0, 7);
    const entries = accountLedger().filter(entry => !entry.externalPayment && entry.type === type && String(entry.date).slice(0, 7) === month)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const section = document.getElementById('accounts-transactions');
    const list = document.getElementById('accountRows');
    if (!section || !list) return;
    const search = section.querySelector('input[aria-label="Search account records"]');
    if (search) search.value = '';
    const label = kind === 'received' ? 'money received' : 'money paid';
    list.innerHTML = `<div class="accounting-summary-filter-note"><span>Showing ${label} for ${esc(month)} · ${entries.length} transaction${entries.length === 1 ? '' : 's'}.</span><button type="button" onclick="window.clearAccountingSummaryFilter()">Show all transactions</button></div>` + accountLedgerRows(entries);
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.clearAccountingBillsSummaryFilter = function () {
    const section = document.getElementById('accounts-vendor-bills');
    section?.querySelectorAll('.finance-bill-row').forEach(row => { row.hidden = false; });
    document.getElementById('accounts-bills-summary-filter')?.remove();
  };

  accounts = function () {
    const month = today().slice(0, 7);
    const ledger = accountLedger().slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const breakdown = cashBreakdown();
    const businessEntries = ledger.filter(entry => !entry.externalPayment);
    const monthRows = businessEntries.filter(entry => String(entry.date).slice(0, 7) === month);
    const monthIncome = financeSum(monthRows.filter(entry => entry.type === 'Income'));
    const monthExpense = financeSum(monthRows.filter(entry => entry.type === 'Expense'));
    const openInvoices = (db.documents || []).filter(item => item.type === 'Invoice' && !['Draft', 'Cancelled'].includes(item.status) && Number(totals(item).balance || 0) > 0);
    const openProformas = (db.documents || []).filter(item => item.type === 'Proforma'
      && !['Draft', 'Cancelled'].includes(item.status)
      && Number(totals(item).balance || 0) > 0
      && !financeInvoiceForProforma(item));
    const receivables = financeSum([...openInvoices, ...openProformas].map(item => ({ amount: Math.max(0, Number(totals(item).balance || 0)), currency: item.currency || 'INR' })));
    const pendingBills = (db.vendorBills || []).filter(item => item.status !== 'Paid');
    const payables = financeSum(pendingBills);
    const forecast = financeForecast(30);
    const bills = (db.vendorBills || []).slice().sort((a, b) => String(a.due).localeCompare(String(b.due)));
    const billRows = bills.length ? bills.map(item => `<div class="finance-bill-row"><div><b>${esc(item.vendor)}</b><small>${esc(item.category)} · Due ${esc(item.due)}${item.note ? ` · ${esc(item.note)}` : ''}</small></div><span class="badge ${item.status === 'Paid' ? 'Paid' : item.status === 'Approved' ? 'Sent' : 'Overdue'}">${esc(item.status)}</span><b>${currencySymbol(item.currency)}${num(item.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b><div class="actions">${item.status !== 'Paid' ? `<button class="smallbtn" onclick="editVendorBill('${esc(item.id)}')">Edit</button><button class="smallbtn" onclick="markVendorBillPaid('${esc(item.id)}')">Record payment</button>` : '<span class="sub">Payment recorded</span>'}</div></div>`).join('') : '<div class="empty"><h2>No supplier bills yet</h2><p>Add a vendor bill to track a business payment that is due.</p></div>';
    const hasDeficit = ['INR', 'AED'].some(currency => num(breakdown.available[currency]) < 0);
    const cashClass = hasDeficit ? 'accounting-cash-card has-deficit' : 'accounting-cash-card';

    const header = pageHeader('Accounts · Cash and commitments.', '<button onclick="exportAccounts()">Export transactions</button><button class="primary" onclick="editAccount(\'expense\')">Record expense</button>', 'A clear place to record money, follow what is due, and review every transaction.');

    return header + `
      <nav class="accounting-section-nav" aria-label="Accounts sections">
        <a href="#accounts-overview">Overview</a><a href="#accounts-workflow">Record money</a><a href="#accounts-performance">Performance</a><a href="#accounts-vendor-bills">Bills to pay</a><a href="#accounts-transactions">Transactions</a><a href="#accounts-more">Accounting tools</a>
      </nav>
      <section class="panel accounting-cash-panel" id="accounts-overview">
        <div class="accounting-cash-heading"><div><div class="eyebrow">BUSINESS CASH AVAILABLE</div><h2 class="${hasDeficit ? 'accounting-deficit' : ''}">${currencySummary(breakdown.available)}</h2><p class="sub">Opening funds + income recorded in Accounts − payments made from CRM funds.</p></div><button onclick="showOpeningBalances()">Set opening funds</button></div>
        <div class="accounting-balance-grid">${balanceItems('Opening funds remaining', breakdown.openingAvailable, 'Starting cash not yet spent')}${balanceItems('Operating funds remaining', breakdown.operatingAvailable, 'Recorded income less operating payments')}${balanceItems('Paid outside the business account', breakdown.external, 'Reference only; excluded from business cash')}</div>
        <p class="hint">Record an opening balance only for money that was already in the business when you started using this ledger. A negative amount means recorded CRM-funded payments exceed recorded funds.</p>
      </section>
      <section class="panel accounting-workflow-panel" id="accounts-workflow">
        <div><div class="eyebrow">WHAT ARE YOU RECORDING?</div><h2>Choose the matching task</h2><p class="sub">Client invoice payments belong on the invoice. Use “Other income” only for money not tied to an invoice.</p></div>
        <div class="accounting-workflow-grid">
          <article><span class="accounting-step">01 · MONEY IN</span><h3>Client payment</h3><p>Save payments to the document so its balance stays accurate. Use other income for money unrelated to an invoice.</p><div class="actions"><button onclick="nav('Final invoices')">Final invoice payment</button><button onclick="nav('Proforma invoices')">Proforma advance</button><button class="quiet-action" onclick="editAccount('income')">Record other income</button></div></article>
          <article><span class="accounting-step">02 · MONEY OUT</span><h3>Business payment</h3><p>Record a direct expense, employee payment, or supplier bill with the correct funding source.</p><div class="actions"><button onclick="editAccount('expense')">Record expense</button><button onclick="payEmployee()">Pay employee</button><button onclick="editVendorBill()">Add vendor bill</button></div></article>
          <article><span class="accounting-step">03 · REVIEW</span><h3>Check and match</h3><p>Search the cash book, open receipts or vouchers, and match entries against your bank statement.</p><button onclick="document.getElementById('accounts-transactions')?.scrollIntoView({behavior:'smooth',block:'start'})">Review transactions</button><button class="quiet-action" onclick="window.openAccountsDetails('accounts-reconciliation')">Open reconciliation</button></article>
        </div>
        <label class="accounting-tools-label" for="accounts-quick-tools">Other accounting tools</label>
        <select id="accounts-quick-tools" class="smallbtn accounting-tools-menu" aria-label="Other accounting tools" onchange="runAccountingAction(this)"><option value="">Choose a tool…</option>${setupAction('opening', 'Set opening funds')}${setupAction('vendor', 'View vendor bills')}${setupAction('invoices', 'Manage final invoices')}${setupAction('receipts', 'Transaction receipts')}${setupAction('reconcile', 'Bank reconciliation')}${setupAction('budgets', 'Budgets and recurring costs')}${setupAction('export', 'Download accounting report')}</select>
      </section>
      <section class="accounting-metric-grid" aria-label="Accounting summary">
        <button type="button" class="stat accounting-summary-action" onclick="window.openAccountingSummaryDetails('received')" aria-label="View money received this month"><span>Received this month · ${esc(month)}</span><strong>${financeRows(monthIncome)}</strong><small>Invoice payments and other income · View transactions →</small></button>
        <button type="button" class="stat accounting-summary-action" onclick="window.openAccountingSummaryDetails('paid')" aria-label="View payments made this month"><span>Paid this month · ${esc(month)}</span><strong>${financeRows(monthExpense)}</strong><small>Payments made from CRM funds · View transactions →</small></button>
        <button type="button" class="stat accounting-due-stat" onclick="window.openClientInvoiceDues()" aria-label="View unpaid final invoices and pending Proforma advances"><span>Client invoices due</span><strong>${financeRows(receivables)}</strong><small>${openInvoices.length} unpaid final invoice${openInvoices.length === 1 ? '' : 's'} · ${openProformas.length} pending Proforma advance${openProformas.length === 1 ? '' : 's'} · View details →</small></button>
        <button type="button" class="stat accounting-summary-action" onclick="window.openAccountingSummaryDetails('bills')" aria-label="View unpaid supplier bills"><span>Supplier bills due</span><strong>${financeRows(payables)}</strong><small>${pendingBills.length} unpaid vendor bill${pendingBills.length === 1 ? '' : 's'} · View bills →</small></button>
      </section>
      <section class="panel accounting-performance-panel" id="accounts-performance"><div id="accounts-performance-content">${performancePanel(month)}</div></section>
      <section class="panel accounting-forecast-panel"><div><div class="eyebrow">NEXT 30 DAYS</div><h2>Expected cash movement</h2><p class="sub">A planning estimate based on due final invoices, shared Proforma advances, vendor bills, and scheduled expenses.</p></div><div class="accounting-forecast-values"><div><span>Expected collections</span><b>${financeRows(forecast.receivables)}</b><button onclick="nav('Proforma invoices')">Review payment requests</button></div><div><span>Planned payments</span><b>${financeRows(forecast.outgoings)}</b><button onclick="document.getElementById('accounts-vendor-bills')?.scrollIntoView({behavior:'smooth',block:'start'})">Review bills</button></div></div></section>
      <section class="panel" id="accounts-vendor-bills"><div class="dialog-title"><div><div class="eyebrow">SUPPLIER BILLS</div><h2>Bills to manage</h2><p class="sub">Adding a bill records an obligation; use “Record payment” only after you pay it.</p></div><button class="primary" onclick="editVendorBill()">Add vendor bill</button></div><div class="finance-bills">${billRows}</div></section>
      <section class="panel accounting-transactions-panel" id="accounts-transactions"><div class="dialog-title"><div><div class="eyebrow">COMPLETE CASH BOOK</div><h2>All transactions</h2><p class="sub">Use each row’s Actions menu for its receipt or voucher, editing, and related document.</p></div><button onclick="exportAccounts()">Export transactions</button></div><div class="toolbar"><input aria-label="Search account records" placeholder="Search date, client, category, or reference…" oninput="filterAccountRows(this.value)"></div><div id="accountRows">${accountLedgerRows(ledger)}</div></section>
      <details class="panel accounting-more-tools" id="accounts-more"><summary><b>Accounting tools</b><span>Reconciliation, collections, budgets, and recurring costs</span></summary><div class="stack" style="margin-top:18px">
        <details class="panel accounting-tool-group" id="accounts-reconciliation"><summary><b>Bank reconciliation and collections</b><span>Match ledger entries and follow unpaid customer documents</span></summary><div class="stack" style="margin-top:18px">${bankReconciliationPanel()}${accountsCollectionsQueue()}</div></details>
        <details class="panel accounting-tool-group" id="accounts-planning"><summary><b>Budgets and scheduled costs</b><span>Plan spending before it is due</span></summary><div class="stack" style="margin-top:18px"><section class="panel"><div class="dialog-title"><div><div class="eyebrow">MONTHLY BUDGETS</div><h2>${esc(month)} expense budgets</h2></div><button class="smallbtn" onclick="editBudget()">Set a budget</button></div><div class="finance-budget-list">${financeBudgetRows(month)}</div></section><section class="panel"><div class="dialog-title"><div><div class="eyebrow">RECURRING COSTS</div><h2>Scheduled expenses</h2></div><button class="smallbtn" onclick="editRecurringExpense()">Add recurring cost</button></div><div class="finance-compact-list">${(db.recurringExpenses || []).length ? db.recurringExpenses.slice().sort((a, b) => String(a.nextDate).localeCompare(String(b.nextDate))).map(item => `<div><b>${esc(item.name)}</b><span>${currencySymbol(item.currency)}${num(item.amount).toLocaleString('en-IN')} · ${esc(item.frequency)} · Next ${esc(item.nextDate)}</span><button class="smallbtn" onclick="editRecurringExpense('${esc(item.id)}')">Edit</button></div>`).join('') : '<p class="sub">Add rent, software, hosting, salaries, or other repeating costs.</p>'}</div></section></div></details>
      </div></details>`;
  };

  window.__accountsRefined = 'ready';
})();
