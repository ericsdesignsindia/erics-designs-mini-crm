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
      return { serviceCards:2, proformas:proformas.length, invoiceBalance:totals(invoice).balance, unrelatedServiceInvoiced:false };
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
