'use strict';

/* Live delivery-first Overview inspired by the project dashboard reference. */
(()=>{
  const escv=value=>typeof esc==='function'?esc(String(value??'')):String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const dateOf=value=>{if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:date};
  const localDay=()=>{const value=new Date();value.setHours(0,0,0,0);return value};
  const periodDays={Weekly:7,Monthly:30,Quarterly:90};
  const currentPeriod=()=>periodDays[window.crmHomePeriod]?window.crmHomePeriod:'Weekly';
  const projectDate=project=>project.updatedAt||project.updated||project.createdAt||project.created||'';
  const clientName=project=>db.clients.find(client=>client.id===project.clientId)?.name||'No client linked';
  const projectProgress=project=>{
    const tasks=Array.isArray(project.tasks)?project.tasks:[];
    if(tasks.length)return Math.round(tasks.filter(task=>task.done).length/tasks.length*100);
    return project.status==='Completed'?100:project.status==='In progress'?50:0;
  };
  const projectStage=project=>{
    if(project.status==='Completed')return 'Completed';
    const today=localDay(),due=dateOf(project.due);
    if(due&&due<today)return 'At risk';
    if(project.status==='In progress'||(project.tasks||[]).some(task=>task.started||task.done||task.status==='In progress'))return 'In progress';
    return 'Planning';
  };
  const currencyTotals=map=>Object.entries(map||{}).filter(([,value])=>Number(value)>0).map(([currency,value])=>`${currency==='AED'?'AED ':'₹'}${Number(value).toLocaleString(currency==='AED'?'en-AE':'en-IN',{maximumFractionDigits:0})}`).join(' · ')||'₹0';
  const projects=()=>Array.isArray(db.projects)?db.projects:[];
  const activeTaskCount=()=>((db.tasks||[]).filter(task=>!task.done).length);

  window.setHomePeriod=function(period){
    if(!periodDays[period])return;
    window.crmHomePeriod=period;
    if(typeof render==='function')render();
  };

  window.filterHomeProjects=function(){
    const search=(document.getElementById('homeProjectSearch')?.value||'').trim().toLowerCase();
    const statusFilter=window.crmHomeStatusFilter||'All projects';
    let shown=0;
    document.querySelectorAll('#homeProjectRows tr[data-search]').forEach(row=>{
      const matchSearch=!search||row.dataset.search.includes(search);
      const matchStatus=statusFilter==='All projects'||row.dataset.status===statusFilter;
      row.hidden=!(matchSearch&&matchStatus);if(matchSearch&&matchStatus)shown++;
    });
    const empty=document.getElementById('homeProjectsEmpty');if(empty)empty.hidden=shown>0;
    const count=document.getElementById('homeProjectCount');if(count)count.textContent=`${shown} ${shown===1?'project':'projects'}`;
  };

  window.filterHomeProjectStatus=function(status){
    window.crmHomeStatusFilter=status;
    document.querySelectorAll('[data-home-status]').forEach(button=>{
      const active=button.dataset.homeStatus===status;
      button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    });
    filterHomeProjects();
  };

  window.overview=function(){
    const period=currentPeriod(),days=periodDays[period],cutoff=new Date();cutoff.setDate(cutoff.getDate()-days);cutoff.setHours(0,0,0,0);
    const allProjects=projects();
    const categorized=allProjects.map(project=>({project,status:projectStage(project),progress:projectProgress(project)}));
    const counts=Object.fromEntries(['Completed','In progress','Planning','At risk'].map(status=>[status,categorized.filter(item=>item.status===status).length]));
    const activeProjects=categorized.filter(item=>item.status!=='Completed');
    const doneTasks=allProjects.flatMap(project=>project.tasks||[]).filter(task=>task.done).length;
    const allTasks=allProjects.flatMap(project=>project.tasks||[]).length;
    const overallProgress=allTasks?Math.round(doneTasks/allTasks*100):(allProjects.length?Math.round(categorized.reduce((sum,item)=>sum+item.progress,0)/allProjects.length):0);
    const metrics=typeof invoiceMetrics==='function'?invoiceMetrics():{outstanding:{},overdue:0};
    const leads=(Array.isArray(db.clients)?db.clients:[]).filter(client=>!['Won','Lost'].includes(client.stage));
    const pipelineStages=['New lead','Contacted','Proposal sent','Won','Lost'];
    const pipelineCounts=Object.fromEntries(pipelineStages.map(stage=>[stage,(db.clients||[]).filter(client=>client.stage===stage).length]));
    const newClients=(Array.isArray(db.clients)?db.clients:[]).filter(client=>{const date=dateOf(client.createdAt||client.created);return date&&date>=cutoff}).length;
    const dueTasks=(db.tasks||[]).filter(task=>!task.done&&task.due&&task.due<=today()).sort((a,b)=>String(a.due).localeCompare(String(b.due)));
    const stageColors={'Completed':'#42bd83','In progress':'#438bea','Planning':'#a58af6','At risk':'#f2a84c'};
    const maxCount=Math.max(1,...Object.values(counts));
    let offset=0;const gradient=['Completed','In progress','Planning','At risk'].map(status=>{
      const start=offset;offset+=allProjects?counts[status]/allProjects.length*100:0;
      return `${stageColors[status]} ${start}% ${offset}%`;
    }).join(',');
    const ordered=[...categorized].sort((a,b)=>{
      const aDue=dateOf(a.project.due)?.getTime()||Number.MAX_SAFE_INTEGER;
      const bDue=dateOf(b.project.due)?.getTime()||Number.MAX_SAFE_INTEGER;
      return (a.status==='At risk'?-1:0)-(b.status==='At risk'?-1:0)||aDue-bDue;
    });
    const projectRows=ordered.map(({project,status,progress})=>{
      const tasks=Array.isArray(project.tasks)?project.tasks:[];
      const completed=tasks.filter(task=>task.done).length;
      const due=project.due?new Date(`${project.due}T12:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'Not set';
      const search=`${project.name||''} ${clientName(project)} ${project.notes||''}`.toLowerCase();
      const statusClass=status.toLowerCase().replaceAll(' ','-');
      return `<tr data-search="${escv(search)}" data-status="${escv(status)}"><td data-label="Project"><span class="home-project-name"><i style="--status-color:${stageColors[status]}"></i><b>${escv(project.name||'Untitled project')}</b></span></td><td data-label="Client">${escv(clientName(project))}</td><td data-label="Work plan">${escv(tasks.length?`${completed} / ${tasks.length} tasks`:'—')}</td><td data-label="Due date">${escv(due)}</td><td data-label="Status"><span class="home-status ${statusClass}">${escv(status)}</span></td><td data-label="Actions"><button class="home-open-project" onclick="editProject('${escv(project.id)}')">Open</button></td></tr>`;
    }).join('');
    const focuses=dueTasks.slice(0,4).map(task=>{
      const client=db.clients.find(item=>item.id===task.clientId)?.name;
      const overdue=task.due&&task.due<today();
      return `<button class="home-focus-item ${overdue?'is-overdue':''}" onclick="editTask('${escv(task.id)}')"><span class="home-focus-mark">${overdue?'!':'✓'}</span><span><b>${escv(task.title||'Follow-up')}</b><small>${escv(client||'CRM follow-up')}${task.due?` · Due ${escv(task.due)}`:''}</small></span><span class="home-focus-arrow">›</span></button>`;
    }).join('');
    const periodLabel=period==='Weekly'?'7 days':period==='Monthly'?'30 days':'90 days';
    const statusFilters=['All projects','Planning','In progress','At risk','Completed'];
    const stageTone={'New lead':'cyan','Contacted':'blue','Proposal sent':'violet','Won':'green','Lost':'rose'};
    const deliveryTone={'Completed':'green','In progress':'cyan','Planning':'violet','At risk':'rose'};
    const pipelineTotal=pipelineStages.reduce((sum,stage)=>sum+pipelineCounts[stage],0);
    const pipelineRows=pipelineStages.map(stage=>`<button class="home-flow-stage ${stageTone[stage]}" onclick="nav('Pipeline')"><span>${escv(stage)}</span><b>${pipelineCounts[stage]}</b><i><em style="width:${pipelineTotal?Math.round(pipelineCounts[stage]/pipelineTotal*100):0}%"></em></i></button>`).join('');
    const deliveryRows=['In progress','Planning','At risk','Completed'].map(status=>`<button class="home-status-bar-row ${deliveryTone[status]}" onclick="filterHomeProjectStatus('${status}')"><span>${escv(status)}</span><i><b style="--bar-color:${stageColors[status]};--bar-width:${Math.max(0,Math.round(counts[status]/maxCount*100))}%"></b></i><strong>${counts[status]}</strong></button>`).join('');
    const summaryDate=new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'short'});
    return `<div class="home-dashboard">
      <header class="home-dashboard-head"><div><div class="home-breadcrumb"><span>${escv(summaryDate)}</span><i>·</i><b>ERIC’S DESIGNS</b></div><h1>${crmGreeting()}, Eric</h1><p>Here’s your client work, pipeline, and next steps for today.</p></div><div class="home-header-actions"><button onclick="editClient()">＋ New lead</button><button onclick="newDoc('Quotation')">＋ Quotation</button><button class="home-primary" onclick="editProject()">＋ New project</button></div></header>
      <section class="home-summary-strip" aria-label="Business reminders"><button onclick="nav('Follow-ups')"><i class="summary-dot amber"></i><span><b>${dueTasks.length}</b> follow-ups due</span><small>${activeTaskCount()} open tasks</small></button><button onclick="nav('Pipeline')"><i class="summary-dot cyan"></i><span><b>${leads.length}</b> open opportunities</span><small>${newClients} added in ${periodLabel}</small></button><button onclick="nav('Final invoices')"><i class="summary-dot violet"></i><span><b>${escv(currencyTotals(metrics.outstanding))}</b> outstanding</span><small>${metrics.overdue||0} overdue invoices</small></button></section>
      <section class="home-overview-grid">
        <article class="home-card home-client-work-card"><div class="home-card-head"><div><span class="home-eyebrow">CLIENT WORKSPACE</span><h2>Delivery & pipeline</h2><p>Live progress across your clients</p></div><div class="home-period-switch" role="group" aria-label="Dashboard time period">${['Weekly','Monthly','Quarterly'].map(value=>`<button class="${period===value?'active':''}" aria-pressed="${period===value}" onclick="setHomePeriod('${value}')">${value}</button>`).join('')}</div></div>
          <div class="home-work-hero"><div><span>Active projects</span><strong>${activeProjects.length}</strong><small>${allProjects.length} total · ${counts['At risk']} at risk</small></div><div class="home-work-progress" style="--progress:${overallProgress}%;--home-donut:${allProjects.length?gradient:'#293147 0% 100%'}" role="img" aria-label="Overall delivery progress ${overallProgress} percent"><div><b>${overallProgress}%</b><small>delivery<br>complete</small></div></div></div>
          <div class="home-delivery-allocation">${['In progress','Planning','At risk','Completed'].map(status=>`<button class="home-allocation-row" onclick="filterHomeProjectStatus('${status}')"><span><i class="${deliveryTone[status]}"></i>${status}</span><b>${counts[status]}</b><small>${allProjects.length?Math.round(counts[status]/allProjects.length*100):0}%</small><em><span style="width:${allProjects.length?Math.round(counts[status]/allProjects.length*100):0}%"></span></em></button>`).join('')}</div>
          <div class="home-account-totals"><button onclick="nav('Projects')"><small>Tasks completed</small><b>${doneTasks} <span>/ ${allTasks}</span></b></button><button onclick="nav('Pipeline')"><small>Won clients</small><b>${pipelineCounts.Won}</b></button><button onclick="nav('Final invoices')"><small>Invoices overdue</small><b>${metrics.overdue||0}</b></button></div>
        </article>
        <article class="home-card home-focus-card"><div class="home-card-head"><div><span class="home-eyebrow">YOUR NEXT STEPS</span><h2>Needs attention</h2><p>Follow-ups that need a next step</p></div><button onclick="nav('Follow-ups')">View all <span>→</span></button></div><div class="home-focus-list">${focuses||'<div class="home-focus-empty"><span>✓</span><b>You’re all caught up</b><small>No follow-ups are due today.</small></div>'}</div><div class="home-focus-actions"><button onclick="editTask()">＋ Add follow-up</button><button onclick="nav('Calendar')">Open calendar →</button></div></article>
      </section>
      <section class="home-secondary-grid">
        <article class="home-card home-pipeline-card"><div class="home-card-head"><div><span class="home-eyebrow">SALES</span><h2>Pipeline stages</h2><p>${pipelineTotal} client records · click to open pipeline</p></div><button onclick="nav('Pipeline')">View pipeline <span>→</span></button></div><div class="home-pipeline-flow">${pipelineRows}</div></article>
        <article class="home-card home-status-card"><div class="home-card-head"><div><span class="home-eyebrow">DELIVERY</span><h2>Project status</h2><p>Work currently in progress</p></div><button onclick="nav('Projects')">All projects <span>→</span></button></div><div class="home-status-bars">${deliveryRows}</div><div class="home-status-foot"><span>Based on live project records</span><button onclick="editProject()">＋ Add project</button></div></article>
      </section>
      <section class="home-lower-grid">
        <article class="home-card home-activity-card"><div class="home-card-head"><div><span class="home-eyebrow">RECENT DELIVERY</span><h2>Client projects</h2><p>Current work and upcoming delivery dates</p></div><button onclick="nav('Projects')">View all <span>→</span></button></div><div class="home-project-toolbar"><div class="home-project-tabs" role="group" aria-label="Filter projects">${statusFilters.map(status=>`<button data-home-status="${status}" class="${(window.crmHomeStatusFilter||'All projects')===status?'active':''}" aria-pressed="${(window.crmHomeStatusFilter||'All projects')===status}" onclick="filterHomeProjectStatus('${status}')">${status}</button>`).join('')}</div><span id="homeProjectCount">${ordered.length} ${ordered.length===1?'project':'projects'}</span></div><label class="home-project-search"><span>⌕</span><input id="homeProjectSearch" type="search" placeholder="Search client, project, or service..." oninput="filterHomeProjects()" aria-label="Search project activity"></label><div class="home-project-table-wrap"><table class="home-project-table"><thead><tr><th>PROJECT</th><th>CLIENT</th><th>WORK PLAN</th><th>DUE DATE</th><th>STATUS</th><th></th></tr></thead><tbody id="homeProjectRows">${projectRows||'<tr><td colspan="6" class="home-empty-row">No delivery projects yet. Start one when a quotation is approved.</td></tr>'}</tbody></table><p id="homeProjectsEmpty" class="home-empty-row" hidden>No projects match this search or status.</p></div></article>
      </section>
      <nav class="home-shortcuts" aria-label="Quick workspaces"><button onclick="nav('Clients')">Clients <span>→</span></button><button onclick="nav('Pipeline')">Pipeline <span>→</span></button><button onclick="nav('Documents')">Documents <span>→</span></button><button onclick="nav('Accounts')">Accounts <span>→</span></button></nav>
    </div>`;
  };
})();
