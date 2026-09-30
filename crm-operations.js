'use strict';
/* Operational workspaces built on top of the existing CRM records. */
(()=>{
  if(!db.projectChecklists||typeof db.projectChecklists!=='object')db.projectChecklists={};
  const linkedClient=document=>db.clients.find(client=>quotationMatchesClient(document,client));
  const openDocument=document=>`<button class="smallbtn" onclick="openDoc('${document.id}')">Open</button>`;
  const fmtShort=(document,value)=>fmt(document,value||0);
  const projectChecklist=(project)=>{
    const defaults=['Scope confirmed','Team assigned','Milestones planned','Client approval recorded','Delivery handed over'];
    const values=db.projectChecklists[project.id]||{};
    return `<section class="panel delivery-checklist"><div class="dialog-title"><div><div class="eyebrow">DELIVERY CHECKLIST</div><h2>${esc(project.name)}</h2></div><span class="counts">${Object.values(values).filter(Boolean).length}/${defaults.length} complete</span></div><div class="checklist-items">${defaults.map((label,index)=>`<label><input type="checkbox" ${values[index]?'checked':''} onchange="toggleProjectChecklist('${project.id}',${index},this.checked)"><span>${label}</span></label>`).join('')}</div></section>`;
  };
  window.toggleProjectChecklist=function(projectId,index,done){commitChange(()=>{db.projectChecklists[projectId]=db.projectChecklists[projectId]||{};db.projectChecklists[projectId][index]=Boolean(done)},'Updated project delivery checklist')};
  const collectionBoard=()=>{
    const invoices=db.documents.filter(document=>document.type==='Invoice'&&status(document)!=='Cancelled');
    const awaitingAdvance=db.documents.filter(document=>document.type==='Proforma'&&status(document)!=='Paid'&&status(document)!=='Cancelled');
    const overdue=invoices.filter(document=>status(document)==='Overdue');
    const partPaid=invoices.filter(document=>status(document)==='Part paid');
    const card=(title,items,empty)=>`<section class="collection-lane"><div><span>${title}</span><b>${items.length}</b></div>${items.length?items.slice(0,5).map(document=>`<article><strong>${esc(document.client.name)}</strong><small>${esc(document.number)} · ${fmtShort(document,totals(document).balance||totals(document).total)}</small>${openDocument(document)}</article>`).join(''):`<p>${empty}</p>`}</section>`;
    return `<section class="panel collection-board"><div class="dialog-title"><div><div class="eyebrow">PAYMENT COLLECTIONS</div><h2>What needs follow-up</h2><p class="sub">Open each record to prepare a reminder or record payment.</p></div><button class="smallbtn" onclick="nav('Final invoices')">All invoices</button></div><div class="collection-grid">${card('Advance requested',awaitingAdvance,'No unpaid proformas')}${card('Part paid',partPaid,'No part-paid invoices')}${card('Overdue',overdue,'No overdue invoices')}</div></section>`;
  };
  const workflowTracker=client=>{
    const documents=clientDocuments(client),hasType=type=>documents.some(document=>document.type===type),invoice=documents.find(document=>document.type==='Invoice'),steps=[['Quotation',hasType('Quotation')],['Contract',documents.some(document=>document.contractConfirmed)],['Proforma',hasType('Proforma')],['Advance',documents.some(document=>(document.payments||[]).length)],['Final invoice',Boolean(invoice)],['Final receipt',Boolean(invoice&&status(invoice)==='Paid')]];
    return `<section class="panel workflow-tracker"><div class="eyebrow">CLIENT PROCESS</div><h2>Document status tracker</h2><div>${steps.map(([label,complete],index)=>`<span class="${complete?'complete':''}"><i>${complete?'✓':index+1}</i>${label}</span>`).join('')}</div></section>`;
  };
  const savedViewsPanel=()=>`<section class="panel saved-views"><div class="dialog-title"><div><div class="eyebrow">SAVED VIEWS</div><h2>Jump to a focused list</h2><p class="sub">Each view keeps the existing records and opens the relevant work list.</p></div></div><div><button class="smallbtn" onclick="nav('Final invoices');filter='Overdue';render()">Overdue invoices</button><button class="smallbtn" onclick="nav('Proforma invoices');filter='Unpaid';render()">Advance requests</button><button class="smallbtn" onclick="nav('Follow-ups');filter='Open';render()">Open follow-ups</button><button class="smallbtn" onclick="nav('Quotations');filter='Draft';render()">Quotation drafts</button></div></section>`;
  const todayWorkspace=()=>{
    const todayItems=notificationItems(), projectDue=db.projects.filter(project=>project.due&&project.due<=addDays(7)&&project.status!=='Completed').sort((a,b)=>a.due.localeCompare(b.due));
    return pageHeader('Today.',`<button onclick="nav('Follow-ups')">Follow-ups</button><button class="primary" onclick="showNotifications()">View alerts</button>`,'One focused workspace for client work, collections, and delivery deadlines.')+`<div class="stats three"><div class="stat"><span>Needs attention</span><strong>${todayItems.length}</strong><small>Payment, quotation and task alerts</small></div><div class="stat"><span>Projects due soon</span><strong>${projectDue.length}</strong><small>Due within seven days</small></div><div class="stat"><span>Open follow-ups</span><strong>${db.tasks.filter(task=>!task.done).length}</strong><small>Keep conversations moving</small></div></div><div class="dashboard-columns"><section class="panel"><div class="dialog-title"><div><div class="eyebrow">PRIORITY QUEUE</div><h2>Act now</h2></div><button class="smallbtn" onclick="showNotifications()">All alerts</button></div>${todayItems.length?todayItems.slice(0,8).map(item=>`<div class="taskrow"><div><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div><button class="smallbtn" onclick="${item.action}">Open</button></div>`).join(''):'<p class="sub">Nothing urgent today.</p>'}</section><section class="panel"><div class="eyebrow">DELIVERY DATES</div><h2>Projects due soon</h2>${projectDue.length?projectDue.map(project=>`<div class="taskrow"><div><strong>${esc(project.name)}</strong><p>${esc(db.clients.find(client=>client.id===project.clientId)?.name||'No client')} · Due ${esc(project.due)}</p></div><button class="smallbtn" onclick="selectedProjectWorkspace='${project.id}';nav('Projects')">Open</button></div>`).join(''):'<p class="sub">No project deadlines in the next seven days.</p>'}</section></div>${collectionBoard()}${savedViewsPanel()}`;
  };
  const projectBase=projects;
  projects=function(){const markup=projectBase();const selected=(db.projects||[]).find(project=>project.id===selectedProjectWorkspace);return selected?markup+projectChecklist(selected):markup};
  const accountsBase=accounts;
  accounts=function(){const markup=accountsBase();const marker='<section class="panel"><div class="dialog-title"><div><div class="eyebrow">VENDOR BILLS</div>';return markup.includes(marker)?markup.replace(marker,collectionBoard()+marker):markup+collectionBoard()};
  const clientDetailBase=clientDetail;
  clientDetail=function(){const markup=clientDetailBase();const client=db.clients.find(item=>item.id===selectedClient);return client?markup+workflowTracker(client):markup};
  const renderOperations=render;
  render=function(){const result=renderOperations();const app=document.getElementById('app');if(view==='Today'&&app)app.innerHTML=todayWorkspace();if(app){if(view==='Today')app.className='ui-workspace ui-command ui-today';const actions=document.querySelector('#commandBar .command-actions');if(actions&&!actions.querySelector('[data-today-workspace]')){const button=document.createElement('button');button.dataset.todayWorkspace='1';button.className='command-icon';button.title='Today';button.setAttribute('aria-label','Today workspace');button.textContent='✓';actions.prepend(button)}}return result};
  document.addEventListener('click',event=>{if(!event.target.closest('[data-today-workspace]'))return;event.preventDefault();event.stopImmediatePropagation();draft=null;view='Today';query='';filter='';selectedClient=null;render()},true);
})();
