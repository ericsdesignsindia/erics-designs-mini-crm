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
  window.openMobileWorkspace=function(name){
    nav(name);
    const sync=typeof syncCRMNow==='function'?syncCRMNow:refreshWorkspaceIfChanged;
    if(typeof sync==='function'){
      Promise.resolve(sync(true)).then(()=>render()).catch(()=>toast('Showing the saved workspace. Refresh again when you are online.'));
    }
  };
  requestAnimationFrame(()=>{if(typeof render==='function')render();});
})();
