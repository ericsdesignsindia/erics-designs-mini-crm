/* Clear, complete Accounts workspace controls. */
(function () {
  const accountsBase = accounts;
  accounts = function () {
    let page = accountsBase();
    const financeActions = `<section class="panel finance-actions-panel"><div><div class="eyebrow">FINANCE ACTIONS</div><h2>Manage every transaction</h2><p class="sub">Use these controls for income, expenses, staff payments, vendor bills, balances, invoices, and exports. The transaction list below includes every recorded entry.</p></div><div class="finance-action-groups"><div><span>Record money</span><div class="actions"><button class="primary" onclick="editAccount('income')">Record income</button><button onclick="editAccount('expense')">Record expense</button><button onclick="payEmployee()">Pay employee</button></div></div><div><span>Manage records</span><div class="actions"><button onclick="editVendorBill()">Add vendor bill</button><button onclick="showOpeningBalances()">Set opening balance</button><button onclick="nav('Final invoices')">Final invoices</button><button onclick="exportAccounts()">Export transactions</button></div></div></div></section>`;
    page = page.replace(/<div class="actions"><button onclick="showOpeningBalances\(\)">Set opening balance<\/button><button onclick="editAccount\('income'\)">Record income<\/button><button onclick="payEmployee\(\)">Pay employee<\/button><\/div>/, '<p class="finance-summary-note">Use Finance actions below to record money, pay people, and manage bills.</p>');
    page = page.replace(/(<div class="eyebrow">AVAILABLE BUSINESS FUNDS<\/div><h2>)-([^<]+)(<\/h2>)/, '$1Cash deficit · $2$3');
    page = page.replace('Opening balance plus business income, less payments made from those funds.', 'Payments recorded in CRM are higher than recorded funds. Add an opening balance or record income if money is available outside the ledger.');
    page = page.replace(/<span>Operating balance<\/span><strong>-([^<]+)<\/strong>/, '<span>Cash position</span><strong>Deficit · $1</strong>');
    return page.replace('</section><div class="stats three">', `</section>${financeActions}<div class="stats three">`);
  };
  window.__accountsWorkspace = 'ready';
})();
