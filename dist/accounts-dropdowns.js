/* Compact Accounts controls into dropdown menus while keeping every action available. */
(function(){
  const actionOption=(value,label)=>`<option value="${value}">${label}</option>`;
  window.runAccountingAction=function(select){
    const action=select.value;select.value='';
    if(action==='income')return editAccount('income');
    if(action==='expense')return editAccount('expense');
    if(action==='employee')return payEmployee();
    if(action==='vendor')return editVendorBill();
    if(action==='opening')return showOpeningBalances();
    if(action==='invoices')return nav('Final invoices');
    if(action==='receipts')return document.getElementById('accountRows')?.scrollIntoView({behavior:'smooth',block:'start'});
    if(action==='export')return exportAccounts();
  };
  window.runLedgerAction=function(select,id){
    const action=select.value;select.value='';if(!action)return;
    if(action==='open'||action==='edit')return editReceiptTransaction(id);
    if(action==='receipt')return downloadTransactionReceipt(id);
    if(action==='edit-receipt')return editTransactionReceipt(id);
    if(action==='delete'){const entry=(db.accounts||[]).find(item=>item.id===id);if(entry)return deleteAccount(id);}
  };
  const compactLedgerRow=row=>{
    const currency=row.currency||'INR',amount=currencySymbol(currency)+Number(row.amount||0).toLocaleString(currency==='AED'?'en-AE':'en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
    const sourceLabel=row.source==='invoice'?'Invoice payment':row.source==='proforma'?'Proforma advance':row.source==='vendor'?'Vendor bill':row.employeeId?'Employee payment':'Manual entry';
    const funds=row.externalPayment?'External payment':row.paymentSource||'Operating balance';
    const documentRow=row.source==='invoice'||row.source==='proforma',manualRow=!documentRow&&row.source!=='vendor';
    const menu=['<option value="">Actions</option>',documentRow?actionOption('open','Open related document'):manualRow?actionOption('edit','Edit transaction'):actionOption('edit','Edit vendor bill'),actionOption('receipt',row.type==='Income'?'Download receipt':'Download voucher'),actionOption('edit-receipt',row.type==='Income'?'Edit receipt':'Edit voucher'),manualRow?actionOption('delete','Delete transaction'):''].join('');
    return `<tr><td>${esc(row.date)}</td><td><span class="badge ${row.type==='Income'?'Paid':'Overdue'}">${esc(row.type)}</span></td><td><b>${esc(row.category)}</b></td><td>${esc(row.note||'—')}</td><td class="right"><b>${amount}</b></td><td><span class="badge ${row.source==='manual'?'Draft':'Sent'}">${sourceLabel}</span></td><td>${esc(funds)}<small>${esc(row.paymentMode||'—')}</small></td><td><button class="smallbtn ${isReconciled(row)?'reconciled-button':''}" onclick="toggleReconciliation('${esc(row.id)}')">${isReconciled(row)?'Matched ✓':'Match'}</button></td><td><select class="smallbtn ledger-actions-select" aria-label="Actions for ${esc(row.note||row.category)}" onchange="runLedgerAction(this,'${esc(row.id)}')">${menu}</select></td></tr>`;
  };
  accountLedgerRow=compactLedgerRow;
  const accountRowsBeforeCompact=accountLedgerRows;
  accountLedgerRows=function(rows){return accountRowsBeforeCompact(rows)};
  const accountsBeforeCompact=accounts;
  accounts=function(){
    let page=accountsBeforeCompact();
    const compactControls=`<section class="panel finance-actions-panel"><div class="dialog-title"><div><div class="eyebrow">FINANCE ACTIONS</div><h2>Manage transactions</h2><p class="sub">Record daily money movement, then use the menu for setup, documents, receipts, and exports.</p></div><div class="actions"><button class="primary" onclick="editAccount('income')">Record income</button><button onclick="editAccount('expense')">Record expense</button><button onclick="payEmployee()">Pay employee</button><select class="smallbtn" aria-label="More accounting actions" onchange="runAccountingAction(this)"><option value="">More actions</option>${actionOption('vendor','Add vendor bill')}${actionOption('opening','Set opening balance')}${actionOption('invoices','Final invoices')}${actionOption('receipts','Transaction receipts')}${actionOption('export','Export transactions')}</select></div></div></section>`;
    page=page.replace(/<section class="panel finance-actions-panel">[\s\S]*?<\/section>/,compactControls);
    return page;
  };
})();
