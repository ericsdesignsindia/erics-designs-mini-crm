/* Start each newly selected workspace at its heading on desktop and mobile. */
(function installWorkspaceScrollReset(){
  if(window.__crmWorkspaceScrollResetInstalled||typeof window.nav!=='function')return;
  window.__crmWorkspaceScrollResetInstalled=true;
  const navigate=window.nav;
  const currentView=()=>{try{return typeof view==='string'?view:''}catch{return''}};

  window.nav=function(){
    const previous=currentView();
    const result=navigate.apply(this,arguments);
    if(currentView()!==previous){
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        window.scrollTo({top:0,left:0,behavior:'auto'});
        const main=document.querySelector('.shell>main');
        if(main){main.scrollTop=0;main.scrollLeft=0}
      }));
    }
    return result;
  };
})();
