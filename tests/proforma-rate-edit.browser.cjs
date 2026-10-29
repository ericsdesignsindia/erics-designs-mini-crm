const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.setPath('userData', path.resolve('tmp/proforma-rate-edit-test-profile'));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false } });
  try {
    await window.loadFile(path.resolve('index.html'));
    const result = await window.webContents.executeJavaScript(`(() => { try {
      document.getElementById('erp-auth')?.remove();
      db=migrate({settings:structuredClone(defaults.settings),documents:[],clients:[],services:[],tasks:[],projects:[],activity:[]});
      persist=()=>true;
      draft={id:'manual-proforma',type:'Proforma',number:'ED-P-TEST',status:'Draft',date:today(),due:today(),currency:'INR',discount:0,tax:0,client:{name:'Rate Test Client',email:'',phone:'',address:''},items:[{name:'Meta Ads',description:'Campaign execution',qty:1,rate:0}],payments:[],business:structuredClone(defaults.settings),terms:'Test'};
      view='Proforma invoices';render();
      const rate=document.getElementById('rate0');
      if(!rate||rate.disabled)throw Error('Standalone Proforma does not expose an editable rate.');
      for(const value of ['2','20','200','2000','20000']){rate.value=value;rate.dispatchEvent(new Event('input',{bubbles:true}));}
      if(draft.items[0].rate!==20000||totals(draft).projectValue!==20000||totals(draft).total!==10000)throw Error('Changing standalone Proforma rate did not update the project value and 50% advance.');
      if(document.getElementById('lineTotal0').innerText!=='₹10,000.00')throw Error('The Proforma advance line did not refresh after rate edit.');
      const proformaAmount=document.getElementById('proformaAmount0');proformaAmount.value='4000';proformaAmount.dispatchEvent(new Event('input',{bubbles:true}));
      rate.value='30000';rate.dispatchEvent(new Event('input',{bubbles:true}));
      if(totals(draft).projectValue!==30000||totals(draft).total!==4000)throw Error('A manually adjusted Proforma amount was not preserved when the rate changed.');
      draft={...draft,id:'linked-proforma',sourceId:'source-quotation',rootId:'source-quotation',items:[{name:'Meta Ads',description:'Campaign execution',qty:1,rate:25000}],payments:[]};
      render();
      const locked=document.querySelector('[aria-label="Quoted rate from source quotation"]');
      if(!locked||!locked.disabled)throw Error('Quotation-based Proforma rate is not locked to its source quotation.');
      if(document.getElementById('rate0'))throw Error('Quotation-based Proforma unexpectedly exposes an editable rate.');
      return { standaloneRateEditable:true, manualAdvancePreserved:true, quotationRateLocked:true };
    } catch(error) { return { error:error.stack||error.message }; }
    })()`);
    if (!result || result.error) throw new Error(result?.error || 'Proforma rate verification returned no result.');
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
