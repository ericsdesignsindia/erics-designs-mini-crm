/* Delivery ownership: connects project execution with the HR team list. */
(function(){
  const baseEditProjectTask=editProjectTask;
  editProjectTask=function(projectId,id){
    const project=db.projects.find(item=>item.id===projectId),found=project?.tasks?.find(item=>item.id===id);
    if(!project)return;
    const entry=structuredClone(found||{id:uid(),title:'',due:'',done:false,ownerId:'',ownerName:''});
    const active=(db.employees||[]).filter(employee=>employee.status==='Active');
    recordDraft=entry;
    modal(found?'Edit project task':'Add project task',field('Task *','project-task-title',entry.title,'text','required')+field('Due date','project-task-due',entry.due,'date')+`<div><label for="project-task-owner">Owner</label><select id="project-task-owner"><option value="">Unassigned</option>${active.map(employee=>`<option value="${esc(employee.id)}" ${employee.id===entry.ownerId?'selected':''}>${esc(employee.name)}${employee.role?' · '+esc(employee.role):''}</option>`).join('')}</select></div>`,()=>{
      const owner=active.find(employee=>employee.id===val('project-task-owner'));
      const next={...entry,title:val('project-task-title').trim(),due:val('project-task-due'),ownerId:owner?.id||'',ownerName:owner?.name||''};
      if(!next.title){document.getElementById('recordError').textContent='Add a task title.';return}
      if(commitChange(()=>{const list=project.tasks||(project.tasks=[]),index=list.findIndex(item=>item.id===next.id);index<0?list.push(next):list.splice(index,1,next)},`${found?'Updated':'Added'} project task ${next.title}`))closeSaved();
    });
  };
  const baseProjectWorkspace=projectWorkspace;
  projectWorkspace=function(project){
    const markup=baseProjectWorkspace(project);
    const tasks=project.tasks||[],active=(db.employees||[]).filter(employee=>employee.status==='Active');
    const assigned=tasks.filter(task=>!task.done&&task.ownerId),unassigned=tasks.filter(task=>!task.done&&!task.ownerId);
    return markup+`<section class="panel project-team"><div class="dialog-title"><div><div class="eyebrow">TEAM DELIVERY</div><h2>Ownership and workload</h2><p class="sub">Assign a task owner so Operations knows who is responsible for the next delivery action.</p></div><button class="smallbtn" onclick="nav('HR')">Open HR</button></div><div class="stats three"><div class="stat"><span>Active team</span><strong>${active.length}</strong><small>${active.length?active.map(employee=>esc(employee.name)).join(' · '):'Add team members in HR'}</small></div><div class="stat"><span>Assigned tasks</span><strong>${assigned.length}</strong><small>Owned by a delivery team member</small></div><div class="stat"><span>Unassigned tasks</span><strong>${unassigned.length}</strong><small>${unassigned.length?'Assign an owner before work starts':'All open tasks have an owner'}</small></div></div>${tasks.length?`<div class="project-finance-list">${tasks.map(task=>`<div><div><b>${esc(task.title)}</b><small>${task.done?'Completed':task.ownerName?`Owner: ${esc(task.ownerName)}`:'No owner assigned'}${task.due?' · Due '+esc(task.due):''}</small></div><button class="smallbtn" onclick="editProjectTask('${project.id}','${task.id}')">${task.ownerName?'Change owner':'Assign owner'}</button></div>`).join('')}</div>`:'<p class="sub">Add delivery tasks, then assign the right team member to each one.</p>'}</section>`;
  };
})();
