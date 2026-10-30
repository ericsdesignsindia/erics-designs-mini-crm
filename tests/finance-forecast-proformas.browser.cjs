const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.setPath('userData', path.resolve('tmp/finance-forecast-proformas-test-profile'));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false } });
  try {
    await window.loadFile(path.resolve('index.html'));
    const testScript = `(() => { try {
      document.getElementById('erp-auth')?.remove();
      const due=addDays(5), later=addDays(45);
      const base={currency:'INR',status:'Accepted',payments:[],tax:0,discount:0,items:[{qty:1,rate:12000,proformaAmount:6000}],client:{name:'Test'}};
      db={...migrate({settings:structuredClone(defaults.settings),documents:[],clients:[],services:[],tasks:[],projects:[],activity:[]}),documents:[
        {...base,id:'advance',type:'Proforma',number:'ED-P-0001',due},
        {...base,id:'rate-card',type:'Proforma',number:'ED-P-0002',due,rateCard:true,projectValue:0,advanceAmount:0,items:[{qty:1,rate:0,proformaAmount:0}]},
        {...base,id:'priced-rate-card-advance',type:'Proforma',number:'ED-P-0005',due,rateCard:true},
        {...base,id:'linked-advance',type:'Proforma',number:'ED-P-0003',due},
        {...base,id:'linked-invoice',type:'Invoice',number:'ED-0001',sourceId:'linked-advance',due,items:[{qty:1,rate:12000}],payments:[{amount:6000}]},
        {...base,id:'draft-invoice',type:'Invoice',number:'ED-0002',status:'Draft',due},
        {...base,id:'draft-proforma',type:'Proforma',number:'ED-P-0006',status:'Draft',due},
        {...base,id:'cancelled-proforma',type:'Proforma',number:'ED-P-0007',status:'Cancelled',due},
        {...base,id:'later-advance',type:'Proforma',number:'ED-P-0004',due:later}
      ]};
      const forecast=financeForecast(30);
      if(forecast.receivables.INR!==18000)throw Error('Expected two 6,000 Proforma advances plus the linked invoice 6,000 balance; got '+forecast.receivables.INR);
      const accountHtml=accounts();
      const collectionsHtml=accountsCollectionsQueue();
      if(!accountHtml.includes('Client invoices due'))throw Error('Accounts is missing its Client invoices due summary.');
      if(!accountHtml.includes('openClientInvoiceDues()')||typeof window.openClientInvoiceDues!=='function')throw Error('Client invoices due summary must open its invoice and Proforma collections list.');
      for(const kind of ['received','paid','bills'])if(!accountHtml.includes("openAccountingSummaryDetails('"+kind+"')"))throw Error('Accounting summary card is missing its '+kind+' drill-down.');
      if(typeof window.openAccountingSummaryDetails!=='function'||typeof window.clearAccountingSummaryFilter!=='function'||typeof window.clearAccountingBillsSummaryFilter!=='function')throw Error('Accounting summary drill-down and reset actions must be available.');
      if(!accountHtml.includes(financeRows({INR:24000})))throw Error('Client invoices due should include all unpaid final invoice and Proforma balances without double counting.');
      if(!accountHtml.includes('1 unpaid final invoice · 3 pending Proforma advances'))throw Error('Client invoices due should count unpaid final invoices and pending Proforma advances, excluding drafts and cancelled items.');
      if(!collectionsHtml.includes('unpaid final invoice')||!collectionsHtml.includes('pending proforma advance'))throw Error('Collections Queue must show separate final-invoice and Proforma-advance counts.');
      if(!collectionsHtml.includes('Final invoices show the remaining bill balance')||!collectionsHtml.includes('Proformas are advance requests'))throw Error('Collections Queue must explain how final invoices differ from Proforma advance requests.');
      if(!collectionsHtml.includes('ED-P-0003 (proforma) is not counted again.'))throw Error('Collections Queue should explain when a Proforma has already been replaced by its final invoice.');
      db.documents.push({...base,id:'dayly-final',type:'Invoice',number:'ED-0076',status:'Part paid',client:{name:'DaylyBody'},project:'SEO',due,items:[{qty:1,rate:20000}],payments:[{amount:8500}]},{...base,id:'dayly-advance',type:'Proforma',number:'ED-P-0008',client:{name:'Dayly body Pvt Ltd'},project:'Website UI / SEO',due,items:[{qty:1,rate:20000,proformaAmount:10000}]});
      const daylyCollections=accountsCollectionsQueue();
      if(!daylyCollections.includes('DaylyBody: ED-P-0008 (Website UI / SEO) is not counted again. ED-0076 total ₹20,000.00 · received ₹8,500.00 · balance due ₹11,500.00.'))throw Error('The same-project DaylyBody proforma should be excluded and its invoice payment balance shown.');
      if(daylyCollections.includes('ED-P-0008 · Due'))throw Error('A proforma covered by a same-account, same-project final invoice must not remain in the unpaid advances list.');
      if(financeForecast(30).receivables.INR!==29500)throw Error('A same-project proforma was double-counted alongside the final invoice balance.');
      if(!accounts().includes(financeRows({INR:35500})))throw Error('Client invoices due should exclude the covered DaylyBody advance proforma.');
      if(isRateCardQuotation(db.documents.find(item=>item.id==='priced-rate-card-advance')))throw Error('A Proforma inherited a quotation-only rate-card display mode.');
      if(!isRateCardQuotation({type:'Quotation',rateCard:true}))throw Error('A rate-card quotation lost its rate-card display mode.');
      const pricedProforma=db.documents.find(item=>item.id==='priced-rate-card-advance'),preview=documentHTML(pricedProforma);
      if(preview.includes('RATE CARD'))throw Error('Proforma preview still hides the payable total behind a rate-card label.');
      if(!preview.includes(fmt(pricedProforma,6000)))throw Error('Proforma preview does not show the payable advance amount.');
      db.documents.push({...base,id:'meta-oct-final',type:'Invoice',number:'ED-0080',client:{name:'Glow & Fly Ladies Salon'},project:'Meta Ads',due:'2026-10-29',items:[{qty:1,rate:5000}]},{...base,id:'meta-nov-advance',type:'Proforma',number:'ED-P-0009',client:{name:'Glow & Fly Ladies Salon'},project:'Meta Ads',due:'2026-11-01',items:[{qty:1,rate:5000,proformaAmount:2500}]});
      if(financeInvoiceForProforma(db.documents.find(item=>item.id==='meta-nov-advance')))throw Error('A November Meta Ads advance must not be hidden by an October invoice for the same client and service.');
      const unmatchedScope=financeInvoiceForProforma({...base,id:'scope-advance',type:'Proforma',client:{name:'Scope Test Ltd'},project:'Meta Ads',due:'2026-10-29'},[{...base,id:'scope-invoice',type:'Invoice',client:{name:'Scope Test Ltd'},project:'Meta Ads and SEO',due:'2026-10-29'}]);
      if(unmatchedScope)throw Error('A final invoice covering additional services must not silently absorb a narrower Proforma advance.');
      const performance=window.accountingPerformanceSummary('all');
      if(!performance||typeof performance.profit!=='object')throw Error('Accounts is missing its performance summary.');
      db.documents=[];
      db.employees=[{id:'owner-tanishka',name:'Tanishka',status:'Active'},{id:'owner-eric',name:'Eric Rodgers',status:'Active'},{id:'employee-1',name:'Team member',status:'Active'}];
      db.accounts=[
        {id:'perf-income-inr',date:today(),type:'Income',currency:'INR',category:'Client payment',amount:20000},
        {id:'perf-income-aed',date:today(),type:'Income',currency:'AED',category:'Client payment',amount:100},
        {id:'perf-payroll-linked',date:today(),type:'Expense',currency:'INR',category:'Payroll',amount:4000,employeeId:'employee-1'},
        {id:'perf-payroll-legacy',date:today(),type:'Expense',currency:'INR',category:'Payroll',amount:1000},
        {id:'perf-external-other',date:today(),type:'Expense',currency:'INR',category:'Travel',amount:2000,externalPayment:true},
        {id:'perf-other',date:today(),type:'Expense',currency:'INR',category:'Office',amount:3000},
        {id:'perf-owner-tanishka',date:today(),type:'Expense',currency:'INR',category:'Payroll',amount:1500,employeeId:'owner-tanishka'},
        {id:'perf-owner-eric',date:today(),type:'Expense',currency:'INR',category:'Payroll',amount:500,employeeId:'owner-eric',externalPayment:true},
        {id:'perf-owner-legacy',date:today(),type:'Expense',currency:'INR',category:'Owner profit',amount:250,note:'Owner payment · Tanishka'},
        {id:'perf-old-income',date:'2025-01-01',type:'Income',currency:'INR',category:'Client payment',amount:10000}
      ];
      const monthPerformance=window.accountingPerformanceSummary(today().slice(0,7)),allPerformance=window.accountingPerformanceSummary('all');
      if(monthPerformance.income.INR!==20000||monthPerformance.ownerPayments.INR!==2250||monthPerformance.employeePayments.INR!==5000||monthPerformance.otherExpenses.INR!==5000||monthPerformance.profit.INR!==10000||monthPerformance.profit.AED!==100)throw Error('Owner payments must be tracked separately as profit distributions, while non-owner payroll and other costs reduce profit.');
      if(allPerformance.income.INR!==30000||allPerformance.ownerPayments.INR!==2250||allPerformance.profit.INR!==20000)throw Error('All-time performance must include historical income while keeping owner payouts outside profit expenses.');
      const ownerTransactionRow=accountLedgerRow(db.accounts.find(entry=>entry.id==='perf-owner-tanishka'));
      if(!ownerTransactionRow.includes('Owner profit')||ownerTransactionRow.includes('Employee payment'))throw Error('Owner payouts should be visibly labeled as owner profit in the transaction list.');
      const performanceHtml=accounts();
      for(const label of ['Business performance','Income received','Owner profit paid','Employee payments','Other expenses','Profit before owner payouts','All recorded time'])if(!performanceHtml.includes(label))throw Error('The Accounts performance area is missing '+label+'.');
      document.body.insertAdjacentHTML('beforeend','<div id="accounts-performance-content"></div>');
      window.updateAccountsPerformance('all');
      if(!document.getElementById('accounts-performance-content').innerHTML.includes('All recorded time'))throw Error('The Accounts performance period selector must update the visible summary.');
      db.documents=[{...base,id:'only-draft-invoice',type:'Invoice',number:'ED-DRAFT',status:'Draft',due,items:[{qty:1,rate:12000}]}];
      if(window.accountingSnapshot().openInvoiceCount!==0)throw Error('Draft invoices must not appear in the accounting summary as money due.');
      db.vendorBills=[{id:'paid-bill-locked',vendor:'Locked vendor',category:'Office',amount:100,currency:'INR',due:today(),status:'Paid'}];
      window.editVendorBill('paid-bill-locked');
      if(document.querySelector('#recordModal')?.open)throw Error('Editing a paid vendor bill should be blocked to avoid changing totals after recording its payment.');
      return { forecastExpectedINR:forecast.receivables.INR, accountsDueINR:35500, sameAccountProformaExcluded:true, invoiceTotalINR:20000, advanceReceivedINR:8500, balanceDueINR:11500, includesSharedProforma:true, includesPricedRateCardSource:true, excludesUnpricedRateCard:true, avoidsLinkedAdvanceDoubleCount:true, excludesDraftsAndCancelled:true, excludesOutsideWindow:true, separateMonthlyAdvancePreserved:true, performanceSummaryVerified:true, ownerProfitSeparationVerified:true, ownerTransactionLabelVerified:true, employeeExpenseStillReducesProfit:true, draftInvoicesExcludedFromSnapshot:true, paidVendorBillsLocked:true };
    } catch(error) { return { error:error.stack||error.message }; }
    })()`;
    try { new Function(testScript); } catch (error) { console.error(testScript); throw error; }
    const result = await window.webContents.executeJavaScript(testScript);
    if (!result || result.error) throw new Error(result?.error || 'Finance forecast verification returned no result.');
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
    process.exit(process.exitCode || 0);
  }
});
