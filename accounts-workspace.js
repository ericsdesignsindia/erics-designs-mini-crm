/* Clear, complete Accounts workspace controls. */
(function () {
  const accountsBase = accounts;
  accounts = function () {
    const page = accountsBase();
    const financeActions = `<section class="panel finance-actions-panel"><div><div class="eyebrow">FINANCE ACTIONS</div><h2>Record and manage money</h2><p class="sub">Choose the task you want to complete. Invoice payments are recorded inside the related final invoice.</p></div><div class="finance-action-groups"><div><span>Money in and out</span><div class="actions"><button class="primary" onclick="editAccount('income')">Record income</button><button onclick="editAccount('expense')">Record expense</button><button onclick="payEmployee()">Pay employee</button></div></div><div><span>Setup and follow-up</span><div class="actions"><button onclick="editVendorBill()">Add vendor bill</button><button onclick="showOpeningBalances()">Set opening balance</button><button onclick="nav('Final invoices')">Final invoices</button><button onclick="exportAccounts()">Export transactions</button></div></div></div></section>`;
    return page.replace('</section><div class="stats three">', `</section>${financeActions}<div class="stats three">`);
  };
  window.__accountsWorkspace = 'ready';
})();
