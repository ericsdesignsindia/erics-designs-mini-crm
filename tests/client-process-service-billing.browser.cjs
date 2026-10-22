const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.setPath('userData', path.resolve('tmp/service-billing-test-profile'));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false } });
  try {
    await window.loadFile(path.resolve('index.html'));
    const result = await window.webContents.executeJavaScript(`(() => { try {
      document.getElementById('erp-auth')?.remove();
      const quote={id:'service-billing-quote',type:'Quotation',number:'ED-Q-SERVICE-1',status:'Accepted',clientApprovedForProcess:true,contractConfirmedAt:'2026-10-18T08:00:00.000Z',billingMode:'service-wise',date:today(),due:today(),currency:'INR',client:{name:'Billing Test Client'},project:'Website and SEO',items:[{name:'Website',qty:1,rate:10000},{name:'SEO',qty:2,rate:10000}],payments:[],tax:18,discount:10,terms:'Test scope',business:structuredClone(defaults.settings)};
      db=migrate({settings:structuredClone(defaults.settings),documents:[quote],clients:[],services:[],tasks:[],projects:[],activity:[]});
      persist=()=>true;
      const proformas=ClientProcessEngine.prepareServiceProformas(db,quote,uid);
      if(proformas.length!==2)throw Error('Separate service proformas were not prepared.');
      proformas[0].payments.push({id:'advance-1',date:today(),amount:totals(proformas[0]).total,reference:'UPI'});
      processProject(quote.id);
      const project=db.projects.find(item=>item.sourceQuotationId===quote.id);
      project.tasks[0].done=true;
      nav('Client Process');
      const content=document.getElementById('app').innerText;
      if(!content.includes('Separate vouchers for each service')||!content.includes('Website')||!content.includes('SEO'))throw Error('Service-wise billing cards are missing.');
      processServiceBalance(quote.id,proformas[0].id);
      const invoice=db.documents.find(item=>item.type==='Invoice'&&item.serviceIndex===0&&item.rootId===quote.id);
      if(!invoice||draft?.id!==invoice.id)throw Error('The completed service did not open its balance invoice.');
      if(invoice.payments[0].sourceProformaId!==proformas[0].id)throw Error('Advance is not linked to its balance invoice.');
      if(totals(invoice).balance!==5310)throw Error('The invoice balance is incorrect: '+totals(invoice).balance);
      if(db.documents.some(item=>item.type==='Invoice'&&item.serviceIndex===1))throw Error('An incomplete service received an invoice.');
      const noAdvanceQuote={id:'no-advance-service-quote',type:'Quotation',number:'ED-Q-SERVICE-2',status:'Accepted',clientApprovedForProcess:true,contractConfirmedAt:'2026-10-18T08:00:00.000Z',billingMode:'service-completion',serviceBillingAllocations:[12000,18000],date:today(),due:today(),currency:'INR',client:{name:'No Advance Test Client'},project:'Brand strategy and website',items:[{name:'Brand strategy',qty:1,rate:12000},{name:'Website',qty:1,rate:18000}],payments:[],tax:18,discount:10,terms:'Test scope',business:structuredClone(defaults.settings)};
      db.documents.push(noAdvanceQuote);
      processProject(noAdvanceQuote.id);
      const noAdvanceProject=db.projects.find(item=>item.sourceQuotationId===noAdvanceQuote.id);
      noAdvanceProject.tasks[0].done=true;
      nav('Client Process');
      if(!document.getElementById('app').innerText.includes('Invoice each service when complete'))throw Error('No-advance service billing cards are missing.');
      processCompletedServiceInvoice(noAdvanceQuote.id,0);
      const noAdvanceInvoice=db.documents.find(item=>item.type==='Invoice'&&item.serviceIndex===0&&item.rootId===noAdvanceQuote.id);
      if(!noAdvanceInvoice||draft?.id!==noAdvanceInvoice.id)throw Error('The completed service did not open its invoice.');
      if(noAdvanceInvoice.items.length!==1||totals(noAdvanceInvoice).total!==12744)throw Error('The service invoice has the wrong amount or scope.');
      if(noAdvanceInvoice.payments.length||noAdvanceInvoice.advanceAmount!==0)throw Error('The no-advance invoice contains advance payment data.');
      if(db.documents.some(item=>item.type==='Invoice'&&item.rootId===noAdvanceQuote.id&&item.serviceIndex===1))throw Error('An incomplete service received an invoice.');
      return { serviceCards:2, proformas:proformas.length, balanceInvoice:totals(invoice).balance, noAdvanceInvoice:totals(noAdvanceInvoice).total, unrelatedServicesInvoiced:false };
    } catch(error) { return { error:error.stack||error.message }; }
    })()`);
    if (!result || result.error) throw new Error(result?.error || 'Browser billing verification returned no result.');
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    window.close();
    app.quit();
  }
});
