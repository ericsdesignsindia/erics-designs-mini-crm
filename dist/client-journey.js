/* Shared Client 360 timeline: keeps sales, documents, delivery, and finance in one client record. */
(function(){
  const dateValue=value=>String(value||'').slice(0,10)||'—';
  const findClientDocuments=client=>db.documents.filter(item=>item.client&&(item.client.id===client.id||String(item.client.name||'').trim().toLowerCase()===String(client.name||'').trim().toLowerCase()));
  const documentLabel=document=>document.type==='Invoice'?'Final invoice':document.type||'Document';
  const stageFor=documents=>{
    const quotation=documents.find(item=>item.type==='Quotation'&&item.status!=='Cancelled');
    const proforma=documents.find(item=>item.type==='Proforma'&&item.status!=='Cancelled');
    const invoice=documents.find(item=>item.type==='Invoice'&&item.status!=='Cancelled');
    if(invoice&&totals(invoice).balance<=0)return ['Completed','Final payment received'];
    if(invoice)return ['Final payment','Final invoice is ready'];
    if(proforma&&(proforma.payments||[]).length)return ['Delivery','Advance payment recorded'];
    if(proforma)return ['Advance due','Proforma is ready'];
    if(quotation&&quotation.contractConfirmedAt)return ['Contract','Contract confirmed'];
    if(quotation&&quotation.status==='Accepted')return ['Contract','Quotation approved'];
    if(quotation&&quotation.status==='Sent')return ['Approval','Quotation sent'];
    return ['Sales','Create and send a quotation'];
  };
  const iconFor=kind=>kind==='task'?'✓':kind==='project'?'◫':kind==='payment'?'₹':'▤';
  const detailBase=clientDetail;
  clientDetail=function(){
    const markup=detailBase();
    const client=db.clients.find(item=>item.id===selectedClient);
    if(!client)return markup;
    const documents=findClientDocuments(client);
    const tasks=db.tasks.filter(item=>item.clientId===client.id&&!item.done);
    const projects=db.projects.filter(item=>item.clientId===client.id);
    const payments=documents.flatMap(document=>(document.payments||[]).map(payment=>({kind:'payment',date:payment.date||document.updated||document.date,title:`Payment recorded · ${document.number}`,detail:fmt(document,payment.amount),document})));
    const events=[
      ...documents.map(document=>({kind:'document',date:document.updated||document.date,title:`${documentLabel(document)} · ${document.number}`,detail:document.status||'Draft',document})),
      ...tasks.map(task=>({kind:'task',date:task.due,title:task.title,detail:`Follow-up due ${dateValue(task.due)}`,task})),
      ...projects.map(project=>({kind:'project',date:project.updated||project.due||project.created,title:`Project · ${project.name}`,detail:project.status||'Planned',project})),
      ...payments
    ].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,12);
    const [stage,detail]=stageFor(documents);
    const nextTask=tasks.slice().sort((a,b)=>String(a.due).localeCompare(String(b.due)))[0];
    const nextAction=nextTask?`${nextTask.title} · ${dateValue(nextTask.due)}`:detail;
    return markup+`<section class="panel client-journey"><div class="dialog-title"><div><div class="eyebrow">CONNECTED WORKFLOW</div><h2>Client 360 timeline</h2><p class="sub">Sales, documents, delivery, and finance activity for ${esc(client.name)}.</p></div><div class="actions"><button class="smallbtn" onclick="nav('Client Process')">Open client process</button><button class="smallbtn" onclick="nav('Follow-ups')">Follow-ups</button></div></div><div class="stats three"><div class="stat"><span>Current stage</span><strong>${esc(stage)}</strong><small>${esc(detail)}</small></div><div class="stat"><span>Next action</span><strong>${esc(nextTask?'Follow up':'Move forward')}</strong><small>${esc(nextAction)}</small></div><div class="stat"><span>Linked work</span><strong>${documents.length+projects.length}</strong><small>${documents.length} documents · ${projects.length} projects</small></div></div><div class="client-journey-list">${events.length?events.map(event=>`<article><i>${iconFor(event.kind)}</i><div><b>${esc(event.title)}</b><small>${esc(event.detail)} · ${esc(dateValue(event.date))}</small></div>${event.document?`<button class="smallbtn" onclick="openDoc('${event.document.id}')">Open</button>`:event.project?`<button class="smallbtn" onclick="selectedProjectWorkspace='${event.project.id}';nav('Projects')">Open</button>`:''}</article>`).join(''):'<p class="sub">No linked activity yet. Create a quotation to begin this client workflow.</p>'}</div></section>`;
  };
})();
