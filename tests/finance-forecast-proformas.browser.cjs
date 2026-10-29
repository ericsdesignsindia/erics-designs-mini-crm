const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.setPath('userData', path.resolve('tmp/finance-forecast-proformas-test-profile'));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false } });
  try {
    await window.loadFile(path.resolve('index.html'));
    const result = await window.webContents.executeJavaScript(`(() => { try {
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
      if(!accountHtml.includes('onclick="window.openClientInvoiceDues()"')||typeof window.openClientInvoiceDues!=='function')throw Error('Client invoices due summary must open its invoice and Proforma collections list.');
      for(const kind of ['received','paid','bills'])if(!accountHtml.includes("onclick=\"window.openAccountingSummaryDetails('"+kind+"')\""))throw Error('Accounting summary card is missing its '+kind+' drill-down.');
      if(typeof window.openAccountingSummaryDetails!=='function'||typeof window.clearAccountingSummaryFilter!=='function'||typeof window.clearAccountingBillsSummaryFilter!=='function')throw Error('Accounting summary drill-down and reset actions must be available.');
      if(!accountHtml.includes(financeRows({INR:18000})))throw Error('Client invoices due should include open Proforma advances and final invoice balances without double counting.');
      if(!accountHtml.includes('1 unpaid final invoice · 2 pending Proforma advances'))throw Error('Client invoices due should count unpaid final invoices and pending Proforma advances, excluding drafts and cancelled items.');
      if(!collectionsHtml.includes('unpaid final invoice')||!collectionsHtml.includes('pending proforma advance'))throw Error('Collections Queue must show separate final-invoice and Proforma-advance counts.');
      if(!collectionsHtml.includes('Final invoices show the remaining bill balance')||!collectionsHtml.includes('Proformas are advance requests'))throw Error('Collections Queue must explain how final invoices differ from Proforma advance requests.');
      if(!collectionsHtml.includes('ED-P-0003 (proforma) is not counted again.'))throw Error('Collections Queue should explain when a Proforma has already been replaced by its final invoice.');
      db.documents.push({...base,id:'dayly-final',type:'Invoice',number:'ED-0076',status:'Part paid',client:{name:'DaylyBody'},project:'SEO',due,items:[{qty:1,rate:20000}],payments:[{amount:8500}]},{...base,id:'dayly-advance',type:'Proforma',number:'ED-P-0008',client:{name:'Dayly body Pvt Ltd'},project:'Website UI / SEO',due,items:[{qty:1,rate:20000,proformaAmount:10000}]});
      const daylyCollections=accountsCollectionsQueue();
      if(!daylyCollections.includes('DaylyBody: ED-P-0008 (Website UI / SEO) is not counted again. ED-0076 total ₹20,000.00 · received ₹8,500.00 · balance due ₹11,500.00.'))throw Error('The same-project DaylyBody proforma should be excluded and its invoice payment balance shown.');
      if(daylyCollections.includes('ED-P-0008'))throw Error('A proforma covered by a same-account, overlapping-project final invoice must not remain in unpaid advances.');
      if(financeForecast(30).receivables.INR!==29500)throw Error('A same-project proforma was double-counted alongside the final invoice balance.');
      if(!accounts().includes(financeRows({INR:29500})))throw Error('Client invoices due should exclude the covered DaylyBody advance proforma.');
      if(isRateCardQuotation(db.documents.find(item=>item.id==='priced-rate-card-advance')))throw Error('A Proforma inherited a quotation-only rate-card display mode.');
      if(!isRateCardQuotation({type:'Quotation',rateCard:true}))throw Error('A rate-card quotation lost its rate-card display mode.');
      const pricedProforma=db.documents.find(item=>item.id==='priced-rate-card-advance'),preview=documentHTML(pricedProforma);
      if(preview.includes('RATE CARD'))throw Error('Proforma preview still hides the payable total behind a rate-card label.');
      if(!preview.includes(fmt(pricedProforma,6000)))throw Error('Proforma preview does not show the payable advance amount.');
      return { expectedINR:forecast.receivables.INR, accountsDueINR:29500, sameAccountProformaExcluded:true, invoiceTotalINR:20000, advanceReceivedINR:8500, balanceDueINR:11500, includesSharedProforma:true, includesPricedRateCardSource:true, excludesUnpricedRateCard:true, avoidsLinkedAdvanceDoubleCount:true, excludesDraftsAndCancelled:true, excludesOutsideWindow:true };
    } catch(error) { return { error:error.stack||error.message }; }
    })()`);
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
