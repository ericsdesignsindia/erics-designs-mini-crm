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
        {...base,id:'later-advance',type:'Proforma',number:'ED-P-0004',due:later}
      ]};
      const forecast=financeForecast(30);
      if(forecast.receivables.INR!==18000)throw Error('Expected two 6,000 Proforma advances plus the linked invoice 6,000 balance; got '+forecast.receivables.INR);
      if(isRateCardQuotation(db.documents.find(item=>item.id==='priced-rate-card-advance')))throw Error('A Proforma inherited a quotation-only rate-card display mode.');
      if(!isRateCardQuotation({type:'Quotation',rateCard:true}))throw Error('A rate-card quotation lost its rate-card display mode.');
      const pricedProforma=db.documents.find(item=>item.id==='priced-rate-card-advance'),preview=documentHTML(pricedProforma);
      if(preview.includes('RATE CARD'))throw Error('Proforma preview still hides the payable total behind a rate-card label.');
      if(!preview.includes(fmt(pricedProforma,6000)))throw Error('Proforma preview does not show the payable advance amount.');
      return { expectedINR:forecast.receivables.INR, includesSharedProforma:true, includesPricedRateCardSource:true, excludesUnpricedRateCard:true, avoidsLinkedAdvanceDoubleCount:true, excludesOutsideWindow:true };
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
