/* Core accounting workspace: cash book, receivables, payables, reconciliation, and reports. */
(function(){
  const byCurrency=rows=>{
    const result={};
    for(const row of rows||[]){const key=row.currency||'INR';result[key]=(result[key]||0)+Number(row.amount||0)}
    return result;
  };
  const formatCurrencies=values=>Object.entries(values||{}).filter(([,value])=>Number(value)).map(([currency,value])=>`${currencySymbol(currency)}${Number(value).toLocaleString(currency==='AED'?'en-AE':'en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`).join(' · ')||'₹0.00';
  const difference=(left,right)=>{
    const keys=new Set([...Object.keys(left||{}),...Object.keys(right||{})]);const result={};
    keys.forEach(key=>result[key]=Number(left?.[key]||0)-Number(right?.[key]||0));return result;
  };
  const accountingSnapshot=()=>{
    const ledger=(accountLedger?.()||[]).filter(row=>!row.externalPayment);
    const cashIn=byCurrency(ledger.filter(row=>row.type==='Income'));
    const cashOut=byCurrency(ledger.filter(row=>row.type==='Expense'));
    const openInvoices=(db.documents||[]).filter(document=>document.type==='Invoice'&&document.status!=='Cancelled'&&Number(totals(document).balance||0)>0);
    const proformaAdvances=(db.documents||[]).filter(document=>document.type==='Proforma'&&document.status!=='Cancelled'&&Number(totals(document).balance||0)>0);
    const vendorBills=(db.vendorBills||[]).filter(bill=>bill.status!=='Paid');
    return {ledger,cashIn,cashOut,netCash:difference(cashIn,cashOut),receivables:byCurrency(openInvoices.map(document=>({currency:document.currency||'INR',amount:totals(document).balance||0}))),advanceRequests:byCurrency(proformaAdvances.map(document=>({currency:document.currency||'INR',amount:totals(document).balance||0}))),payables:byCurrency(vendorBills.map(bill=>({currency:bill.currency||'INR',amount:bill.amount||0}))),openInvoiceCount:openInvoices.length,advanceCount:proformaAdvances.length,payableCount:vendorBills.length};
  };
  window.exportAccountingReport=function(){
    const report=accountingSnapshot();
    const summary=[
      ['ACCOUNTING SUMMARY', '', '', '', '', '', ''],
      ['Cash received', formatCurrencies(report.cashIn), '', '', '', '', ''],
      ['Cash paid', formatCurrencies(report.cashOut), '', '', '', '', ''],
      ['Net cash movement', formatCurrencies(report.netCash), '', '', '', '', ''],
      ['Invoice receivables', formatCurrencies(report.receivables), '', '', '', '', ''],
      ['Proforma advances requested', formatCurrencies(report.advanceRequests), '', '', '', '', ''],
      ['Vendor payables', formatCurrencies(report.payables), '', '', '', '', ''],
      [],['CASH BOOK','Date','Type','Category','Reference / note','Amount','Funds used / method'],
      ...report.ledger.map(row=>[row.currency||'INR',row.date,row.type,row.category,row.note||'',row.amount,`${row.externalPayment?'External payment':row.paymentSource||'Operating balance'} · ${row.paymentMode||'—'}`])
    ];
    csvDownload(`Eric-Designs-Accounting-${today()}.csv`,summary);
    toast('Accounting report downloaded.');
  };
  window.openAccountingSummary=function(){
    const report=accountingSnapshot();
    modal('Accounting summary',`<div class="stats two"><div class="stat"><span>Cash received</span><strong>${esc(formatCurrencies(report.cashIn))}</strong><small>Recorded money in</small></div><div class="stat"><span>Cash paid</span><strong>${esc(formatCurrencies(report.cashOut))}</strong><small>Recorded money out</small></div><div class="stat"><span>Net cash movement</span><strong>${esc(formatCurrencies(report.netCash))}</strong><small>Cash received less cash paid</small></div><div class="stat"><span>Invoice receivables</span><strong>${esc(formatCurrencies(report.receivables))}</strong><small>${report.openInvoiceCount} final invoice${report.openInvoiceCount===1?'':'s'} awaiting payment</small></div><div class="stat"><span>Advance requests</span><strong>${esc(formatCurrencies(report.advanceRequests))}</strong><small>${report.advanceCount} proforma${report.advanceCount===1?'':'s'} awaiting payment</small></div><div class="stat"><span>Vendor payables</span><strong>${esc(formatCurrencies(report.payables))}</strong><small>${report.payableCount} vendor bill${report.payableCount===1?'':'s'} awaiting payment</small></div></div><p class="hint full">This summary separates cash movement, customer collections, and supplier obligations. It does not change any transaction.</p>`,()=>window.exportAccountingReport());
    const actions=document.querySelector('#recordForm .actions');if(actions)actions.insertAdjacentHTML('beforeend','<button type="button" onclick="exportAccountingReport()">Download accounting report</button>');
  };
  const accountsBeforeAccountingCore=accounts;
  accounts=function(){
    const page=accountsBeforeAccountingCore();
    const report=accountingSnapshot();
    const overview=`<section class="panel accounting-overview"><div class="dialog-title"><div><div class="eyebrow">ACCOUNTING OVERVIEW</div><h2>Cash, collections, and obligations</h2><p class="sub">Use this view to understand cash movement and what clients owe or the business needs to pay.</p></div><div class="actions"><button class="primary" onclick="openAccountingSummary()">View accounting summary</button><button onclick="exportAccountingReport()">Download report</button></div></div><div class="stats three"><div class="stat"><span>Net cash movement</span><strong>${esc(formatCurrencies(report.netCash))}</strong><small>Cash received less cash paid</small></div><div class="stat"><span>Customer receivables</span><strong>${esc(formatCurrencies(report.receivables))}</strong><small>${report.openInvoiceCount} unpaid final invoice${report.openInvoiceCount===1?'':'s'}</small></div><div class="stat"><span>Vendor payables</span><strong>${esc(formatCurrencies(report.payables))}</strong><small>${report.payableCount} unpaid vendor bill${report.payableCount===1?'':'s'}</small></div></div><div class="actions"><button onclick="document.getElementById('accountRows')?.scrollIntoView({behavior:'smooth',block:'start'})">Open cash book</button><button onclick="nav('Final invoices')">Manage receivables</button><button onclick="editVendorBill()">Manage payables</button><button onclick="document.querySelector('details.panel')?.scrollIntoView({behavior:'smooth',block:'start'})">Bank reconciliation</button></div></section>`;
    return page.replace('<section class="panel finance-actions-panel">',overview+'<section class="panel finance-actions-panel">');
  };
})();
