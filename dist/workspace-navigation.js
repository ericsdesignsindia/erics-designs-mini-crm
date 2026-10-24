/* Reset page scroll when the CRM changes its selected workspace. */
(function installWorkspaceScrollReset(){
  const navigation=document.getElementById('nav');
  if(!navigation||navigation.dataset.scrollResetObserver==='installed')return;
  navigation.dataset.scrollResetObserver='installed';

  const activeWorkspace=()=>{
    const active=navigation.querySelector('button.active');
    return active?.title||active?.querySelector('.nav-label')?.textContent?.trim()||active?.textContent?.trim()||'';
  };
  let previousWorkspace=activeWorkspace();
  const resetScroll=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    window.scrollTo({top:0,left:0,behavior:'auto'});
    const main=document.querySelector('.shell>main');
    if(main){main.scrollTop=0;main.scrollLeft=0;}
  }));

  new MutationObserver(()=>{
    const nextWorkspace=activeWorkspace();
    if(nextWorkspace&&nextWorkspace!==previousWorkspace){
      previousWorkspace=nextWorkspace;
      resetScroll();
    }
  }).observe(navigation,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
})();
