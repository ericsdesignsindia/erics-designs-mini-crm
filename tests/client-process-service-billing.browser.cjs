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
      const setupQuote={id:'service-billing-setup-quote',type:'Quotation',number:'ED-Q-SETUP-1',status:'Accepted',clientApprovedForProcess:true,date:today(),due:today(),currency:'INR',client:{name:'Setup Test Client'},project:'Website and SEO',items:[{name:'Website',qty:1,rate:10000},{name:'SEO',qty:2,rate:10000}],payments:[],tax:18,discount:10,terms:'Test scope',business:structuredClone(defaults.settings)};
      db=migrate({settings:structuredClone(defaults.settings),documents:[quote,setupQuote],clients:[{id:'client-setup',name:'Setup Test Client'}],services:[],tasks:[],projects:[],activity:[]});
      persist=()=>true;
      processContract(setupQuote.id);
      const basis=document.getElementById('contract-billing-structure'),advanceOptions=document.getElementById('contract-advance-setting');
      if(!basis||!advanceOptions?.hidden||document.getElementById('contract-advance-mode'))throw Error('The contract form still exposes a selectable advance option.');
      basis.value='service';basis.dispatchEvent(new Event('change',{bubbles:true}));
      if(advanceOptions.hidden||!advanceOptions.innerText.includes('50% advance Proforma Invoice'))throw Error('Selecting per-service billing did not show the fixed advance-proforma plan.');
      document.getElementById('contract-status').value='Confirmed';document.getElementById('recordForm').requestSubmit();
      const configuredQuote=db.documents.find(item=>item.id===setupQuote.id),configuredProformas=db.documents.filter(item=>item.type==='Proforma'&&item.rootId===setupQuote.id&&item.serviceIndex!==undefined);
      if(configuredQuote.billingMode!=='service-wise'||configuredProformas.length!==2)throw Error('Per-service billing did not create one proforma for each service.');
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
      const legacyQuote={id:'legacy-service-quote',type:'Quotation',number:'ED-Q-SERVICE-2',status:'Accepted',clientApprovedForProcess:true,contractConfirmedAt:'2026-10-18T08:00:00.000Z',billingMode:'service-completion',serviceBillingAllocations:[12000,18000],date:today(),due:today(),currency:'INR',client:{name:'Legacy Test Client'},project:'Brand strategy and website',items:[{name:'Brand strategy',qty:1,rate:12000},{name:'Website',qty:1,rate:18000}],payments:[],tax:18,discount:10,terms:'Test scope',business:structuredClone(defaults.settings)};
      db.documents.push(legacyQuote);
      processProject(legacyQuote.id);
      const legacyProject=db.projects.find(item=>item.sourceQuotationId===legacyQuote.id);
      legacyProject.tasks[0].done=true;
      nav('Client Process');
      const legacyContent=document.getElementById('app').innerText;
      if(legacyContent.includes('No advance')||legacyContent.includes('no advance')||legacyContent.includes('No advance —'))throw Error('The Client Process still presents the removed billing choice.');
      if(!legacyContent.includes('Separate vouchers for each service'))throw Error('Legacy service billing is not shown.');
      processCompletedServiceInvoice(legacyQuote.id,0);
      const legacyInvoice=db.documents.find(item=>item.type==='Invoice'&&item.serviceIndex===0&&item.rootId===legacyQuote.id);
      if(!legacyInvoice||draft?.id!==legacyInvoice.id)throw Error('The existing service invoice behavior was not preserved.');
      if(legacyInvoice.items.length!==1||totals(legacyInvoice).total!==12744)throw Error('The existing service invoice has the wrong amount or scope.');
      if(legacyInvoice.payments.length||legacyInvoice.advanceAmount!==0)throw Error('The legacy invoice unexpectedly contains payment data.');
      if(db.documents.some(item=>item.type==='Invoice'&&item.rootId===legacyQuote.id&&item.serviceIndex===1))throw Error('An incomplete service received an invoice.');
      return { serviceCards:2, proformas:proformas.length, balanceInvoice:totals(invoice).balance, legacyInvoice:totals(legacyInvoice).total, legacyBillingHistoryPreserved:true };
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
