(function(){
  window.refreshCRMWorkspace=async function(button){
    if(window.recordDraft){toast('Finish or cancel the open record before refreshing.');return;}
    if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
    try{
      if(typeof refreshWorkspaceIfChanged==='function')await refreshWorkspaceIfChanged();
      render();
      toast('Workspace refreshed.');
    }catch(error){
      toast(error?.message||'Could not refresh the workspace.');
    }finally{
      if(button){button.disabled=false;button.removeAttribute('aria-busy');}
    }
  };
  const previousCommandBar=window.commandBar;
  if(typeof previousCommandBar==='function'){
    window.commandBar=function(){
      const bar=previousCommandBar();
      return bar.replace('<button class="command-icon" onclick="showNotifications()"', '<button class="command-icon command-refresh" aria-label="Refresh workspace" onclick="refreshCRMWorkspace(this)" title="Refresh workspace">↻</button><button class="command-icon" onclick="showNotifications()"');
    };
  }
  window.openMobileWorkspaceSheet=function(){
    const id='stableMobileMenu';
    document.getElementById(id)?.remove();
    const menu=document.createElement('div');
    const items=[['Projects','▣'],['Accounts','▤'],['Calendar','□'],['Reports','▥'],['Client Process','◇'],['HR','♙'],['Automations','↗'],['Jarvis','✦']];
    menu.id=id;
    menu.className='mobile-workspace-sheet';
    menu.innerHTML=`<section class="mobile-workspace-panel" role="dialog" aria-modal="true" aria-label="More workspaces"><div class="mobile-sheet-handle" aria-hidden="true"></div><div class="mobile-sheet-head"><div><span>MORE</span><h2>Open a workspace</h2></div><button type="button" aria-label="Close more workspaces">×</button></div><div class="mobile-workspace-grid">${items.map(([name,icon])=>`<button type="button" data-view="${name}"><span aria-hidden="true">${icon}</span>${name}</button>`).join('')}</div></section>`;
    menu.addEventListener('click',event=>{
      if(event.target===menu||event.target.closest('.mobile-sheet-head button')){menu.remove();return;}
      const target=event.target.closest('[data-view]');
      if(target){menu.remove();nav(target.dataset.view);}
    });
    document.body.append(menu);
    requestAnimationFrame(()=>menu.classList.add('is-open'));
  };
  function installMobileMoreButton(){
    const more=[...document.querySelectorAll('#mobileNav button')].find(button=>(button.getAttribute('aria-label')||button.textContent||'').trim()==='More');
    if(!more||more.dataset.mobileMoreReady)return;
    more.dataset.mobileMoreReady='true';
    more.setAttribute('aria-label','More workspaces');
    more.onclick=event=>{event.preventDefault();window.openMobileWorkspaceSheet();};
  }
  window.openMobileWorkspace=function(name){
    nav(name);
    const sync=typeof syncCRMNow==='function'?syncCRMNow:refreshWorkspaceIfChanged;
    if(typeof sync==='function'){
      Promise.resolve(sync(true)).then(()=>render()).catch(()=>toast('Showing the saved workspace. Refresh again when you are online.'));
    }
  };
  function installMobileWorkspaceButtons(){
    ['Documents','Pipeline'].forEach(name=>{
      const button=[...document.querySelectorAll('#mobileNav button')].find(item=>(item.getAttribute('aria-label')||item.textContent||'').trim()===name);
      if(!button||button.dataset.mobileWorkspaceReady)return;
      button.dataset.mobileWorkspaceReady='true';
      button.setAttribute('aria-label',`${name} workspace`);
      button.onclick=event=>{event.preventDefault();window.openMobileWorkspace(name);};
    });
  }
  const renderWithMobileControls=window.render;
  if(typeof renderWithMobileControls==='function'){
    window.render=function(){const output=renderWithMobileControls.apply(this,arguments);requestAnimationFrame(()=>{installMobileMoreButton();installMobileWorkspaceButtons();});return output;};
  }
  requestAnimationFrame(()=>{installMobileMoreButton();installMobileWorkspaceButtons();render();});
})();