(function(){
  const dismiss=()=>{
    const loader=document.getElementById('crmLoader');
    if(!loader||loader.dataset.ready)return;
    loader.dataset.ready='true';
    window.setTimeout(()=>loader.classList.add('is-ready'),420);
    window.setTimeout(()=>loader.remove(),900);
  };
  window.addEventListener('crm-ready',dismiss,{once:true});
  window.setTimeout(dismiss,6500);
})();
