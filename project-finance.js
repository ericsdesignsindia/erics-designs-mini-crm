/* Project finance: connects delivery work to the recorded money in Accounts. */
(function(){
  const amount=value=>Number(value||0);
  const normalise=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
  const sameClient=(document,client)=>{
    if(!document.client||!client)return false;
    if(document.client.id&&client.id)return document.client.id===client.id;
    const name=normalise(document.client.name),matches=(db.clients||[]).filter(item=>normalise(item.name)===name);
    return Boolean(name&&name===normalise(client.name)&&matches.length<=1);
  };
  const belongsToProject=(document,project,client)=>{
    if(document.projectId)return document.projectId===project.id;
    const sourceId=project.sourceQuotationId;
    if(sourceId&&(document.id===sourceId||document.sourceId===sourceId||document.rootId===sourceId))return true;
    if(document.rootId&&sourceId&&document.rootId===sourceId)return true;
    return sameClient(document,client)&&normalise(document.project)===normalise(project.name);
  };
  const money=(currency,value)=>new Intl.NumberFormat(currency==='AED'?'en-AE':'en-IN',{style:'currency',currency:currency||'INR',maximumFractionDigits:2}).format(amount(value));
  const totalsByCurrency=rows=>rows.reduce((out,row)=>{const currency=row.currency||'INR';out[currency]=(out[currency]||0)+amount(row.amount);return out},{});
  const displayTotals=values=>Object.entries(values).map(([currency,value])=>money(currency,value)).join(' · ')||'—';
  window.recordProjectExpense=function(projectId){
    const project=db.projects.find(item=>item.id===projectId);if(!project)return;
    modal('Record project expense',`<p class="sub">This cost is linked to ${esc(project.name)} and appears in its financial summary.</p>${field('Payment date *','project-expense-date',today(),'date','required')}<div><label for="project-expense-currency">Currency</label><select id="project-expense-currency"><option>INR</option><option>AED</option></select></div>${field('Category *','project-expense-category','Project delivery','text','required')}<div><label for="project-expense-source">Funds used</label><select id="project-expense-source"><option>Operating balance</option><option>Opening balance</option><option>External payment</option></select></div>${field('Amount *','project-expense-amount','','number','required min="0.01" step="0.01"')}<div class="full"><label for="project-expense-note">Reference / note</label><textarea id="project-expense-note" placeholder="Supplier, freelancer, ad spend, hosting, travel…"></textarea></div>`,()=>{
      const date=val('project-expense-date'),currency=val('project-expense-currency'),category=val('project-expense-category').trim(),paymentSource=val('project-expense-source'),sum=amount(val('project-expense-amount')),note=val('project-expense-note').trim();
      if(!date||!category||sum<=0){document.getElementById('recordError').textContent='Add a date, category, and amount greater than zero.';return}
      if(commitChange(()=>db.accounts.push({id:uid(),date,type:'Expense',currency,category,amount:sum,note:`Project · ${project.name}${note?' · '+note:''}`,projectId:project.id,paymentSource,externalPayment:paymentSource==='External payment'}),'Recorded project expense for '+project.name))closeSaved();
    });
  };
  const baseProjectWorkspace=projectWorkspace;
  projectWorkspace=function(project){
    const markup=baseProjectWorkspace(project);
    const client=db.clients.find(item=>item.id===project.clientId);
    const documents=db.documents.filter(item=>belongsToProject(item,project,client)&&!['Draft','Cancelled'].includes(item.status));
    const quotations=documents.filter(item=>item.type==='Quotation'&&['Accepted','Sent'].includes(item.status));
    const quotation=quotations.sort((a,b)=>(a.status==='Accepted'?0:1)-(b.status==='Accepted'?0:1)||String(b.updated||b.date).localeCompare(String(a.updated||a.date)))[0];
    const invoices=documents.filter(item=>item.type==='Invoice');
    const expenses=(db.accounts||[]).filter(item=>item.type==='Expense'&&item.projectId===project.id);
    const quoted=quotations.reduce((sum,item)=>{const currency=item.currency||'INR';sum[currency]=(sum[currency]||0)+amount(totals(item).total);return sum},{});
    const collected=totalsByCurrency(invoices.flatMap(invoice=>(invoice.payments||[]).map(payment=>({currency:invoice.currency||'INR',amount:payment.amount}))));
    const billed=totalsByCurrency(invoices.map(invoice=>({currency:invoice.currency||'INR',amount:totals(invoice).total})));
    const costs=totalsByCurrency(expenses);
    const margin={};for(const currency of new Set([...Object.keys(quoted),...Object.keys(costs)]))margin[currency]=(quoted[currency]||0)-(costs[currency]||0);
    return markup+`<section class="panel project-finance"><div class="dialog-title"><div><div class="eyebrow">PROJECT FINANCE</div><h2>Value, costs, and collection</h2><p class="sub">Quoted value includes all sent and accepted quotations linked to this project. Link supplier, freelancer, and delivery costs here.</p></div><div class="actions"><button onclick="processAttachQuotationToProject('', '${project.id}')">+ Add quotation</button><button class="primary" onclick="recordProjectExpense('${project.id}')">+ Project expense</button></div></div><div class="stats four"><div class="stat"><span>Quoted value</span><strong>${esc(displayTotals(quoted))}</strong><small>${quotations.length?`${quotations.length} linked quotation${quotations.length===1?'':'s'} · ${quotations.map(item=>esc(item.number)).join(', ')}`:'No quotation linked'}</small></div><div class="stat"><span>Final invoices</span><strong>${esc(displayTotals(billed))}</strong><small>${invoices.length} invoice${invoices.length===1?'':'s'}</small></div><div class="stat"><span>Payments received</span><strong>${esc(displayTotals(collected))}</strong><small>Recorded against final invoices</small></div><div class="stat"><span>Delivery costs</span><strong>${esc(displayTotals(costs))}</strong><small>Projected margin ${esc(displayTotals(margin))}</small></div></div><div class="project-finance-list">${expenses.length?expenses.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(item=>`<div><div><b>${esc(item.category)}</b><small>${esc(item.note||'Project expense')} · ${esc(item.date)} · ${esc(item.paymentSource||'Operating balance')}</small></div><strong>${esc(money(item.currency||'INR',item.amount))}</strong></div>`).join(''):'<p class="sub">No project costs recorded. Add actual delivery costs to view the project margin.</p>'}</div></section>`;
  };
})();
