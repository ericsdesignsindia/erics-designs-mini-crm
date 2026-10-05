(function(root){
/* Keep the total project value and the advance requested as separate values. */
function prepare(state,quote,uuid,now=new Date().toISOString()){
 if(quote.type!=='Quotation'||!quote.clientApprovedForProcess||!quote.contractConfirmedAt||quote.status!=='Accepted')return null;
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
if(typeof module!=='undefined')module.exports={prepare};else root.ClientProcessEngine={prepare};
})(typeof window!=='undefined'?window:globalThis);
