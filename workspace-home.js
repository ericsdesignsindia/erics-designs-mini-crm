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
      return `<tr data-search="${escv(search)}" data-status="${escv(status)}"><td><span class="home-project-name"><i style="--status-color:${stageColors[status]}"></i><b>${escv(project.name||'Untitled project')}</b></span></td><td>${escv(clientName(project))}</td><td>${escv(tasks.length?`${completed} / ${tasks.length} tasks`:'—')}</td><td>${escv(due)}</td><td><span class="home-status ${statusClass}">${escv(status)}</span></td><td><button class="home-open-project" onclick="editProject('${escv(project.id)}')">Open</button></td></tr>`;
    }).join('');
    const focuses=dueTasks.slice(0,5).map(task=>{
      const client=db.clients.find(item=>item.id===task.clientId)?.name;
      const overdue=task.due&&task.due<today();
      return `<button class="home-focus-item ${overdue?'is-overdue':''}" onclick="editTask('${escv(task.id)}')"><span class="home-focus-mark">${overdue?'!':'✓'}</span><span><b>${escv(task.title||'Follow-up')}</b><small>${escv(client||'CRM follow-up')}${task.due?` · Due ${escv(task.due)}`:''}</small></span><span class="home-focus-arrow">›</span></button>`;
    }).join('');
    const periodLabel=period==='Weekly'?'7 days':period==='Monthly'?'30 days':'90 days';
    const statusFilters=['All projects','Planning','In progress','At risk','Completed'];
    return `<div class="home-dashboard">
      <header class="home-dashboard-head"><div><div class="home-breadcrumb"><span>WORKSPACE</span><i>›</i><b>OVERVIEW</b></div><h1>Good morning, Eric</h1><p>Here’s the work moving across your team.</p></div><div class="home-header-actions"><button onclick="editClient()">＋ New lead</button><button onclick="newDoc('Quotation')">＋ Quotation</button><button class="home-primary" onclick="editProject()">＋ New project</button></div></header>
      <div class="home-period-row"><div><span class="home-eyebrow">WORKSPACE OVERVIEW</span><h2>Delivery and client activity</h2></div><div class="home-period-switch" role="group" aria-label="Dashboard time period">${['Weekly','Monthly','Quarterly'].map(value=>`<button class="${period===value?'active':''}" aria-pressed="${period===value}" onclick="setHomePeriod('${value}')">${value}</button>`).join('')}</div></div>
      <section class="home-kpis" aria-label="CRM summary">
        <button class="home-kpi" onclick="nav('Projects')"><span class="home-kpi-icon blue">▣</span><span class="home-kpi-label">Active projects</span><b>${activeProjects.length}</b><small>${counts['At risk']} need attention</small></button>
        <button class="home-kpi" onclick="nav('Pipeline')"><span class="home-kpi-icon purple">⌁</span><span class="home-kpi-label">Open opportunities</span><b>${leads.length}</b><small>${newClients} new clients in ${periodLabel}</small></button>
        <button class="home-kpi" onclick="nav('Final invoices')"><span class="home-kpi-icon green">₹</span><span class="home-kpi-label">Outstanding invoices</span><b class="home-money">${escv(currencyTotals(metrics.outstanding))}</b><small>${metrics.overdue||0} overdue invoice${metrics.overdue===1?'':'s'}</small></button>
        <button class="home-kpi" onclick="nav('Follow-ups')"><span class="home-kpi-icon orange">✓</span><span class="home-kpi-label">Follow-ups due</span><b>${dueTasks.length}</b><small>${activeTaskCount()} open task${activeTaskCount()===1?'':'s'} total</small></button>
      </section>
      <section class="home-analytics-grid">
        <article class="home-card home-delivery-card"><div class="home-card-head"><div><h2>Delivery overview</h2><p>Progress across your client projects</p></div><button onclick="nav('Projects')">All projects <span>›</span></button></div><div class="home-delivery-content"><div class="home-donut" style="--home-donut:${allProjects.length?gradient:'#e7edf5 0% 100%'}" role="img" aria-label="Project status distribution. Overall progress ${overallProgress} percent"><div><b>${overallProgress}%</b><small>Overall<br>progress</small></div></div><div class="home-legend">${['Completed','In progress','Planning','At risk'].map(status=>`<button data-home-status="${status}" class="home-legend-row" aria-pressed="${(window.crmHomeStatusFilter||'All projects')===status}" onclick="filterHomeProjectStatus('${status}')"><i style="--status-color:${stageColors[status]}"></i><span>${status}</span><b>${counts[status]}</b><small>${allProjects?Math.round(counts[status]/allProjects.length*100):0}%</small></button>`).join('')}</div></div><div class="home-card-foot"><span>${allProjects.length} total project${allProjects.length===1?'':'s'}</span><span>${doneTasks} of ${allTasks} delivery tasks completed</span></div></article>
        <article class="home-card home-status-card"><div class="home-card-head"><div><h2>Projects by status</h2><p>Number of projects in each stage</p></div><button aria-label="Open projects" onclick="nav('Projects')">•••</button></div><div class="home-status-bars">${['Planning','In progress','At risk','Completed'].map(status=>`<button class="home-status-bar-row" onclick="filterHomeProjectStatus('${status}')"><span>${status}</span><i><b style="--bar-color:${stageColors[status]};--bar-width:${Math.max(0,Math.round(counts[status]/maxCount*100))}%"></b></i><strong>${counts[status]}</strong></button>`).join('')}</div><div class="home-status-foot"><span>Showing live project records</span><button onclick="editProject()">＋ Add project</button></div></article>
      </section>
      <section class="home-lower-grid">
        <article class="home-card home-activity-card"><div class="home-card-head"><div><h2>Team activity</h2><p>Recent and upcoming work across your team</p></div><button onclick="nav('Projects')">View all projects <span>→</span></button></div><div class="home-project-toolbar"><div class="home-project-tabs" role="group" aria-label="Filter projects">${statusFilters.map(status=>`<button data-home-status="${status}" class="${(window.crmHomeStatusFilter||'All projects')===status?'active':''}" aria-pressed="${(window.crmHomeStatusFilter||'All projects')===status}" onclick="filterHomeProjectStatus('${status}')">${status}</button>`).join('')}</div><span id="homeProjectCount">${ordered.length} ${ordered.length===1?'project':'projects'}</span></div><label class="home-project-search"><span>⌕</span><input id="homeProjectSearch" type="search" placeholder="Search client, project, or service..." oninput="filterHomeProjects()" aria-label="Search project activity"></label><div class="home-project-table-wrap"><table class="home-project-table"><thead><tr><th>PROJECT</th><th>CLIENT</th><th>WORK PLAN</th><th>DUE DATE</th><th>STATUS</th><th></th></tr></thead><tbody id="homeProjectRows">${projectRows||'<tr><td colspan="6" class="home-empty-row">No delivery projects yet. Start one when a quotation is approved.</td></tr>'}</tbody></table><p id="homeProjectsEmpty" class="home-empty-row" hidden>No projects match this search or status.</p></div></article>
        <article class="home-card home-focus-card"><div class="home-card-head"><div><h2>Today’s focus</h2><p>Follow-ups that need a next step</p></div><button onclick="nav('Follow-ups')">View all <span>→</span></button></div><div class="home-focus-list">${focuses||'<div class="home-focus-empty"><span>✓</span><b>You’re all caught up</b><small>No follow-ups are due today.</small></div>'}</div><div class="home-focus-actions"><button onclick="editTask()">＋ Add follow-up</button><button onclick="nav('Calendar')">Open calendar →</button></div></article>
      </section>
      <nav class="home-shortcuts" aria-label="Quick workspaces"><button onclick="nav('Clients')">Clients <span>→</span></button><button onclick="nav('Pipeline')">Pipeline <span>→</span></button><button onclick="nav('Documents')">Documents <span>→</span></button><button onclick="nav('Accounts')">Accounts <span>→</span></button></nav>
    </div>`;
  };
})();
