/* EA 360-inspired navigation, applied without changing CRM routes or stored records. */
(function(){
  const groups=[
    ['OVERVIEW',['Overview','Reports']],
    ['OPERATIONS',['Clients','Pipeline','Documents','Projects','Client Process','Follow-ups','Calendar','Services']],
    ['FINANCE & PEOPLE',['Accounts','HR']],
    ['CONTROL',['Automations','Templates','Mailbox','Client portal','Jarvis','Settings']]
  ];
  function sectionOf(button){return (button.title||button.querySelector('.nav-label')?.textContent||button.textContent||'').trim()}
  function applyEaNavigation(){
    if(!window.matchMedia('(min-width:1024px)').matches)return;
    const nav=document.getElementById('nav');if(!nav)return;
    nav.querySelectorAll('.ea-nav-heading').forEach(item=>item.remove());
    nav.querySelectorAll('button').forEach(button=>{button.style.display='flex';});
    nav.querySelectorAll('[data-horizontal-more],[data-navbar-favorite]').forEach(button=>button.remove());
    const buttons=[...nav.querySelectorAll('button')];
    groups.forEach(([label,names])=>{
      const first=buttons.find(button=>names.includes(sectionOf(button)));
      if(!first)return;
      const heading=document.createElement('span');heading.className='ea-nav-heading';heading.textContent=label;nav.insertBefore(heading,first);
    });
  }
  function activateEaStyle(){
    document.body.classList.add('ea360-interface');
    applyEaNavigation();
  }
  const originalApply=window.applyHorizontalNavigation;
  if(typeof originalApply==='function')window.applyHorizontalNavigation=function(){originalApply();applyEaNavigation();};
  const originalRender=window.render;
  if(typeof originalRender==='function')window.render=function(){originalRender();activateEaStyle();};
  window.addEventListener('resize',applyEaNavigation);
  setTimeout(activateEaStyle,80);
})();
