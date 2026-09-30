/* Priority CRM guardrails: clear ledger columns, receipt identity, audit visibility, and mobile access. */
(function(){
  accountLedgerRows=function(rows){
    if(!rows?.length)return '<p class="sub">No transactions found.</p>';
    const body=rows.map(row=>{
      const currency=row.currency||'INR';
      const amount=currencySymbol(currency)+Number(row.amount||0).toLocaleString(currency==='AED'?'en-AE':'en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
      const sourceLabel=row.source==='invoice'?'Invoice payment':row.source==='proforma'?'Proforma advance':row.source==='vendor'?'Vendor bill':row.employeeId?'Employee payment':'Manual entry';
      const funds=row.externalPayment?'External payment':row.paymentSource||'Operating balance';
      const mode=row.paymentMode||'—';
      const matched=isReconciled(row);
      const renderedRow=accountLedgerRow(row),actionStart=renderedRow.lastIndexOf('<td>'),actionEnd=renderedRow.lastIndexOf('</td></tr>');
      const rawActions=actionStart>=0&&actionEnd>actionStart?renderedRow.slice(actionStart+4,actionEnd):'';
      const actionMarkup=rawActions.replace(/^\s*—\s*/,'').trim()||'<span class="ledger-empty">—</span>';
      return `<tr><td>${esc(row.date)}</td><td><span class="badge ${row.type==='Income'?'Paid':'Overdue'}">${esc(row.type)}</span></td><td><b>${esc(row.category)}</b></td><td>${esc(row.note||'—')}</td><td class="right"><b>${amount}</b></td><td><span class="badge ${row.source==='manual'?'Draft':'Sent'}">${sourceLabel}</span></td><td>${esc(funds)}</td><td>${esc(mode)}</td><td><button class="smallbtn ${matched?'reconciled-button':''}" onclick="toggleReconciliation('${esc(row.id)}')">${matched?'Matched ✓':'Match'}</button></td><td><div class="ledger-actions">${actionMarkup}</div></td></tr>`;
    }).join('');
    return `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Reference / note</th><th class="right">Amount</th><th>Record</th><th>Funding source</th><th>Payment method</th><th>Bank</th><th>Actions</th></tr></thead><tbody>${body}</tbody></table></div>`;
  };

  const originalReports=reports;
  reports=function(){
    const page=originalReports();
    const note='<section class="panel currency-note"><div class="eyebrow">CURRENCY POLICY</div><h2>Figures stay in their recorded currency.</h2><p class="sub">INR and AED are shown separately. The CRM does not combine them into one total unless you record an exchange rate.</p></section>';
    return page+note;
  };

  const originalAccounts=accounts;
  accounts=function(){
    const page=originalAccounts();
    const activity=(db.activity||[]).slice(0,12);
    const audit=`<section class="panel audit-panel"><div class="dialog-title"><div><div class="eyebrow">ACTIVITY LOG</div><h2>Recent CRM changes</h2><p class="sub">Changes to documents, payments, receipts, projects, and accounts are recorded here.</p></div></div><div class="audit-list">${activity.length?activity.map(item=>`<div><span>${esc(new Date(item.date).toLocaleString('en-IN'))}</span><b>${esc(item.message)}</b></div>`).join(''):'<p class="sub">No changes recorded yet.</p>'}</div></section>`;
    return page+audit;
  };

  const immediatePayment=addPayment;
  addPayment=function(){
    if(!draft)return;
    const amount=num(document.getElementById('payAmount')?.value),date=document.getElementById('payDate')?.value,reference=(document.getElementById('payRef')?.value||'').trim();
    const duplicate=(draft.payments||[]).some(payment=>String(payment.date)===String(date)&&Number(payment.amount)===Number(amount)&&String(payment.reference||'').trim()===reference);
    if(duplicate){toast('This payment is already recorded. Edit the existing payment instead.');return;}
    return immediatePayment();
  };

  const existingReceiptSave=window.saveTransactionReceipt;
  window.saveTransactionReceipt=async function(id,download){
    const enteredNumber=val('transaction-receipt-number')?.trim();
    const receiptNumbers=[],row=accountLedger().find(item=>item.id===id),ownIds=new Set([id]);
    if(row?.vendorBillId)ownIds.add(row.vendorBillId);
    if(row&&(row.source==='invoice'||row.source==='proforma')){
      const document=(db.documents||[]).find(item=>item.id===(row.invoiceId||row.proformaId));
      const payment=(document?.payments||[]).find(item=>String(item.date)===String(row.date)&&Number(item.amount)===Number(row.amount));
      if(payment?.id)ownIds.add(payment.id);
    }
    for(const document of db.documents||[])for(const payment of document.payments||[])if(payment.receipt?.number)receiptNumbers.push({number:payment.receipt.number,id:payment.id});
    for(const entry of db.accounts||[])if(entry.receipt?.number)receiptNumbers.push({number:entry.receipt.number,id:entry.id});
    for(const bill of db.vendorBills||[])if(bill.receipt?.number)receiptNumbers.push({number:bill.receipt.number,id:bill.id});
    if(enteredNumber&&receiptNumbers.some(item=>item.number===enteredNumber&&!ownIds.has(item.id))){document.getElementById('recordError').textContent='This receipt number is already used. Use a unique receipt number.';return;}
    return existingReceiptSave(id,download);
  };

  const addCalendarToMobile=()=>{
    const list=document.querySelector('#stableMobileMenu .section-menu');
    if(list&&!list.querySelector('[data-view="Calendar"]')){
      const button=document.createElement('button');button.dataset.view='Calendar';button.textContent='Calendar';
      const reportsButton=list.querySelector('[data-view="Reports"]');reportsButton?list.insertBefore(button,reportsButton):list.append(button);
    }
  };
  document.addEventListener('click',()=>setTimeout(addCalendarToMobile,0),true);
  window.__crmPriorityFixes='ready';
})();
