'use strict';

/* Reference-inspired dashboard built from live CRM records. All workspace routes remain unchanged. */
(()=>{
  const stages=['New lead','Contacted','Proposal sent','Won','Lost'];
  const stageColors=['#11c8ee','#9569f5','#ed4e9c','#11d7a2','#f3b51b'];
  const probability={'New lead':.12,'Contacted':.28,'Proposal sent':.62};
  const safeDate=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date};
  const moneyMap=items=>items.reduce((out,[currency,amount])=>{const key=currency||'INR';out[key]=(out[key]||0)+(Number(amount)||0);return out},{});
  const moneyText=values=>Object.entries(values||{}).filter(([,amount])=>amount).map(([currency,amount])=>`${currency==='AED'?'AED ':'₹'}${Number(amount).toLocaleString(currency==='AED'?'en-AE':'en-IN',{maximumFractionDigits:0})}`).join(' · ')||'₹0';
  const pipelineData=()=>typeof pipelineEntries==='function'?pipelineEntries():[];
  const dateValue=item=>item.document?.updated||item.document?.created||item.client?.created||'';
  const entryName=item=>item.client?.name||item.document?.client?.name||'Unnamed client';
  const entryLabel=item=>item.document?.project||item.client?.source||'Client opportunity';
  const entryStatus=item=>item.document?status(item.document):(item.stage||'New lead');
  const entryAmount=item=>Number(item.value)||0;
  const entryCurrency=item=>item.currency||item.document?.currency||'INR';
  const escv=value=>typeof esc==='function'?esc(String(value??'')):String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  window.filterRevampDashboard=function(){
    const search=(document.getElementById('revampDealSearch')?.value||'').trim().toLowerCase();
    const stage=document.getElementById('revampStageFilter')?.value||'All pipeline';
    const kind=document.getElementById('revampKindFilter')?.value||'All deals';
    let shown=0;
    document.querySelectorAll('#revampDealRows tr[data-search]').forEach(row=>{
      const matches=(!search||row.dataset.search.includes(search))&&(stage==='All pipeline'||row.dataset.stage===stage)&&(kind==='All deals'||row.dataset.kind===kind);
      row.hidden=!matches;if(matches)shown++;
    });
    const empty=document.getElementById('revampNoDeals');if(empty)empty.hidden=shown>0;
    const count=document.getElementById('revampDealCount');if(count)count.textContent=`${shown} ${shown===1?'record':'records'}`;
  };
  window.sortRevampDashboard=function(value){
    const body=document.getElementById('revampDealRows');if(!body)return;
    const rows=[...body.querySelectorAll('tr[data-search]')];
    rows.sort((a,b)=>value==='Amount'?Number(b.dataset.amount)-Number(a.dataset.amount):value==='Status'?a.dataset.status.localeCompare(b.dataset.status):Number(b.dataset.date)-Number(a.dataset.date));
    rows.forEach(row=>body.appendChild(row));
  };
  window.toggleRevampFilters=function(){
    const filters=document.getElementById('revampExtraFilters'),button=document.getElementById('revampShowFilters');
    if(!filters)return;filters.hidden=!filters.hidden;if(button)button.setAttribute('aria-expanded',String(!filters.hidden));
  };
  window.toggleRevampOwnerColumn=function(){
    const table=document.querySelector('.revamp-table');if(!table)return;
    const hidden=table.classList.toggle('hide-owner');
    const button=document.getElementById('revampViewOptions');if(button)button.textContent=hidden?'Show owner column':'Hide owner column';
  };

  window.exportRevampDashboard=function(){
    const search=(document.getElementById('revampDealSearch')?.value||'').trim().toLowerCase();
    const stage=document.getElementById('revampStageFilter')?.value||'All pipeline',kind=document.getElementById('revampKindFilter')?.value||'All deals';
    const rows=pipelineData().filter(item=>(stage==='All pipeline'||item.stage===stage)&&(kind==='All deals'||(kind==='Quotations'?item.document?.type==='Quotation':item.kind==='client'))&&(!search||`${entryName(item)} ${entryLabel(item)} ${item.document?.number||''} ${entryStatus(item)}`.toLowerCase().includes(search)));
    const quote=value=>`"${String(value??'').replace(/"/g,'""')}"`;
    const csv=[['Client','Opportunity','Document','Created / updated','Amount','Status','Owner'],...rows.map(item=>[entryName(item),entryLabel(item),item.document?.number||'',dateValue(item),entryAmount(item)?`${entryCurrency(item)} ${entryAmount(item).toFixed(2)}`:'',entryStatus(item),item.document?.owner||item.client?.owner||item.client?.assignedTo||''])].map(row=>row.map(quote).join(',')).join('\r\n');
    const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='erics-designs-crm-deals.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  window.overview=function(){
    const all=pipelineData(),clients=Array.isArray(db.clients)?db.clients:[],documents=Array.isArray(db.documents)?db.documents:[];
    const closed=clients.filter(client=>['Won','Lost'].includes(client.stage)),won=closed.filter(client=>client.stage==='Won').length;
    const winRate=closed.length?Math.round(won/closed.length*100):0;
    const wonQuotes=documents.filter(item=>item.type==='Quotation'&&item.status!=='Cancelled'&&quotationPipelineStage(item)==='Won');
    const wonAmounts=moneyMap(wonQuotes.map(item=>[item.currency||'INR',totals(item).total]));
    const activeQuotes=all.filter(item=>item.document?.type==='Quotation'&&!['Won','Lost'].includes(item.stage));
    const forecast=moneyMap(activeQuotes.map(item=>[entryCurrency(item),entryAmount(item)*(probability[item.stage]||.12)]));
    const cycleDays=wonQuotes.map(quote=>{const client=clients.find(item=>quotationMatchesClient(quote,item));const start=safeDate(client?.created),end=safeDate(quote.updated||quote.created);return start&&end&&end>=start?(end-start)/86400000:null}).filter(value=>value!==null);
    const avgCycle=cycleDays.length?`${Math.max(1,Math.round(cycleDays.reduce((sum,value)=>sum+value,0)/cycleDays.length))} days`:'—';
    const stageCounts=stages.map(stage=>all.filter(item=>item.stage===stage).length);
    const largestStage=Math.max(1,...stageCounts);
    const maxHistory=all.slice().sort((a,b)=>(safeDate(dateValue(b))?.getTime()||0)-(safeDate(dateValue(a))?.getTime()||0));
    const maxLines=maxHistory.slice(0,30);
    const currencies=Object.entries(wonAmounts).sort((a,b)=>b[1]-a[1]).slice(0,4);
    const maxCurrency=Math.max(1,...currencies.map(([,amount])=>amount));
    const polyPoints=stageCounts.map((count,index)=>`${22+index*66},${92-(count/largestStage)*68}`).join(' ');
    const filters=['All pipeline',...stages];
    const rows=maxLines.map(item=>{
      const date=safeDate(dateValue(item));
      const rowDate=date?date.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—';
      const amount=entryAmount(item)?`${entryCurrency(item)==='AED'?'AED':'₹'}${entryAmount(item).toLocaleString(entryCurrency(item)==='AED'?'en-AE':'en-IN',{maximumFractionDigits:0})}`:'—';
      const badgeClass=item.stage==='Won'?'won':item.stage==='Lost'?'lost':item.stage==='Proposal sent'?'proposal':'active';
      const identity=`${entryName(item)} ${entryLabel(item)} ${item.document?.number||''} ${entryStatus(item)}`.toLowerCase();
      const action=item.document?`openDoc('${item.document.id}')`:`selectedClient='${item.client.id}';render()`;
      return `<tr data-search="${escv(identity)}" data-stage="${escv(item.stage||'New lead')}" data-kind="${item.document?.type==='Quotation'?'Quotations':item.kind==='client'?'Leads':'All deals'}" data-date="${safeDate(dateValue(item))?.getTime()||0}" data-amount="${entryAmount(item)}" data-status="${escv(entryStatus(item))}"><td><span class="revamp-deal-name"><i style="--dot:${stageColors[stages.indexOf(item.stage)]||stageColors[0]}"></i>${escv(entryLabel(item))}</span><small>${escv(item.document?.number||entryName(item))}</small></td><td>${escv(entryName(item))}</td><td>${rowDate}</td><td class="revamp-amount">${amount}</td><td><span class="revamp-status ${badgeClass}">${escv(entryStatus(item))}</span></td><td>${escv(item.document?.owner||item.client?.owner||item.client?.assignedTo||'—')}</td><td><button class="revamp-row-open" onclick="${action}">Open</button></td></tr>`;
    }).join('');
    const lineChart=stageCounts.map((count,index)=>`<text x="${22+index*66}" y="116" text-anchor="middle">${index+1}</text>`).join('');
    const avgTasks=(db.tasks||[]).filter(task=>!task.done&&task.due<=today()).length;
    const greeting=typeof crmGreeting==='function'?crmGreeting():'Welcome back';
    return `<div class="revamp-dashboard">
      <header class="revamp-page-head"><div><div class="revamp-breadcrumb"><button onclick="nav('Overview')">Dashboard</button><span>›</span><strong>Deals Overview</strong></div><h1>Deals overview</h1></div><div class="revamp-head-actions"><button onclick="nav('Reports')">▤ &nbsp; View reports</button><button onclick="exportRevampDashboard()">⇧ &nbsp; Export CSV</button></div></header>
      <section class="revamp-section-title"><h2>Deals statistics</h2><div><button class="revamp-soft-button" onclick="aiMode='CRM action plan';nav('AI Copilot')">✧ &nbsp; Try AI summary</button><button class="revamp-soft-button" onclick="nav('Pipeline')">⌁ &nbsp; Open pipeline</button></div></section>
      <section class="revamp-kpis" aria-label="Deal statistics">
        <button class="revamp-kpi" onclick="nav('Pipeline')"><span class="revamp-kpi-icon cyan">％</span><span class="revamp-kpi-menu">•••</span><small>Deals win rate</small><strong>${winRate}%</strong><em>${closed.length} closed deals</em><span class="revamp-kpi-note">Won compared with closed deals</span></button>
        <button class="revamp-kpi" onclick="nav('Pipeline')"><span class="revamp-kpi-icon blue">♙</span><span class="revamp-kpi-menu">•••</span><small>Total amount won</small><strong class="revamp-money">${moneyText(wonAmounts)}</strong><em>${wonQuotes.length} accepted quotation${wonQuotes.length===1?'':'s'}</em><span class="revamp-kpi-note">Based on accepted quotations</span></button>
        <button class="revamp-kpi" onclick="nav('Pipeline')"><span class="revamp-kpi-icon teal">⌁</span><span class="revamp-kpi-menu">•••</span><small>Weighted forecast</small><strong class="revamp-money">${moneyText(forecast)}</strong><em>${activeQuotes.length} open quotation${activeQuotes.length===1?'':'s'}</em><span class="revamp-kpi-note">Stage-weighted open opportunities</span></button>
        <button class="revamp-kpi" onclick="nav('Follow-ups')"><span class="revamp-kpi-icon purple">◷</span><span class="revamp-kpi-menu">•••</span><small>Avg. sales cycle</small><strong>${avgCycle}</strong><em>${avgTasks} follow-up${avgTasks===1?'':'s'} due</em><span class="revamp-kpi-note">From lead creation to acceptance</span></button>
      </section>
      <section class="revamp-charts" aria-label="Sales pipeline analytics">
        <article class="revamp-chart-card"><div class="revamp-card-head"><h2>Pipeline</h2><button aria-label="View pipeline" onclick="nav('Pipeline')">•••</button></div><div class="revamp-bar-chart">${stages.slice(0,4).map((stage,index)=>`<button class="revamp-stage-bar" onclick="nav('Pipeline')" title="${escv(stage)}: ${stageCounts[index]}"><span>${stageCounts[index]}</span><i style="--bar:${stageColors[index]};--height:${Math.max(8,Math.round(stageCounts[index]/largestStage*78))}%"></i><small>${index+1}</small></button>`).join('')}</div><div class="revamp-chart-caption">DEAL STAGES</div></article>
        <article class="revamp-chart-card"><div class="revamp-card-head"><div><h2>Deal volume by stages</h2><p>Opportunities across your pipeline</p></div><button aria-label="View pipeline" onclick="nav('Pipeline')">•••</button></div><svg class="revamp-line-chart" viewBox="0 0 300 128" role="img" aria-label="Opportunity counts by pipeline stage"><path class="gridline" d="M20 24H286 M20 52H286 M20 80H286"/><polyline points="${polyPoints}"/><circle class="chart-points" cx="22" cy="${92-(stageCounts[0]/largestStage)*68}" r="3"/><circle class="chart-points" cx="88" cy="${92-(stageCounts[1]/largestStage)*68}" r="3"/><circle class="chart-points" cx="154" cy="${92-(stageCounts[2]/largestStage)*68}" r="3"/><circle class="chart-points" cx="220" cy="${92-(stageCounts[3]/largestStage)*68}" r="3"/><circle class="chart-points" cx="286" cy="${92-(stageCounts[4]/largestStage)*68}" r="3"/>${lineChart}</svg><div class="revamp-chart-caption">NEW LEAD &nbsp; · &nbsp; CONTACTED &nbsp; · &nbsp; PROPOSAL &nbsp; · &nbsp; WON &nbsp; · &nbsp; LOST</div></article>
        <article class="revamp-chart-card"><div class="revamp-card-head"><div><h2>Amount won by currency</h2><p>Accepted quotation totals</p></div><button aria-label="View quotations" onclick="nav('Documents')">•••</button></div>${currencies.length?currencies.map(([currency,amount],index)=>`<div class="revamp-currency-row"><div><span>${currency}</span><b>${currency==='AED'?'AED':'₹'}${Number(amount).toLocaleString(currency==='AED'?'en-AE':'en-IN',{maximumFractionDigits:0})}</b></div><i><span style="--bar:${["#12c9f4","#13d9a0","#9568f5","#ed4e9c"][index]};--width:${Math.max(4,Math.round(amount/maxCurrency*100))}%"></span></i></div>`).join(''):'<div class="revamp-empty-chart">Accepted quotation values will appear here.</div>'}<button class="revamp-chart-link" onclick="nav('Documents')">View quotations →</button></article>
      </section>
      <section class="revamp-history">
        <div class="revamp-history-head"><div><h2>Deal history</h2><p>Live CRM opportunities and quotations</p></div><div class="revamp-history-actions"><button onclick="editClient()">＋ &nbsp; Create lead</button><button class="revamp-primary" onclick="newDoc('Quotation')">＋ &nbsp; Create deal</button></div></div>
        <div class="revamp-filters"><div class="revamp-filter-left"><select id="revampStageFilter" aria-label="Filter pipeline" onchange="filterRevampDashboard()">${filters.map(stage=>`<option>${escv(stage)}</option>`).join('')}</select><select id="revampKindFilter" aria-label="Filter deal type" onchange="filterRevampDashboard()"><option>All deals</option><option>Quotations</option><option>Leads</option></select><button id="revampShowFilters" aria-expanded="false" onclick="toggleRevampFilters()">☷ &nbsp; Show filters</button></div><div class="revamp-filter-right"><span id="revampDealCount">${maxLines.length} records</span><select aria-label="Sort deal history" onchange="sortRevampDashboard(this.value)"><option>Created date</option><option>Amount</option><option>Status</option></select><button id="revampViewOptions" onclick="toggleRevampOwnerColumn()">⋮ &nbsp; Hide owner column</button></div></div><div class="revamp-extra-filters" id="revampExtraFilters" hidden><input id="revampDealSearch" type="search" placeholder="Search client, deal, or document..." aria-label="Search deal history" oninput="filterRevampDashboard()"></div>
        <div class="revamp-table-wrap"><table class="revamp-table"><thead><tr><th><input type="checkbox" aria-label="Select all deals" disabled></th><th>DEAL NAME</th><th>CLIENT</th><th>STARTED DATE</th><th>AMOUNT</th><th>STATUS</th><th>OWNER</th><th></th></tr></thead><tbody id="revampDealRows">${rows||'<tr><td colspan="8" class="revamp-empty-row">No pipeline records yet. Create a lead or quotation to get started.</td></tr>'}</tbody></table><p id="revampNoDeals" class="revamp-empty-row" hidden>No records match those filters.</p></div>
      </section>
      <div class="revamp-mobile-shortcuts"><button onclick="nav('Clients')">Clients</button><button onclick="nav('Pipeline')">Pipeline</button><button onclick="nav('Follow-ups')">My tasks (${(db.tasks||[]).filter(task=>!task.done).length})</button><button onclick="nav('Accounts')">Accounts</button></div>
    </div>`;
  };
})();
