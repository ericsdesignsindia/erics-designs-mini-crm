'use strict';

/* A focused home screen built from the CRM's existing records and workspaces. */
(()=>{
  const moneyDue=()=>{
    try{return invoiceMetrics().outstanding}catch{return {}}
  };
  const openTasks=()=>Array.isArray(db.tasks)?db.tasks.filter(task=>!task.done):[];
  const approvedAwaitingSetup=()=>Array.isArray(db.documents)
    ?db.documents.filter(document=>document.type==='Quotation'&&document.status==='Accepted'&&!document.contractConfirmedAt)
    :[];
  const activeProjects=()=>Array.isArray(db.projects)
    ?db.projects.filter(project=>project.status!=='Completed'&&project.status!=='Cancelled')
    :[];
  const departmentCard=(name,description,detail,icon)=>`<article class="department-card">
    <div class="department-card-icon" aria-hidden="true">${icon}</div>
    <div class="department-card-copy"><h3>${name}</h3><p>${description}</p><small>${detail}</small></div>
    <div class="department-card-actions">${departmentLinks(name).map(([label,page])=>`<button class="smallbtn" onclick="nav('${page}')">${label}<span aria-hidden="true"> →</span></button>`).join('')}</div>
  </article>`;
  const departmentLinks=name=>({
    'Sales & clients':[['Clients','Clients'],['Pipeline','Pipeline']],
    'Delivery':[['Client Process','Client Process'],['Projects','Projects']],
    'Finance':[['Accounts','Accounts'],['Invoices','Final invoices']],
    'Marketing':[['Marketing','Marketing'],['Reports','Reports']],
    'Records':[['Documents','Documents'],['Contracts','Contracts']]
  }[name]||[]);

  window.overview=function(){
    const alerts=typeof notificationItems==='function'?notificationItems():[];
    const tasks=openTasks();
    const setupQuotes=approvedAwaitingSetup();
    const projects=activeProjects();
    const outstanding=moneyDue();
    const activeLeads=(db.clients||[]).filter(client=>!['Won','Lost'].includes(client.stage)).length;
    const unpaidInvoices=(db.documents||[]).filter(document=>document.type==='Invoice'&&document.status!=='Cancelled'&&totals(document).balance>0).length;
    const queue=[];

    setupQuotes.slice(0,4).forEach(quote=>queue.push({
      kind:'approval',title:`Set up approved quotation · ${quote.client?.name||'Client'}`,
      detail:`${quote.number} · Confirm scope, delivery and billing in Client Process`,
      action:"nav('Client Process')",label:'Set up work'
    }));
    alerts.slice(0,6).forEach(item=>queue.push({
      kind:item.level==='urgent'?'urgent':'due',title:item.title,detail:item.detail,
      action:item.action,label:'Open'
    }));
    const unique=queue.filter((item,index)=>queue.findIndex(other=>other.title===item.title)===index).slice(0,8);
    const queueMarkup=unique.length?unique.map(item=>`<article class="work-queue-item ${item.kind}">
      <span class="work-queue-marker" aria-hidden="true"></span>
      <div class="work-queue-copy"><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div>
      <button class="smallbtn" onclick="${item.action}">${item.label} <span aria-hidden="true">→</span></button>
    </article>`).join(''):`<div class="work-queue-empty"><span aria-hidden="true">✓</span><div><strong>Nothing is waiting on you</strong><p>New follow-ups, approvals and payment reminders will appear here.</p></div></div>`;

    return `<div class="workflow-overview">
      <section class="workday-hero">
        <div><span class="eyebrow">ERIC’S DESIGNS · WORKSPACE</span><h1>Good to see you, Eric.</h1><p>Here’s what needs attention and where your team can pick up the next step.</p></div>
        <div class="workday-actions"><button onclick="editClient()">+ New lead</button><button onclick="newDoc('Quotation')">+ Quotation</button><button class="primary" onclick="nav('Accounts')">Open Accounts</button></div>
      </section>

      <section class="work-queue-panel panel" aria-labelledby="workQueueHeading">
        <div class="work-section-heading"><div><span class="eyebrow">PRIORITY QUEUE</span><h2 id="workQueueHeading">What needs attention</h2><p class="sub">Approved work, client follow-ups and payments due.</p></div><button class="smallbtn" onclick="showNotifications()">All alerts</button></div>
        ${queueMarkup}
      </section>

      <section class="work-metrics" aria-label="Workspace summary">
        <button class="work-metric" onclick="nav('Pipeline')"><span>Active leads</span><strong>${activeLeads}</strong><small>Open opportunities · View pipeline →</small></button>
        <button class="work-metric" onclick="nav('Follow-ups')"><span>Open follow-ups</span><strong>${tasks.length}</strong><small>Tasks assigned or due · View follow-ups →</small></button>
        <button class="work-metric" onclick="nav('Projects')"><span>Active delivery</span><strong>${projects.length}</strong><small>Projects in progress · View projects →</small></button>
        <button class="work-metric" onclick="nav('Final invoices')"><span>Unpaid invoices</span><strong>${unpaidInvoices}</strong><small>${currencySummary(outstanding)} outstanding · Review accounts →</small></button>
      </section>

      <section class="department-directory" aria-labelledby="departmentHeading">
        <div class="work-section-heading"><div><span class="eyebrow">DEPARTMENT WORKSPACES</span><h2 id="departmentHeading">Go straight to the work</h2><p class="sub">Each department opens its existing records and tools.</p></div></div>
        <div class="department-grid">
          ${departmentCard('Sales & clients','Manage relationships and opportunities.',`${(db.clients||[]).length} client records`,'♧')}
          ${departmentCard('Delivery','Turn approved scope into assigned work.',`${projects.length} active projects · ${setupQuotes.length} approved to set up`,'◇')}
          ${departmentCard('Finance','Handle cash, invoices and collections.',`${unpaidInvoices} unpaid invoices`,'₹')}
          ${departmentCard('Marketing','Manage client marketing accounts and leads.','Campaigns and lead records','◉')}
          ${departmentCard('Records','Keep quotations, contracts and documents together.',`${(db.documents||[]).length} documents`,'▤')}
        </div>
      </section>

      <section class="recent-work-panel panel"><div class="work-section-heading"><div><span class="eyebrow">LATEST ACTIVITY</span><h2>Recent changes</h2></div><button class="smallbtn" onclick="nav('Reports')">Open reports</button></div>
        ${(db.activity||[]).length?(db.activity||[]).slice(0,4).map(item=>`<article class="recent-work-item"><span aria-hidden="true">•</span><div><strong>${esc(item.message||'CRM updated')}</strong><small>${esc(new Date(item.date||Date.now()).toLocaleString())}</small></div></article>`).join(''):'<p class="sub">Changes to clients, quotations, projects and accounts will appear here.</p>'}
      </section>
    </div>`;
  };
})();
