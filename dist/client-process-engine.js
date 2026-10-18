(function(root){
/* Keep the total project value and the advance requested as separate values. */
function prepare(state,quote,uuid,now=new Date().toISOString()){
 if(quote.type!=='Quotation'||!quote.clientApprovedForProcess||!quote.contractConfirmedAt||quote.status!=='Accepted')return null;
 if(quote.billingMode==='service-wise')return null;
 const existing=state.documents.find(d=>d.rootId===quote.id&&d.type==='Proforma'&&d.status!=='Cancelled');if(existing)return existing;
 const projectValue=(quote.items||[]).reduce((a,i)=>a+Number(i.qty||0)*Number(i.rate||0),0)*(1-Number(quote.discount||0)/100)*(1+Number(quote.tax||0)/100);
 if(!(projectValue>0)||(quote.items||[]).some(i=>!(Number(i.rate)>0)||i.rateText))return null;
 const number=Math.max(0,...state.documents.filter(d=>d.type==='Proforma').map(d=>Number(String(d.number).replace('ED-P-',''))||0))+1;
 const advanceAmount=Math.round(projectValue*50)/100;
 const p={...JSON.parse(JSON.stringify(quote)),id:uuid(),type:'Proforma',number:'ED-P-'+String(number).padStart(4,'0'),rootId:quote.id,sourceId:quote.id,status:'Draft',date:now.slice(0,10),due:new Date(Date.parse(now)+7*86400000).toISOString().slice(0,10),payments:[],advancePercent:50,projectValue,advanceAmount,rateCard:false,updated:now};
 p.items=p.items.map(item=>({...item,proformaAmount:Math.round(Number(item.qty||0)*Number(item.rate||0)*50)/100}));
 delete p.portalToken;delete p.acceptedAt;delete p.clientApprovedForProcess;delete p.workCompletedAt;
 p.terms='50% advance payment is required to commence work. The remaining balance is payable after completion.\n'+(quote.terms||'');state.documents.push(p);return p;
}
function nextNumber(state,type){const prefix=type==='Invoice'?'ED-':'ED-P-';const max=Math.max(0,...(state.documents||[]).filter(d=>d.type===type).map(d=>Number(String(d.number||'').replace(prefix,''))||0));return prefix+String(max+1).padStart(4,'0')}
function serviceValue(quote,item){const subtotal=Number(item.qty||0)*Number(item.rate||0),discount=subtotal*Number(quote.discount||0)/100,net=subtotal-discount,tax=net*Number(quote.tax||0)/100;return Math.round((net+tax)*100)/100}
function prepareServiceProformas(state,quote,uuid,now=new Date().toISOString()){
 if(quote.type!=='Quotation'||!quote.clientApprovedForProcess||!quote.contractConfirmedAt||quote.status!=='Accepted')return [];
 if(quote.rateCard||(quote.items||[]).some(item=>!(Number(item.rate)>0)||item.rateText))return [];
 if((state.documents||[]).some(d=>d.type==='Proforma'&&d.rootId===quote.id&&d.status!=='Cancelled'&&d.serviceIndex===undefined))return [];
 quote.billingMode='service-wise';const created=[];
 (quote.items||[]).forEach((item,index)=>{
  if((state.documents||[]).some(d=>d.type==='Proforma'&&d.rootId===quote.id&&d.serviceIndex===index&&d.status!=='Cancelled'))return;
  const proformaAmount=Math.round(Number(item.qty||0)*Number(item.rate||0)*50)/100;
  const p={...JSON.parse(JSON.stringify(quote)),id:uuid(),type:'Proforma',number:nextNumber(state,'Proforma'),rootId:quote.id,sourceId:quote.id,serviceIndex:index,serviceName:item.name||`Service ${index+1}`,billingMode:'service-wise',status:'Draft',date:now.slice(0,10),due:new Date(Date.parse(now)+7*86400000).toISOString().slice(0,10),payments:[],advancePercent:50,projectValue:serviceValue(quote,item),advanceAmount:Math.round(serviceValue(quote,item)*50)/100,rateCard:false,updated:now,items:[{...JSON.parse(JSON.stringify(item)),proformaAmount}]};
  delete p.portalToken;delete p.acceptedAt;delete p.clientApprovedForProcess;delete p.workCompletedAt;
  p.terms=`Service: ${p.serviceName}\n50% advance payment is required to commence this service. The remaining balance is payable after completion.\n${quote.terms||''}`;
  state.documents.push(p);created.push(p);
 });
 return created;
}
function prepareServiceInvoice(state,quote,proforma,uuid,now=new Date().toISOString()){
 if(!proforma||proforma.type!=='Proforma'||proforma.rootId!==quote.id||proforma.serviceIndex===undefined||proforma.status==='Cancelled')return null;
 const existing=(state.documents||[]).find(d=>d.type==='Invoice'&&d.rootId===quote.id&&d.serviceIndex===proforma.serviceIndex&&d.status!=='Cancelled');if(existing)return existing;
 const paid=(proforma.payments||[]).reduce((sum,payment)=>sum+Number(payment.amount||0),0);if(paid+0.005<Number(totalsForEngine(proforma)))return null;
  const serviceIndex=proforma.serviceIndex,invoice={...JSON.parse(JSON.stringify(proforma)),id:uuid(),type:'Invoice',number:nextNumber(state,'Invoice'),sourceId:proforma.id,sourceProformaId:proforma.id,rootId:quote.id,serviceIndex,serviceName:proforma.serviceName,billingMode:'service-wise',status:'Draft',date:now.slice(0,10),due:new Date(Date.parse(now)+7*86400000).toISOString().slice(0,10),payments:(proforma.payments||[]).map(payment=>({...JSON.parse(JSON.stringify(payment)),sourceProformaId:proforma.id})),updated:now,terms:`Balance invoice for ${proforma.serviceName}. Full service value: ${quote.currency||'INR'} ${serviceValue(quote,quote.items[serviceIndex]).toFixed(2)}. Advance received: ${quote.currency||'INR'} ${paid.toFixed(2)}.\n${quote.business?.invoiceTerms||state.settings?.invoiceTerms||'Thank you for choosing Eric’s Designs.'}`};
 delete invoice.proformaAmount;invoice.items=invoice.items.map(item=>{const copy={...item};delete copy.proformaAmount;return copy});state.documents.push(invoice);return invoice;
}
function totalsForEngine(document){const subtotal=(document.items||[]).reduce((sum,item)=>sum+Number(item.proformaAmount??(Number(item.qty||0)*Number(item.rate||0))),0),net=subtotal*(1-Number(document.discount||0)/100);return Math.round(net*(1+Number(document.tax||0)/100)*100)/100}
if(typeof module!=='undefined')module.exports={prepare,prepareServiceProformas,prepareServiceInvoice,serviceValue};else root.ClientProcessEngine={prepare,prepareServiceProformas,prepareServiceInvoice,serviceValue};
})(typeof window!=='undefined'?window:globalThis);
