'use strict';
/* Loaded after the main CRM so these safeguards remain active if an older extension stops early. */
(()=>{
  window.__crmStability='ready';
  if(!db.openingBalances||typeof db.openingBalances!=='object')db.openingBalances={};
  for(const currency of ['INR','AED'])db.openingBalances[currency]=Math.max(0,num(db.openingBalances[currency]));
  const map=()=>({INR:0,AED:0});
  const add=(target,currency,amount)=>target[currency||'INR']=(target[currency||'INR']||0)+num(amount);
  const balances=()=>{const opening=structuredClone(db.openingBalances),used=map(),income=map(),operatingOut=map(),available=map();for(const entry of accountLedger()){const currency=entry.currency||'INR';if(entry.externalPayment)continue;if(entry.type==='Income')add(income,currency,entry.amount);else if(entry.paymentSource==='Opening balance')add(used,currency,entry.amount);else add(operatingOut,currency,entry.amount)}for(const currency of ['INR','AED'])available[currency]=num(opening[currency])-num(used[currency])+num(income[currency])-num(operatingOut[currency]);return {opening,used,income,operatingOut,available};};
  window.showOpeningBalances=function(){modal('Set opening balances',`<p class="sub">Cash held before CRM records began. This does not create a transaction.</p>${field('INR opening balance','opening-balance-inr',db.openingBalances.INR,'number','min="0" step="0.01"')}${field('AED opening balance','opening-balance-aed',db.openingBalances.AED,'number','min="0" step="0.01"')}`,()=>{const INR=num(val('opening-balance-inr')),AED=num(val('opening-balance-aed'));if(INR<0||AED<0){document.getElementById('recordError').textContent='Opening balances cannot be negative.';return}if(commitChange(()=>db.openingBalances={INR,AED},'Updated opening balances'))closeSaved()})};
  const coreAccounts=accounts;
  accounts=function(){const summary=currencySummary(balances().available),base=coreAccounts();return base.replace(/(<div class="eyebrow">AVAILABLE BUSINESS FUNDS<\/div><h2>)(.*?)(<\/h2>)/,'$1'+summary+'$3').replace('<button onclick="showOpeningBalances()">Set opening balance</button><button onclick="showOpeningBalances()">Set opening balance</button>','<button onclick="showOpeningBalances()">Set opening balance</button>').replace('Money received less payments made from operating or opening balance.','Opening balance plus income, less payments made from those funds.').replace('<b>More finance details</b>','<b>Finance controls</b>').replace('Collections, bank matching, budgets, and recurring costs','Bank matching, collections, budgets, and recurring costs');};
})();
