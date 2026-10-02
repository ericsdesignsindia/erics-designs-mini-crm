/* One stable proforma calculation for existing and new documents. */
(function(){
  const projectValue=document=>round((document.items||[]).reduce((sum,item)=>sum+num(item.qty)*num(item.rate),0)*(1-num(document.discount)/100)*(1+num(document.tax)/100));
  const advanceFromLines=document=>round((document.items||[]).reduce((sum,item)=>sum+num(item.proformaAmount),0));
  const baseTotals=totals;
  totals=function(document){
    if(document?.type!=='Proforma')return baseTotals(document);
    const project=round(num(document.projectValue)||projectValue(document));
    const advance=round(num(document.advanceAmount)||advanceFromLines(document)||project*.5);
    const paid=round((document.payments||[]).reduce((sum,payment)=>sum+num(payment.amount),0));
    return {subtotal:project,discount:0,tax:0,total:advance,paid,balance:round(advance-paid),projectValue:project,advanceAmount:advance};
  };
  function migrateProformas(){
    let changed=false;
    for(const document of db.documents||[]){
      if(document.type!=='Proforma')continue;
      const project=round(num(document.projectValue)||projectValue(document));
      if(!num(document.projectValue)){document.projectValue=project;changed=true;}
      if(!num(document.advanceAmount)){document.advanceAmount=round(project*.5);changed=true;}
      if(!Number.isFinite(Number(document.advancePercent))){document.advancePercent=project?round(num(document.advanceAmount)/project*100):50;changed=true;}
    }
    if(changed)persist();
  }
  const baseUpdate=updateTotal;
  updateTotal=function(){
    if(draft?.type==='Proforma'){
      const advance=advanceFromLines(draft);if(advance>0)draft.advanceAmount=advance;
      draft.projectValue=projectValue(draft);
      const display=document.getElementById('total');
      if(display){const t=totals(draft);display.innerHTML=`<div class="totalrow"><span>Total project value</span><span>${fmt(draft,t.projectValue)}</span></div><div class="totalrow big"><span>Advance amount required</span><span>${fmt(draft,t.advanceAmount)}</span></div><p class="hint">The advance is editable per service. The full project value remains unchanged.</p>`;}
      draft.items.forEach((item,index)=>{const line=document.getElementById('lineTotal'+index);if(line)line.textContent=fmt(draft,num(item.proformaAmount));});
      return;
    }
    return baseUpdate.apply(this,arguments);
  };
  migrateProformas();
})();
